-- PLEASE / CAL — STEP 18.5: Treasury & Bank Reconciliation
-- Safe additive migration. Run AFTER STEP18_4_ADVANCED_EXPENSE_WORKFLOW.sql.
-- Scope: bank/cash/card/clearing statement imports, matching to the posted ledger,
-- reconciliation close controls, treasury position and audit-safe carry-forward.

begin;

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.accounting_financial_accounts') is null then
    raise exception 'STEP 18.1 Financial Master Data is required before STEP 18.5.';
  end if;
  if to_regclass('public.accounting_journal_entries') is null or to_regclass('public.accounting_journal_lines') is null then
    raise exception 'CAL journal tables are required before STEP 18.5.';
  end if;
end $$;

create sequence if not exists public.accounting_bank_reconciliation_number_seq start with 1001;
create sequence if not exists public.accounting_bank_import_number_seq start with 1001;

create table if not exists public.accounting_bank_reconciliations (
  id uuid primary key default gen_random_uuid(),
  reconciliation_number text not null unique default ('REC-' || lpad(nextval('public.accounting_bank_reconciliation_number_seq')::text,6,'0')),
  financial_account_id uuid not null references public.accounting_financial_accounts(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  statement_opening_balance numeric(14,2) not null default 0,
  statement_ending_balance numeric(14,2) not null default 0,
  statement_reference text,
  status text not null default 'DRAFT' check(status in ('DRAFT','IN_PROGRESS','CLOSED')),
  statement_activity numeric(14,2) not null default 0,
  calculated_statement_ending numeric(14,2) not null default 0,
  book_opening_balance numeric(14,2) not null default 0,
  book_ending_balance numeric(14,2) not null default 0,
  outstanding_book_effect numeric(14,2) not null default 0,
  adjusted_statement_balance numeric(14,2) not null default 0,
  difference numeric(14,2) not null default 0,
  statement_control_difference numeric(14,2) not null default 0,
  statement_transaction_count integer not null default 0,
  unmatched_statement_count integer not null default 0,
  outstanding_book_count integer not null default 0,
  summary_json jsonb not null default '{}'::jsonb,
  created_by text,
  closed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  check(period_end >= period_start),
  unique(financial_account_id,period_start,period_end)
);
create index if not exists accounting_bank_reconciliations_account_idx on public.accounting_bank_reconciliations(financial_account_id,period_end desc,status);

create table if not exists public.accounting_bank_imports (
  id uuid primary key default gen_random_uuid(),
  import_number text not null unique default ('BNKIMP-' || lpad(nextval('public.accounting_bank_import_number_seq')::text,6,'0')),
  reconciliation_id uuid not null references public.accounting_bank_reconciliations(id) on delete restrict,
  financial_account_id uuid not null references public.accounting_financial_accounts(id) on delete restrict,
  file_name text,
  file_hash text,
  file_format text not null default 'CSV' check(file_format in ('CSV','OFX','QFX','MANUAL')),
  row_count integer not null default 0,
  imported_by text,
  imported_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique(reconciliation_id,file_hash)
);
create index if not exists accounting_bank_imports_recon_idx on public.accounting_bank_imports(reconciliation_id,imported_at desc);

create table if not exists public.accounting_bank_transactions (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references public.accounting_bank_reconciliations(id) on delete restrict,
  import_id uuid references public.accounting_bank_imports(id) on delete restrict,
  financial_account_id uuid not null references public.accounting_financial_accounts(id) on delete restrict,
  statement_date date not null,
  value_date date,
  description text not null,
  external_id text,
  source_row_number integer,
  signed_amount numeric(14,2) not null check(abs(signed_amount) > 0),
  currency text not null default 'CAD',
  fingerprint text not null,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(financial_account_id,fingerprint)
);
create index if not exists accounting_bank_transactions_recon_idx on public.accounting_bank_transactions(reconciliation_id,statement_date,id);
create index if not exists accounting_bank_transactions_account_idx on public.accounting_bank_transactions(financial_account_id,statement_date,id);
alter table public.accounting_bank_transactions add column if not exists source_row_number integer;

create table if not exists public.accounting_bank_matches (
  id uuid primary key default gen_random_uuid(),
  bank_transaction_id uuid not null references public.accounting_bank_transactions(id) on delete restrict,
  journal_line_id uuid not null references public.accounting_journal_lines(id) on delete restrict,
  matched_amount numeric(14,2) not null check(matched_amount > 0),
  match_method text not null default 'MANUAL' check(match_method in ('AUTO','MANUAL')),
  matched_by text,
  matched_at timestamptz not null default now(),
  unique(bank_transaction_id,journal_line_id),
  unique(journal_line_id)
);
create index if not exists accounting_bank_matches_tx_idx on public.accounting_bank_matches(bank_transaction_id);

-- Reuse the common touch helper from STEP 18.1.
drop trigger if exists trg_accounting_bank_reconciliations_touch on public.accounting_bank_reconciliations;
create trigger trg_accounting_bank_reconciliations_touch before update on public.accounting_bank_reconciliations
for each row execute function public.accounting_touch_updated_at();

-- Closed reconciliations and their statement/match evidence are immutable.
create or replace function public.accounting_protect_closed_bank_reconciliation()
returns trigger
language plpgsql
set search_path=public,extensions
as $$
begin
  if tg_op='DELETE' then
    if old.status='CLOSED' then raise exception 'Closed bank reconciliations cannot be deleted.'; end if;
    return old;
  end if;
  if old.status='CLOSED' then
    raise exception 'Closed bank reconciliations are immutable. Create a subsequent reconciliation/correction instead.';
  end if;
  return new;
end $$;

drop trigger if exists trg_accounting_protect_closed_bank_reconciliation on public.accounting_bank_reconciliations;
create trigger trg_accounting_protect_closed_bank_reconciliation
before update or delete on public.accounting_bank_reconciliations
for each row execute function public.accounting_protect_closed_bank_reconciliation();

create or replace function public.accounting_protect_closed_bank_evidence()
returns trigger
language plpgsql
set search_path=public,extensions
as $$
declare
  v_old_recon_id uuid;
  v_new_recon_id uuid;
  v_old_status text;
  v_new_status text;
begin
  -- Protect BOTH sides of an UPDATE. Evidence cannot be moved out of (or into)
  -- a CLOSED reconciliation to bypass immutability.
  if tg_table_name='accounting_bank_matches' then
    if tg_op in ('UPDATE','DELETE') then
      select bt.reconciliation_id into v_old_recon_id
      from public.accounting_bank_transactions bt where bt.id=old.bank_transaction_id;
    end if;
    if tg_op in ('INSERT','UPDATE') then
      select bt.reconciliation_id into v_new_recon_id
      from public.accounting_bank_transactions bt where bt.id=new.bank_transaction_id;
    end if;
  elsif tg_table_name in ('accounting_bank_transactions','accounting_bank_imports') then
    if tg_op in ('UPDATE','DELETE') then v_old_recon_id=old.reconciliation_id; end if;
    if tg_op in ('INSERT','UPDATE') then v_new_recon_id=new.reconciliation_id; end if;
  end if;

  if v_old_recon_id is not null then
    select status into v_old_status from public.accounting_bank_reconciliations where id=v_old_recon_id;
  end if;
  if v_new_recon_id is not null then
    select status into v_new_status from public.accounting_bank_reconciliations where id=v_new_recon_id;
  end if;
  if v_old_status='CLOSED' or v_new_status='CLOSED' then
    raise exception 'Evidence belonging to a closed reconciliation is immutable.';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

do $$
begin
  execute 'drop trigger if exists trg_accounting_bank_imports_closed on public.accounting_bank_imports';
  execute 'create trigger trg_accounting_bank_imports_closed before insert or update or delete on public.accounting_bank_imports for each row execute function public.accounting_protect_closed_bank_evidence()';
  execute 'drop trigger if exists trg_accounting_bank_transactions_closed on public.accounting_bank_transactions';
  execute 'create trigger trg_accounting_bank_transactions_closed before insert or update or delete on public.accounting_bank_transactions for each row execute function public.accounting_protect_closed_bank_evidence()';
  execute 'drop trigger if exists trg_accounting_bank_matches_closed on public.accounting_bank_matches';
  execute 'create trigger trg_accounting_bank_matches_closed before insert or update or delete on public.accounting_bank_matches for each row execute function public.accounting_protect_closed_bank_evidence()';
end $$;

-- Database-level overlap guard. The RPC also checks this, but the trigger protects
-- integrity even if a trusted service-role process writes directly to the table.
create or replace function public.accounting_prevent_bank_reconciliation_overlap()
returns trigger
language plpgsql
set search_path=public,extensions
as $$
begin
  if exists(
    select 1 from public.accounting_bank_reconciliations r
    where r.financial_account_id=new.financial_account_id
      and r.id<>new.id
      and daterange(r.period_start,r.period_end,'[]') && daterange(new.period_start,new.period_end,'[]')
  ) then
    raise exception 'A reconciliation already overlaps this account and period. Closed periods cannot be overlapped.';
  end if;
  return new;
end $$;

drop trigger if exists trg_accounting_bank_reconciliation_overlap on public.accounting_bank_reconciliations;
create trigger trg_accounting_bank_reconciliation_overlap
before insert or update of financial_account_id,period_start,period_end on public.accounting_bank_reconciliations
for each row execute function public.accounting_prevent_bank_reconciliation_overlap();

-- Normal-balance signed effect for a financial account. Positive means the account's
-- balance increases (asset debit / liability credit); negative means it decreases.
create or replace function public.accounting_financial_account_balance(
  p_financial_account_id uuid,
  p_as_of date default current_date
) returns numeric
language sql
stable
security definer
set search_path=public,extensions
as $$
  select coalesce(round(sum(
    case upper(a.account_type)
      when 'LIABILITY' then coalesce(jl.credit,0)-coalesce(jl.debit,0)
      else coalesce(jl.debit,0)-coalesce(jl.credit,0)
    end
  ),2),0)::numeric
  from public.accounting_financial_accounts fa
  join public.accounting_accounts a on a.id=fa.gl_account_id
  join public.accounting_journal_lines jl on jl.account_id=a.id
  join public.accounting_journal_entries je on je.id=jl.journal_entry_id
  where fa.id=p_financial_account_id and je.status='POSTED' and je.entry_date<=coalesce(p_as_of,current_date)
$$;

create or replace function public.accounting_start_bank_reconciliation(
  p_financial_account_id uuid,
  p_period_start date,
  p_period_end date,
  p_statement_opening_balance numeric,
  p_statement_ending_balance numeric,
  p_statement_reference text,
  p_actor_id text
) returns uuid
language plpgsql
security definer
set search_path=public,extensions
as $$
declare v_id uuid; v_type text;
begin
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start then raise exception 'Valid reconciliation period is required.'; end if;
  select financial_type into v_type from public.accounting_financial_accounts where id=p_financial_account_id and active=true for update;
  if v_type is null or v_type not in ('BANK','CASH','CREDIT_CARD','CLEARING','LOAN') then raise exception 'Choose an active bank, cash, card, clearing, or loan financial account.'; end if;
  if exists(select 1 from public.accounting_bank_reconciliations where financial_account_id=p_financial_account_id and daterange(period_start,period_end,'[]') && daterange(p_period_start,p_period_end,'[]')) then
    raise exception 'A reconciliation already overlaps this account and period. Closed periods cannot be overlapped.';
  end if;
  insert into public.accounting_bank_reconciliations(financial_account_id,period_start,period_end,statement_opening_balance,statement_ending_balance,statement_reference,status,created_by)
  values(p_financial_account_id,p_period_start,p_period_end,round(coalesce(p_statement_opening_balance,0),2),round(coalesce(p_statement_ending_balance,0),2),nullif(btrim(p_statement_reference),''),'DRAFT',p_actor_id)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.accounting_update_bank_reconciliation_control(
  p_reconciliation_id uuid,
  p_statement_opening_balance numeric,
  p_statement_ending_balance numeric,
  p_statement_reference text,
  p_actor_id text
) returns uuid
language plpgsql
security definer
set search_path=public,extensions
as $$
declare r public.accounting_bank_reconciliations%rowtype;
begin
  select * into r from public.accounting_bank_reconciliations where id=p_reconciliation_id for update;
  if r.id is null then raise exception 'Reconciliation not found.'; end if;
  if r.status='CLOSED' then raise exception 'Closed reconciliation control values are immutable.'; end if;
  update public.accounting_bank_reconciliations set statement_opening_balance=round(coalesce(p_statement_opening_balance,0),2),statement_ending_balance=round(coalesce(p_statement_ending_balance,0),2),statement_reference=nullif(btrim(p_statement_reference),'') where id=r.id;
  return r.id;
end $$;

create or replace function public.accounting_import_bank_rows(
  p_reconciliation_id uuid,
  p_file_name text,
  p_file_hash text,
  p_file_format text,
  p_rows jsonb,
  p_actor_id text
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_recon public.accounting_bank_reconciliations%rowtype;
  v_import_id uuid; v_row jsonb; v_date date; v_value_date date; v_desc text; v_ext text; v_amount numeric; v_fp text; v_inserted int:=0; v_skipped int:=0; v_format text; v_row_no int:=0;
begin
  select * into v_recon from public.accounting_bank_reconciliations where id=p_reconciliation_id for update;
  if v_recon.id is null then raise exception 'Reconciliation not found.'; end if;
  if v_recon.status='CLOSED' then raise exception 'Closed reconciliation cannot receive imported rows.'; end if;
  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_rows,'[]'::jsonb))=0 then raise exception 'Statement import contains no transactions.'; end if;
  if jsonb_array_length(p_rows)>5000 then raise exception 'One statement import cannot exceed 5000 transactions.'; end if;
  v_format=upper(coalesce(nullif(btrim(p_file_format),''),'CSV'));
  if v_format not in ('CSV','OFX','QFX','MANUAL') then raise exception 'Unsupported statement format.'; end if;
  if v_format in ('CSV','OFX','QFX') and nullif(btrim(p_file_hash),'') is null then raise exception 'Statement file fingerprint is required.'; end if;
  begin
    insert into public.accounting_bank_imports(reconciliation_id,financial_account_id,file_name,file_hash,file_format,row_count,imported_by)
    values(v_recon.id,v_recon.financial_account_id,nullif(btrim(p_file_name),''),nullif(btrim(p_file_hash),''),v_format,jsonb_array_length(p_rows),p_actor_id)
    returning id into v_import_id;
  exception when unique_violation then
    select id into v_import_id from public.accounting_bank_imports where reconciliation_id=v_recon.id and file_hash=p_file_hash limit 1;
    if v_import_id is null then raise; end if;
  end;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_row_no=v_row_no+1;
    begin
      v_date=(v_row->>'date')::date;
    exception when others then raise exception 'Invalid transaction date in statement row: %',coalesce(v_row->>'date',''); end;
    if v_date<v_recon.period_start or v_date>v_recon.period_end then raise exception 'Statement transaction % falls outside reconciliation period.',v_date; end if;
    begin v_value_date=nullif(v_row->>'value_date','')::date; exception when others then v_value_date=null; end;
    v_desc=left(coalesce(nullif(btrim(v_row->>'description'),''),'Statement transaction'),500);
    v_ext=left(nullif(btrim(v_row->>'external_id'),''),180);
    begin v_amount=round((v_row->>'amount')::numeric,2); exception when others then raise exception 'Invalid transaction amount in statement row.'; end;
    if abs(v_amount)<0.005 then raise exception 'Statement transactions cannot have zero amount.'; end if;
    -- FITID/external id is the strongest bank identifier. CSV files often do not
    -- provide one, so use reconciliation + stable source row number as the fallback.
    -- This preserves two legitimate same-day/same-amount transactions instead of
    -- collapsing one as a duplicate, while re-importing the same statement remains idempotent.
    v_fp=encode(digest(convert_to(
      v_recon.financial_account_id::text||'|'||
      case when v_ext is not null then 'EXT|'||v_ext else 'ROW|'||v_recon.id::text||'|'||v_row_no::text||'|'||v_date::text||'|'||v_amount::text||'|'||lower(v_desc) end
    ,'UTF8'),'sha256'),'hex');
    insert into public.accounting_bank_transactions(reconciliation_id,import_id,financial_account_id,statement_date,value_date,description,external_id,source_row_number,signed_amount,currency,fingerprint,raw_data)
    values(v_recon.id,v_import_id,v_recon.financial_account_id,v_date,v_value_date,v_desc,v_ext,v_row_no,v_amount,coalesce(nullif(upper(v_row->>'currency'),''),'CAD'),v_fp,coalesce(v_row,'{}'::jsonb))
    on conflict(financial_account_id,fingerprint) do nothing;
    if found then v_inserted=v_inserted+1; else v_skipped=v_skipped+1; end if;
  end loop;
  update public.accounting_bank_reconciliations set status='IN_PROGRESS' where id=v_recon.id and status='DRAFT';
  return jsonb_build_object('import_id',v_import_id,'inserted',v_inserted,'skipped_duplicates',v_skipped);
end $$;

-- Replaces the match set for one statement transaction. Multi-line matching is allowed
-- (for deposits/payouts composed of several journal lines), but the signed total must equal
-- the statement amount exactly within one cent.
create or replace function public.accounting_match_bank_transaction(
  p_bank_transaction_id uuid,
  p_journal_line_ids uuid[],
  p_actor_id text,
  p_match_method text default 'MANUAL'
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_tx public.accounting_bank_transactions%rowtype; v_recon_status text; v_period_end date; v_gl uuid; v_account_type text; v_line uuid; v_effect numeric; v_total numeric:=0; v_count int:=0; v_method text;
begin
  select * into v_tx from public.accounting_bank_transactions where id=p_bank_transaction_id;
  if v_tx.id is null then raise exception 'Statement transaction not found.'; end if;
  -- Serialize evidence edits with Import/Auto Match/Close on the reconciliation row.
  select status,period_end into v_recon_status,v_period_end from public.accounting_bank_reconciliations where id=v_tx.reconciliation_id for update;
  if v_recon_status='CLOSED' then raise exception 'Closed reconciliation matches are immutable.'; end if;
  select * into v_tx from public.accounting_bank_transactions where id=p_bank_transaction_id for update;
  if coalesce(array_length(p_journal_line_ids,1),0)=0 then raise exception 'Select at least one ledger line to match.'; end if;
  select fa.gl_account_id,a.account_type into v_gl,v_account_type from public.accounting_financial_accounts fa join public.accounting_accounts a on a.id=fa.gl_account_id where fa.id=v_tx.financial_account_id;
  if v_gl is null then raise exception 'Financial account GL mapping is missing.'; end if;
  foreach v_line in array p_journal_line_ids loop
    if exists(select 1 from public.accounting_bank_matches bm where bm.journal_line_id=v_line and bm.bank_transaction_id<>v_tx.id) then raise exception 'A selected ledger line is already cleared by another statement transaction.'; end if;
    select round(case when upper(v_account_type)='LIABILITY' then jl.credit-jl.debit else jl.debit-jl.credit end,2)
      into v_effect
    from public.accounting_journal_lines jl join public.accounting_journal_entries je on je.id=jl.journal_entry_id
    where jl.id=v_line and jl.account_id=v_gl and je.status='POSTED' and je.entry_date<=v_period_end;
    if v_effect is null or abs(v_effect)<0.005 then raise exception 'Selected ledger line is not a posted movement for this financial account.'; end if;
    v_total=round(v_total+v_effect,2); v_count=v_count+1;
  end loop;
  if abs(v_total-v_tx.signed_amount)>0.01 then raise exception 'Selected ledger lines total % but statement transaction is %.',to_char(v_total,'FM9999999990.00'),to_char(v_tx.signed_amount,'FM9999999990.00'); end if;
  delete from public.accounting_bank_matches where bank_transaction_id=v_tx.id;
  v_method=case when upper(coalesce(p_match_method,''))='AUTO' then 'AUTO' else 'MANUAL' end;
  foreach v_line in array p_journal_line_ids loop
    select abs(round(case when upper(v_account_type)='LIABILITY' then jl.credit-jl.debit else jl.debit-jl.credit end,2)) into v_effect from public.accounting_journal_lines jl where jl.id=v_line;
    insert into public.accounting_bank_matches(bank_transaction_id,journal_line_id,matched_amount,match_method,matched_by) values(v_tx.id,v_line,v_effect,v_method,p_actor_id);
  end loop;
  return jsonb_build_object('matched',true,'line_count',v_count,'signed_total',v_total);
end $$;

create or replace function public.accounting_unmatch_bank_transaction(
  p_bank_transaction_id uuid,
  p_actor_id text
) returns integer
language plpgsql
security definer
set search_path=public,extensions
as $$
declare v_status text; v_count int; v_recon_id uuid;
begin
  select bt.reconciliation_id into v_recon_id from public.accounting_bank_transactions bt where bt.id=p_bank_transaction_id;
  if v_recon_id is null then raise exception 'Statement transaction not found.'; end if;
  select r.status into v_status from public.accounting_bank_reconciliations r where r.id=v_recon_id for update;
  if v_status='CLOSED' then raise exception 'Closed reconciliation matches are immutable.'; end if;
  delete from public.accounting_bank_matches where bank_transaction_id=p_bank_transaction_id;
  get diagnostics v_count=row_count;
  return v_count;
end $$;

-- Conservative auto-match: only a single exact amount candidate within +/- 3 days and
-- not previously cleared is accepted. Ambiguous candidates remain for human review.
create or replace function public.accounting_auto_match_bank_reconciliation(
  p_reconciliation_id uuid,
  p_actor_id text
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_recon public.accounting_bank_reconciliations%rowtype; v_gl uuid; v_type text; v_tx record; v_candidate uuid; v_candidates int; v_matched int:=0; v_ambiguous int:=0; v_unmatched int:=0;
begin
  select * into v_recon from public.accounting_bank_reconciliations where id=p_reconciliation_id for update;
  if v_recon.id is null then raise exception 'Reconciliation not found.'; end if;
  if v_recon.status='CLOSED' then raise exception 'Closed reconciliation cannot be auto-matched.'; end if;
  select fa.gl_account_id,a.account_type into v_gl,v_type from public.accounting_financial_accounts fa join public.accounting_accounts a on a.id=fa.gl_account_id where fa.id=v_recon.financial_account_id;
  for v_tx in
    select bt.* from public.accounting_bank_transactions bt
    where bt.reconciliation_id=v_recon.id and not exists(select 1 from public.accounting_bank_matches bm where bm.bank_transaction_id=bt.id)
    order by bt.statement_date,bt.id
  loop
    select count(*),min(jl.id) into v_candidates,v_candidate
    from public.accounting_journal_lines jl
    join public.accounting_journal_entries je on je.id=jl.journal_entry_id
    where jl.account_id=v_gl and je.status='POSTED'
      and je.entry_date between v_tx.statement_date-3 and v_tx.statement_date+3
      and je.entry_date<=v_recon.period_end
      and abs(round((case when upper(v_type)='LIABILITY' then jl.credit-jl.debit else jl.debit-jl.credit end)-v_tx.signed_amount,2))<=0.01
      and not exists(select 1 from public.accounting_bank_matches bm where bm.journal_line_id=jl.id);
    if v_candidates=1 then
      perform public.accounting_match_bank_transaction(v_tx.id,array[v_candidate],p_actor_id,'AUTO'); v_matched=v_matched+1;
    elsif v_candidates>1 then v_ambiguous=v_ambiguous+1;
    else v_unmatched=v_unmatched+1;
    end if;
  end loop;
  return jsonb_build_object('matched',v_matched,'ambiguous',v_ambiguous,'unmatched',v_unmatched);
end $$;

create or replace function public.accounting_bank_reconciliation_snapshot(p_reconciliation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,extensions
as $$
declare
  r public.accounting_bank_reconciliations%rowtype; v_gl uuid; v_type text; v_activity numeric:=0; v_calc numeric:=0; v_book_open numeric:=0; v_book_end numeric:=0; v_outstanding numeric:=0; v_adjusted numeric:=0; v_diff numeric:=0; v_control numeric:=0; v_tx_count int:=0; v_unmatched int:=0; v_outstanding_count int:=0; v_previous jsonb:='[]'::jsonb; v_outstanding_ids jsonb:='[]'::jsonb;
begin
  select * into r from public.accounting_bank_reconciliations where id=p_reconciliation_id;
  if r.id is null then return null; end if;
  select fa.gl_account_id,a.account_type into v_gl,v_type from public.accounting_financial_accounts fa join public.accounting_accounts a on a.id=fa.gl_account_id where fa.id=r.financial_account_id;
  select coalesce(round(sum(signed_amount),2),0),count(*) into v_activity,v_tx_count from public.accounting_bank_transactions where reconciliation_id=r.id;
  select count(*) into v_unmatched from public.accounting_bank_transactions bt where bt.reconciliation_id=r.id and not exists(select 1 from public.accounting_bank_matches bm where bm.bank_transaction_id=bt.id);
  v_book_open=public.accounting_financial_account_balance(r.financial_account_id,r.period_start-1);
  v_book_end=public.accounting_financial_account_balance(r.financial_account_id,r.period_end);
  select coalesce(summary_json->'outstanding_line_ids','[]'::jsonb) into v_previous
  from public.accounting_bank_reconciliations
  where financial_account_id=r.financial_account_id and status='CLOSED' and period_end<r.period_start
  order by period_end desc limit 1;
  v_previous=coalesce(v_previous,'[]'::jsonb);
  with candidate as (
    select jl.id,round(case when upper(v_type)='LIABILITY' then jl.credit-jl.debit else jl.debit-jl.credit end,2) effect
    from public.accounting_journal_lines jl join public.accounting_journal_entries je on je.id=jl.journal_entry_id
    where jl.account_id=v_gl and je.status='POSTED' and je.entry_date between r.period_start and r.period_end
    union
    select jl.id,round(case when upper(v_type)='LIABILITY' then jl.credit-jl.debit else jl.debit-jl.credit end,2) effect
    from jsonb_array_elements_text(v_previous) x(id)
    join public.accounting_journal_lines jl on jl.id=x.id::uuid
    join public.accounting_journal_entries je on je.id=jl.journal_entry_id
    where jl.account_id=v_gl and je.status='POSTED' and je.entry_date<=r.period_end
  ), outstanding as (
    select c.* from candidate c
    where not exists(
      select 1 from public.accounting_bank_matches bm
      join public.accounting_bank_transactions bt on bt.id=bm.bank_transaction_id
      where bm.journal_line_id=c.id and bt.statement_date<=r.period_end
    )
  )
  select coalesce(round(sum(effect),2),0),count(*),coalesce(jsonb_agg(id order by id),'[]'::jsonb) into v_outstanding,v_outstanding_count,v_outstanding_ids from outstanding;
  v_calc=round(r.statement_opening_balance+v_activity,2);
  v_control=round(v_calc-r.statement_ending_balance,2);
  v_adjusted=round(r.statement_ending_balance+v_outstanding,2);
  v_diff=round(v_adjusted-v_book_end,2);
  return jsonb_build_object(
    'reconciliation_id',r.id,'statement_activity',v_activity,'calculated_statement_ending',v_calc,
    'statement_control_difference',v_control,'book_opening_balance',v_book_open,'book_ending_balance',v_book_end,
    'outstanding_book_effect',v_outstanding,'adjusted_statement_balance',v_adjusted,'difference',v_diff,
    'statement_transaction_count',v_tx_count,'unmatched_statement_count',v_unmatched,'outstanding_book_count',v_outstanding_count,
    'outstanding_line_ids',v_outstanding_ids
  );
end $$;

create or replace function public.accounting_close_bank_reconciliation(
  p_reconciliation_id uuid,
  p_actor_id text
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare r public.accounting_bank_reconciliations%rowtype; s jsonb; v_control numeric; v_diff numeric; v_unmatched int;
begin
  select * into r from public.accounting_bank_reconciliations where id=p_reconciliation_id for update;
  if r.id is null then raise exception 'Reconciliation not found.'; end if;
  if r.status='CLOSED' then return r.summary_json; end if;
  s=public.accounting_bank_reconciliation_snapshot(r.id);
  v_control=coalesce((s->>'statement_control_difference')::numeric,0); v_diff=coalesce((s->>'difference')::numeric,0); v_unmatched=coalesce((s->>'unmatched_statement_count')::int,0);
  if abs(v_control)>0.01 then raise exception 'Statement control is out by %. Confirm opening/ending balance and imported rows.',to_char(v_control,'FM9999999990.00'); end if;
  if v_unmatched>0 then raise exception '% statement transaction(s) remain unmatched. Post any missing accounting entries and match them before closing.',v_unmatched; end if;
  if abs(v_diff)>0.01 then raise exception 'Reconciliation difference is %. Review outstanding book items and statement matches.',to_char(v_diff,'FM9999999990.00'); end if;
  update public.accounting_bank_reconciliations set
    status='CLOSED',statement_activity=(s->>'statement_activity')::numeric,calculated_statement_ending=(s->>'calculated_statement_ending')::numeric,
    book_opening_balance=(s->>'book_opening_balance')::numeric,book_ending_balance=(s->>'book_ending_balance')::numeric,
    outstanding_book_effect=(s->>'outstanding_book_effect')::numeric,adjusted_statement_balance=(s->>'adjusted_statement_balance')::numeric,
    difference=(s->>'difference')::numeric,statement_control_difference=(s->>'statement_control_difference')::numeric,
    statement_transaction_count=(s->>'statement_transaction_count')::int,unmatched_statement_count=(s->>'unmatched_statement_count')::int,
    outstanding_book_count=(s->>'outstanding_book_count')::int,summary_json=s,closed_by=p_actor_id,closed_at=now()
  where id=r.id;
  return s;
end $$;

-- Security: all treasury/reconciliation data is server-side Admin only.
do $$
declare t text;
begin
  foreach t in array array['accounting_bank_reconciliations','accounting_bank_imports','accounting_bank_transactions','accounting_bank_matches'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from anon,authenticated',t);
    execute format('grant all on table public.%I to service_role',t);
  end loop;
end $$;

grant usage,select on sequence public.accounting_bank_reconciliation_number_seq to service_role;
grant usage,select on sequence public.accounting_bank_import_number_seq to service_role;
revoke all on function public.accounting_financial_account_balance(uuid,date) from public,anon,authenticated;
revoke all on function public.accounting_start_bank_reconciliation(uuid,date,date,numeric,numeric,text,text) from public,anon,authenticated;
revoke all on function public.accounting_update_bank_reconciliation_control(uuid,numeric,numeric,text,text) from public,anon,authenticated;
revoke all on function public.accounting_import_bank_rows(uuid,text,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.accounting_match_bank_transaction(uuid,uuid[],text,text) from public,anon,authenticated;
revoke all on function public.accounting_unmatch_bank_transaction(uuid,text) from public,anon,authenticated;
revoke all on function public.accounting_auto_match_bank_reconciliation(uuid,text) from public,anon,authenticated;
revoke all on function public.accounting_bank_reconciliation_snapshot(uuid) from public,anon,authenticated;
revoke all on function public.accounting_close_bank_reconciliation(uuid,text) from public,anon,authenticated;
grant execute on function public.accounting_financial_account_balance(uuid,date) to service_role;
grant execute on function public.accounting_start_bank_reconciliation(uuid,date,date,numeric,numeric,text,text) to service_role;
grant execute on function public.accounting_update_bank_reconciliation_control(uuid,numeric,numeric,text,text) to service_role;
grant execute on function public.accounting_import_bank_rows(uuid,text,text,text,jsonb,text) to service_role;
grant execute on function public.accounting_match_bank_transaction(uuid,uuid[],text,text) to service_role;
grant execute on function public.accounting_unmatch_bank_transaction(uuid,text) to service_role;
grant execute on function public.accounting_auto_match_bank_reconciliation(uuid,text) to service_role;
grant execute on function public.accounting_bank_reconciliation_snapshot(uuid) to service_role;
grant execute on function public.accounting_close_bank_reconciliation(uuid,text) to service_role;

comment on table public.accounting_bank_reconciliations is 'STEP 18.5 immutable bank/cash/card reconciliation sessions against posted CAL ledger movements.';
comment on table public.accounting_bank_transactions is 'Normalized statement transactions imported without bank credentials; signed_amount follows financial-account normal balance direction.';
comment on table public.accounting_bank_matches is 'Statement-to-posted-journal clearing evidence. One ledger line may clear only once.';

commit;
