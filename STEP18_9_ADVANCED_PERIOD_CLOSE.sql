-- STEP 18.9 — Advanced Period Close
-- Additive migration. Requires STEP 17 through STEP 18.8.
begin;

create extension if not exists pgcrypto;

do $$ begin
  if to_regclass('public.accounting_fiscal_periods') is null
     or to_regclass('public.accounting_period_locks') is null
     or to_regclass('public.accounting_journal_entries') is null
     or to_regclass('public.please_accounting_outbox') is null
     or to_regprocedure('public.accounting_enqueue_event(text,text,text,text,jsonb,timestamptz,integer,text,text,text)') is null then
    raise exception 'STEP 18.9 prerequisites missing. Install STEP 17 through STEP 18.8 first.';
  end if;
end $$;

alter table public.accounting_fiscal_periods add column if not exists close_state text not null default 'DRAFT' check(close_state in ('DRAFT','IN_REVIEW','READY','CLOSED','REOPENED'));
alter table public.accounting_fiscal_periods add column if not exists close_version integer not null default 0;
alter table public.accounting_fiscal_periods add column if not exists last_prepared_at timestamptz;
alter table public.accounting_fiscal_periods add column if not exists last_prepared_by text;
alter table public.accounting_fiscal_periods add column if not exists close_notes text;
alter table public.accounting_fiscal_periods add column if not exists reopened_at timestamptz;
alter table public.accounting_fiscal_periods add column if not exists reopened_by text;
alter table public.accounting_fiscal_periods add column if not exists reopen_reason text;

create sequence if not exists public.accounting_period_adjustment_number_seq;

create table if not exists public.accounting_period_close_checklist (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.accounting_fiscal_periods(id) on delete restrict,
  control_code text not null,
  category text not null,
  label text not null,
  requirement_level text not null check(requirement_level in ('HARD','REVIEW')),
  status text not null check(status in ('PASS','REVIEW','BLOCKER','OVERRIDDEN')),
  details text,
  metric_json jsonb not null default '{}'::jsonb,
  override_reason text,
  override_by text,
  override_at timestamptz,
  refreshed_at timestamptz not null default now(),
  unique(period_id,control_code)
);
create index if not exists accounting_period_close_checklist_period_idx on public.accounting_period_close_checklist(period_id,category,control_code);

create table if not exists public.accounting_period_close_snapshots (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.accounting_fiscal_periods(id) on delete restrict,
  close_version integer not null,
  snapshot_json jsonb not null,
  created_by text,
  created_at timestamptz not null default now(),
  unique(period_id,close_version)
);

create table if not exists public.accounting_period_close_actions (
  id bigint generated always as identity primary key,
  period_id uuid not null references public.accounting_fiscal_periods(id) on delete restrict,
  action_type text not null check(action_type in ('PREPARE','REFRESH','OVERRIDE','ADJUSTMENT','REVERSAL','CLOSE','REOPEN')),
  reason text,
  actor_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists accounting_period_close_actions_period_idx on public.accounting_period_close_actions(period_id,occurred_at desc);

create table if not exists public.accounting_period_adjustments (
  id uuid primary key default gen_random_uuid(),
  adjustment_number text not null unique default ('ADJ-'||lpad(nextval('public.accounting_period_adjustment_number_seq')::text,6,'0')),
  period_id uuid not null references public.accounting_fiscal_periods(id) on delete restrict,
  entry_date date not null,
  memo text not null,
  lines_json jsonb not null,
  reversal_of uuid references public.accounting_period_adjustments(id) on delete restrict,
  reason text,
  status text not null default 'POSTED' check(status in ('POSTED')),
  created_by text,
  created_at timestamptz not null default now(),
  check(jsonb_typeof(lines_json)='array' and jsonb_array_length(lines_json)>1)
);
create unique index if not exists accounting_period_adjustments_reversal_uq on public.accounting_period_adjustments(reversal_of) where reversal_of is not null;
create index if not exists accounting_period_adjustments_period_idx on public.accounting_period_adjustments(period_id,entry_date,created_at);

alter table public.accounting_period_close_checklist enable row level security;
alter table public.accounting_period_close_snapshots enable row level security;
alter table public.accounting_period_close_actions enable row level security;
alter table public.accounting_period_adjustments enable row level security;

create or replace function public.accounting_period_close_immutable()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'Period-close snapshots/actions and posted adjustments are immutable.';
end $$;

drop trigger if exists trg_accounting_period_close_snapshots_immutable on public.accounting_period_close_snapshots;
create trigger trg_accounting_period_close_snapshots_immutable before update or delete on public.accounting_period_close_snapshots for each row execute function public.accounting_period_close_immutable();
drop trigger if exists trg_accounting_period_close_actions_immutable on public.accounting_period_close_actions;
create trigger trg_accounting_period_close_actions_immutable before update or delete on public.accounting_period_close_actions for each row execute function public.accounting_period_close_immutable();
drop trigger if exists trg_accounting_period_adjustments_immutable on public.accounting_period_adjustments;
create trigger trg_accounting_period_adjustments_immutable before update or delete on public.accounting_period_adjustments for each row execute function public.accounting_period_close_immutable();

create or replace function public.accounting_period_close_checklist_guard()
returns trigger language plpgsql set search_path=public as $$
declare v_period uuid:=case when tg_op='DELETE' then old.period_id else new.period_id end;
begin
  if exists(select 1 from public.accounting_fiscal_periods where id=v_period and status='CLOSED') then
    raise exception 'Closed period checklist evidence is frozen. Reopen the period first.';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists trg_accounting_period_close_checklist_guard on public.accounting_period_close_checklist;
create trigger trg_accounting_period_close_checklist_guard before insert or update or delete on public.accounting_period_close_checklist for each row execute function public.accounting_period_close_checklist_guard();

create or replace function public.accounting_assert_period_open(p_entry_date date,p_context text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_entry_date is null then raise exception 'Accounting date is required.'; end if;
  if exists(select 1 from public.accounting_period_locks where p_entry_date between period_start and period_end) then
    raise exception 'Accounting period is closed/locked for date % (%)',p_entry_date,coalesce(p_context,'posting');
  end if;
end $$;

create or replace function public.accounting_event_effective_date(
  p_event_type text,p_source_table text,p_source_record_id text,p_payload jsonb,p_occurred_at timestamptz
) returns date language plpgsql stable set search_path=public as $$
declare v_type text:=upper(coalesce(p_event_type,'')); v_date date;
begin
  begin
    case v_type
      when 'INVOICE_ISSUED' then v_date:=nullif(p_payload#>>'{invoice,invoice_date}','')::date;
      when 'INVOICE_VOIDED' then v_date:=coalesce(nullif(left(p_payload#>>'{invoice,voided_at}',10),'')::date,p_occurred_at::date);
      when 'PAYMENT_RECEIVED' then v_date:=coalesce(nullif(left(p_payload#>>'{payment_transaction,created_at}',10),'')::date,p_occurred_at::date);
      when 'STRIPE_FEE_RECORDED' then v_date:=coalesce(nullif(left(p_payload#>>'{payment_transaction,created_at}',10),'')::date,p_occurred_at::date);
      when 'VENDOR_BILL_POSTED' then v_date:=nullif(p_payload#>>'{supplier_bill,bill_date}','')::date;
      when 'SUPPLIER_PAYMENT_PAID' then v_date:=nullif(p_payload#>>'{supplier_payment,payment_date}','')::date;
      when 'CREDIT_NOTE_ISSUED' then v_date:=nullif(p_payload#>>'{credit_note,credit_date}','')::date;
      when 'REFUND_COMPLETED' then v_date:=nullif(p_payload#>>'{customer_refund,refund_date}','')::date;
      when 'EXPENSE_POSTED' then v_date:=nullif(p_payload#>>'{expense_claim,posting_date}','')::date;
      when 'EXPENSE_REIMBURSEMENT_PAID' then v_date:=nullif(p_payload#>>'{expense_reimbursement,payment_date}','')::date;
      when 'INVENTORY_OPENING_POSTED' then v_date:=nullif(p_payload#>>'{inventory_movement,movement_date}','')::date;
      when 'INVENTORY_ISSUE_POSTED' then v_date:=nullif(p_payload#>>'{inventory_movement,movement_date}','')::date;
      when 'INVENTORY_ADJUSTMENT_POSTED' then v_date:=nullif(p_payload#>>'{inventory_movement,movement_date}','')::date;
      when 'FIXED_ASSET_OPENING_POSTED' then v_date:=nullif(p_payload#>>'{fixed_asset,purchase_date}','')::date;
      when 'FIXED_ASSET_DEPRECIATION_POSTED' then v_date:=nullif(p_payload#>>'{depreciation_run,period_end}','')::date;
      when 'FIXED_ASSET_DISPOSAL_POSTED' then v_date:=nullif(p_payload#>>'{fixed_asset,disposal_date}','')::date;
      when 'PAYROLL_POSTED' then v_date:=nullif(p_payload#>>'{payroll_run,payment_date}','')::date;
      when 'PAYROLL_PAID' then v_date:=coalesce(nullif(left(p_payload#>>'{payroll_run,paid_at}',10),'')::date,p_occurred_at::date);
      when 'PAYROLL_REMITTANCE_PAID' then v_date:=nullif(p_payload#>>'{payroll_remittance,remittance_date}','')::date;
      when 'PERIOD_CLOSE_ADJUSTMENT_POSTED' then v_date:=nullif(p_payload#>>'{period_adjustment,entry_date}','')::date;
      else v_date:=p_occurred_at::date;
    end case;
  exception when others then v_date:=p_occurred_at::date; end;
  if v_type='PROVIDER_PAYABLE_CREATED' and p_source_record_id is not null then
    select coalesce(j.completed_at::date,p.created_at::date,v_date) into v_date
    from public.provider_payments p left join public.jobs j on j.id=p.job_id where p.id::text=p_source_record_id limit 1;
  elsif v_type='PROVIDER_PAYMENT_PAID' and p_source_record_id is not null then
    select coalesce(p.paid_at::date,p.updated_at::date,p.created_at::date,v_date) into v_date from public.provider_payments p where p.id::text=p_source_record_id limit 1;
  end if;
  return coalesce(v_date,p_occurred_at::date,current_date);
end $$;

-- STEP 18.9 hardens the durable enqueue boundary: a new/unposted financial event
-- cannot be introduced into a closed period. Existing POSTED/IGNORED idempotent
-- events remain readable/recoverable without being re-opened.
create or replace function public.accounting_enqueue_event(
  p_event_type text,p_source_table text,p_source_record_id text,p_source_reference text,
  p_payload jsonb default '{}'::jsonb,p_occurred_at timestamptz default now(),p_event_version int default 1,
  p_actor_id text default null,p_correlation_id text default null,p_causation_id text default null
) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare
  v_id uuid; v_status text; v_type text:=upper(trim(p_event_type)); v_key text;
  v_payload jsonb:=coalesce(p_payload,'{}'::jsonb); v_hash text; v_effective_date date;
begin
  if v_type is null or v_type='' then raise exception 'Accounting event type is required'; end if;
  v_key:='PLEASE:'||v_type||':'||coalesce(nullif(p_source_record_id,''),'none');
  select id,status into v_id,v_status from public.please_accounting_outbox where event_key=v_key limit 1;
  if v_id is not null and v_status in ('POSTED','IGNORED') then return v_id; end if;
  v_effective_date:=public.accounting_event_effective_date(v_type,p_source_table,p_source_record_id,v_payload,coalesce(p_occurred_at,now()));
  perform public.accounting_assert_period_open(v_effective_date,'event '||v_type);
  v_hash:=encode(digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex');
  insert into public.please_accounting_outbox(
    event_key,source_system,event_type,event_version,source_table,source_record_id,source_reference,
    occurred_at,payload_json,payload_hash,status,attempts,next_attempt_at,actor_id,correlation_id,causation_id,updated_at
  ) values(
    v_key,'PLEASE',v_type,greatest(1,coalesce(p_event_version,1)),p_source_table,p_source_record_id,p_source_reference,
    coalesce(p_occurred_at,now()),v_payload,v_hash,'PENDING',0,now(),p_actor_id,p_correlation_id,p_causation_id,now()
  ) on conflict(event_key) do update set
    source_reference=coalesce(excluded.source_reference,public.please_accounting_outbox.source_reference),
    correlation_id=coalesce(excluded.correlation_id,public.please_accounting_outbox.correlation_id),
    causation_id=coalesce(excluded.causation_id,public.please_accounting_outbox.causation_id),
    actor_id=coalesce(excluded.actor_id,public.please_accounting_outbox.actor_id),
    payload_json=case when public.please_accounting_outbox.status in ('PENDING','RETRY','DEAD_LETTER') then excluded.payload_json else public.please_accounting_outbox.payload_json end,
    payload_hash=case when public.please_accounting_outbox.status in ('PENDING','RETRY','DEAD_LETTER') then excluded.payload_hash else public.please_accounting_outbox.payload_hash end,
    status=case when public.please_accounting_outbox.status='DEAD_LETTER' and public.please_accounting_outbox.payload_hash<>excluded.payload_hash then 'RETRY' else public.please_accounting_outbox.status end,
    next_attempt_at=case when public.please_accounting_outbox.status='DEAD_LETTER' and public.please_accounting_outbox.payload_hash<>excluded.payload_hash then now() else public.please_accounting_outbox.next_attempt_at end,
    dead_letter_at=case when public.please_accounting_outbox.status='DEAD_LETTER' and public.please_accounting_outbox.payload_hash<>excluded.payload_hash then null else public.please_accounting_outbox.dead_letter_at end,
    attempts=case when public.please_accounting_outbox.status in ('RETRY','DEAD_LETTER') and public.please_accounting_outbox.payload_hash<>excluded.payload_hash then 0 else public.please_accounting_outbox.attempts end,
    last_error=case when public.please_accounting_outbox.status in ('RETRY','DEAD_LETTER') and public.please_accounting_outbox.payload_hash<>excluded.payload_hash then null else public.please_accounting_outbox.last_error end,
    updated_at=now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.accounting_inventory_subledger_value_as_of(p_as_of date)
returns numeric language sql stable set search_path=public as $$
  select round(coalesce(sum(value_delta),0),2) from public.accounting_inventory_movements where movement_date<=p_as_of;
$$;

create or replace function public.accounting_fixed_asset_gross_subledger_value_as_of(p_as_of date)
returns numeric language sql stable set search_path=public as $$
  select round(coalesce(sum(capital_cost),0),2) from public.accounting_fixed_assets
  where purchase_date<=p_as_of and (disposal_date is null or disposal_date>p_as_of);
$$;

create or replace function public.accounting_fixed_asset_accum_subledger_value_as_of(p_as_of date)
returns numeric language sql stable set search_path=public as $$
  with active_assets as (
    select id,opening_accumulated_depreciation from public.accounting_fixed_assets
    where purchase_date<=p_as_of and (disposal_date is null or disposal_date>p_as_of)
  ), dep as (
    select l.asset_id,sum(l.depreciation_amount) amount
    from public.accounting_fixed_asset_depreciation_lines l
    join public.accounting_fixed_asset_depreciation_runs r on r.id=l.depreciation_run_id
    where r.status='POSTED' and r.period_end<=p_as_of group by l.asset_id
  )
  select round(coalesce(sum(a.opening_accumulated_depreciation+coalesce(d.amount,0)),0),2)
  from active_assets a left join dep d on d.asset_id=a.id;
$$;

create or replace function public.accounting_set_period_close_control(
  p_period_id uuid,p_code text,p_category text,p_label text,p_level text,p_status text,p_details text,p_metric jsonb
) returns void language plpgsql set search_path=public as $$
begin
  insert into public.accounting_period_close_checklist(period_id,control_code,category,label,requirement_level,status,details,metric_json,refreshed_at)
  values(p_period_id,p_code,p_category,p_label,p_level,p_status,p_details,coalesce(p_metric,'{}'::jsonb),now())
  on conflict(period_id,control_code) do update set
    category=excluded.category,label=excluded.label,requirement_level=excluded.requirement_level,
    status=case
      when excluded.status='PASS' then 'PASS'
      when public.accounting_period_close_checklist.status='OVERRIDDEN' and public.accounting_period_close_checklist.requirement_level='REVIEW' then 'OVERRIDDEN'
      else excluded.status end,
    details=excluded.details,metric_json=excluded.metric_json,refreshed_at=now(),
    override_reason=case when excluded.status='PASS' then null else public.accounting_period_close_checklist.override_reason end,
    override_by=case when excluded.status='PASS' then null else public.accounting_period_close_checklist.override_by end,
    override_at=case when excluded.status='PASS' then null else public.accounting_period_close_checklist.override_at end;
end $$;

create or replace function public.accounting_refresh_period_close_checklist(p_period_id uuid,p_actor_id text default null)
returns integer language plpgsql security definer set search_path=public as $$
declare
  p public.accounting_fiscal_periods%rowtype;
  v_count int; v_debit numeric; v_credit numeric; v_inv_sub numeric; v_inv_gl numeric;
  v_fa_gross_sub numeric; v_fa_gross_gl numeric; v_fa_acc_sub numeric; v_fa_acc_gl numeric;
  v_tax_activity numeric; v_journals int; v_active_assets int; v_dep_ok boolean;
begin
  select * into p from public.accounting_fiscal_periods where id=p_period_id for update;
  if not found then raise exception 'Fiscal period not found.'; end if;
  if p.status='CLOSED' then return (select count(*) from public.accounting_period_close_checklist where period_id=p.id); end if;

  select count(*) into v_count from public.please_accounting_outbox where status in ('PENDING','PROCESSING','RETRY','ERROR','DEAD_LETTER');
  perform public.accounting_set_period_close_control(p.id,'ENGINE_QUEUE','ENGINE','Accounting engine queue','HARD',case when v_count=0 then 'PASS' else 'BLOCKER' end,
    case when v_count=0 then 'No unresolved accounting events.' else v_count||' unresolved accounting event(s) must be processed before close.' end,jsonb_build_object('unresolved',v_count));

  select coalesce(sum(l.debit),0),coalesce(sum(l.credit),0),count(distinct e.id) into v_debit,v_credit,v_journals
  from public.accounting_journal_entries e join public.accounting_journal_lines l on l.journal_entry_id=e.id
  where e.status='POSTED' and e.entry_date between p.period_start and p.period_end;
  perform public.accounting_set_period_close_control(p.id,'TRIAL_BALANCE','LEDGER','Trial balance integrity','HARD',case when round(v_debit,2)=round(v_credit,2) then 'PASS' else 'BLOCKER' end,
    'Period debits '||to_char(v_debit,'FM9999999990.00')||' / credits '||to_char(v_credit,'FM9999999990.00'),jsonb_build_object('debits',v_debit,'credits',v_credit,'journal_count',v_journals));

  v_inv_sub:=public.accounting_inventory_subledger_value_as_of(p.period_end); v_inv_gl:=public.accounting_inventory_gl_balance(p.period_end);
  perform public.accounting_set_period_close_control(p.id,'INVENTORY_RECON','SUBLEDGER','Inventory subledger vs GL 1600','HARD',case when abs(v_inv_gl-v_inv_sub)<=0.02 then 'PASS' else 'BLOCKER' end,
    'Subledger '||to_char(v_inv_sub,'FM9999999990.00')||' / GL '||to_char(v_inv_gl,'FM9999999990.00'),jsonb_build_object('subledger',v_inv_sub,'gl',v_inv_gl,'difference',round(v_inv_gl-v_inv_sub,2)));

  v_fa_gross_sub:=public.accounting_fixed_asset_gross_subledger_value_as_of(p.period_end); v_fa_gross_gl:=public.accounting_fixed_asset_gross_gl_balance(p.period_end);
  v_fa_acc_sub:=public.accounting_fixed_asset_accum_subledger_value_as_of(p.period_end); v_fa_acc_gl:=public.accounting_fixed_asset_accum_gl_balance(p.period_end);
  perform public.accounting_set_period_close_control(p.id,'FIXED_ASSET_RECON','SUBLEDGER','Fixed Assets subledger vs GL 1500/1510','HARD',case when abs(v_fa_gross_gl-v_fa_gross_sub)<=0.02 and abs(v_fa_acc_gl-v_fa_acc_sub)<=0.02 then 'PASS' else 'BLOCKER' end,
    'Gross diff '||to_char(v_fa_gross_gl-v_fa_gross_sub,'FM9999999990.00')||' / accumulated diff '||to_char(v_fa_acc_gl-v_fa_acc_sub,'FM9999999990.00'),jsonb_build_object('gross_subledger',v_fa_gross_sub,'gross_gl',v_fa_gross_gl,'accum_subledger',v_fa_acc_sub,'accum_gl',v_fa_acc_gl));

  select count(*) into v_count from public.accounting_financial_accounts f
  where f.active=true and f.financial_type in ('BANK','CASH','CLEARING') and f.created_at::date<=p.period_end
    and not exists(select 1 from public.accounting_bank_reconciliations r where r.financial_account_id=f.id and r.status='CLOSED' and r.period_start<=p.period_start and r.period_end>=p.period_end);
  perform public.accounting_set_period_close_control(p.id,'BANK_RECON','TREASURY','Bank / cash / clearing reconciliation','REVIEW',case when v_count=0 then 'PASS' else 'REVIEW' end,
    case when v_count=0 then 'All active financial accounts are covered by a closed reconciliation.' else v_count||' active financial account(s) are not covered by a closed reconciliation through period end.' end,jsonb_build_object('unreconciled_accounts',v_count));

  select
    (select count(*) from public.accounting_invoices where invoice_date<=p.period_end and status='DRAFT')+
    (select count(*) from public.accounting_supplier_bills where bill_date<=p.period_end and status in ('DRAFT','SUBMITTED','APPROVED'))+
    (select count(*) from public.accounting_expense_claims where posting_date<=p.period_end and status in ('DRAFT','SUBMITTED','APPROVED'))+
    (select count(*) from public.accounting_credit_notes where credit_date<=p.period_end and status in ('DRAFT','SUBMITTED','APPROVED'))+
    (select count(*) from public.accounting_inventory_counts where count_date<=p.period_end and status='DRAFT')
  into v_count;
  perform public.accounting_set_period_close_control(p.id,'OPEN_WORKFLOWS','CUTOFF','Open operational accounting workflows','REVIEW',case when v_count=0 then 'PASS' else 'REVIEW' end,
    case when v_count=0 then 'No draft/submitted/approved source documents dated through period end.' else v_count||' source workflow(s) dated through period end remain open.' end,jsonb_build_object('open_workflows',v_count));

  select count(*) into v_count from public.accounting_payroll_runs where period_end<=p.period_end and status in ('DRAFT','REVIEW','APPROVED');
  perform public.accounting_set_period_close_control(p.id,'PAYROLL_CUTOFF','PAYROLL','Payroll cutoff','REVIEW',case when v_count=0 then 'PASS' else 'REVIEW' end,
    case when v_count=0 then 'No unposted payroll runs through period end.' else v_count||' payroll run(s) through period end are not posted.' end,jsonb_build_object('unposted_runs',v_count));

  select count(*) into v_active_assets from public.accounting_fixed_assets where status in ('ACTIVE','INACTIVE') and depreciation_method<>'NONE' and coalesce(available_for_use_date,purchase_date)<=p.period_end and (disposal_date is null or disposal_date>p.period_end);
  select exists(select 1 from public.accounting_fixed_asset_depreciation_runs where status='POSTED' and period_end>=p.period_end) into v_dep_ok;
  perform public.accounting_set_period_close_control(p.id,'DEPRECIATION_CUTOFF','FIXED_ASSETS','Book depreciation through period end','REVIEW',case when v_active_assets=0 or v_dep_ok then 'PASS' else 'REVIEW' end,
    case when v_active_assets=0 then 'No depreciable active assets.' when v_dep_ok then 'Posted depreciation covers period end.' else 'Depreciable assets exist but no posted depreciation run covers period end.' end,jsonb_build_object('depreciable_assets',v_active_assets,'covered',v_dep_ok));

  select coalesce(sum(l.debit+l.credit),0) into v_tax_activity from public.accounting_journal_entries e join public.accounting_journal_lines l on l.journal_entry_id=e.id join public.accounting_accounts a on a.id=l.account_id
  where e.status='POSTED' and e.entry_date between p.period_start and p.period_end and a.code in ('1200','2100','2110');
  perform public.accounting_set_period_close_control(p.id,'GST_REVIEW','TAX','GST / HST / QST period review','REVIEW',case when v_tax_activity=0 then 'PASS' else 'REVIEW' end,
    case when v_tax_activity=0 then 'No sales-tax control-account activity in this period.' else 'Sales-tax control accounts have period activity; review the Tax workspace and sign off.' end,jsonb_build_object('tax_account_activity',round(v_tax_activity,2)));

  select count(*) into v_count from public.accounting_expense_claims where posting_date between p.period_start and p.period_end and status in ('POSTED','PAID') and receipt_status='MISSING';
  perform public.accounting_set_period_close_control(p.id,'DOCUMENT_EXCEPTIONS','DOCUMENTS','Missing expense evidence','REVIEW',case when v_count=0 then 'PASS' else 'REVIEW' end,
    case when v_count=0 then 'No posted expenses with missing receipt evidence.' else v_count||' posted expense(s) are missing receipt evidence.' end,jsonb_build_object('missing_receipts',v_count));

  perform public.accounting_set_period_close_control(p.id,'PERIOD_ACTIVITY','LEDGER','Period journal activity','REVIEW',case when v_journals>0 then 'PASS' else 'REVIEW' end,
    case when v_journals>0 then v_journals||' posted journal(s) in period.' else 'No posted journals in this period; confirm this is intentionally a zero-activity period.' end,jsonb_build_object('journal_count',v_journals));

  update public.accounting_fiscal_periods set last_prepared_at=now(),last_prepared_by=p_actor_id,
    close_state=case when exists(select 1 from public.accounting_period_close_checklist c where c.period_id=p.id and c.status in ('BLOCKER','REVIEW')) then 'IN_REVIEW' else 'READY' end
  where id=p.id;
  insert into public.accounting_period_close_actions(period_id,action_type,actor_id,metadata) values(p.id,'REFRESH',p_actor_id,jsonb_build_object('controls',11));
  return 11;
end $$;

create or replace function public.accounting_prepare_period_close(p_period_start date,p_period_end date,p_actor_id text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start then raise exception 'A valid period start/end is required.'; end if;
  if p_period_end>current_date then raise exception 'A future period cannot be closed.'; end if;
  if p_period_end-p_period_start>370 then raise exception 'Period length exceeds 371 days.'; end if;
  select id into v_id from public.accounting_fiscal_periods where period_start=p_period_start and period_end=p_period_end limit 1;
  if v_id is null then
    insert into public.accounting_fiscal_periods(period_start,period_end,status,close_state,last_prepared_at,last_prepared_by)
    values(p_period_start,p_period_end,'OPEN','IN_REVIEW',now(),p_actor_id) returning id into v_id;
  elsif exists(select 1 from public.accounting_fiscal_periods where id=v_id and status='CLOSED') then
    return v_id;
  end if;
  insert into public.accounting_period_close_actions(period_id,action_type,actor_id,metadata) values(v_id,'PREPARE',p_actor_id,jsonb_build_object('period_start',p_period_start,'period_end',p_period_end));
  perform public.accounting_refresh_period_close_checklist(v_id,p_actor_id);
  return v_id;
end $$;

create or replace function public.accounting_override_period_close_control(p_period_id uuid,p_control_code text,p_reason text,p_actor_id text)
returns boolean language plpgsql security definer set search_path=public as $$
declare c public.accounting_period_close_checklist%rowtype;
begin
  select * into c from public.accounting_period_close_checklist where period_id=p_period_id and control_code=upper(trim(p_control_code)) for update;
  if not found then raise exception 'Period-close control not found.'; end if;
  if c.requirement_level<>'REVIEW' then raise exception 'Hard controls cannot be overridden.'; end if;
  if c.status='PASS' then raise exception 'A passing control does not need an override.'; end if;
  if length(trim(coalesce(p_reason,'')))<10 then raise exception 'Override/sign-off reason must be at least 10 characters.'; end if;
  update public.accounting_period_close_checklist set status='OVERRIDDEN',override_reason=trim(p_reason),override_by=p_actor_id,override_at=now() where id=c.id;
  insert into public.accounting_period_close_actions(period_id,action_type,reason,actor_id,metadata) values(p_period_id,'OVERRIDE',trim(p_reason),p_actor_id,jsonb_build_object('control_code',c.control_code));
  update public.accounting_fiscal_periods set close_state=case when exists(select 1 from public.accounting_period_close_checklist where period_id=p_period_id and status in ('BLOCKER','REVIEW')) then 'IN_REVIEW' else 'READY' end where id=p_period_id;
  return true;
end $$;

create or replace function public.accounting_create_period_close_adjustment(p_period_id uuid,p_entry_date date,p_memo text,p_lines jsonb,p_reason text,p_actor_id text)
returns uuid language plpgsql security definer set search_path=public as $$
declare p public.accounting_fiscal_periods%rowtype; v_id uuid; v_row jsonb; r record; v_debit numeric:=0; v_credit numeric:=0; v_count int:=0;
begin
  select * into p from public.accounting_fiscal_periods where id=p_period_id for update; if not found then raise exception 'Fiscal period not found.'; end if;
  if p.status='CLOSED' then raise exception 'Closed periods cannot receive adjustments. Reopen first.'; end if;
  if p_entry_date not between p.period_start and p.period_end then raise exception 'Adjustment date must be inside the selected period.'; end if;
  perform public.accounting_assert_period_open(p_entry_date,'period-close adjustment');
  if jsonb_typeof(coalesce(p_lines,'[]'::jsonb))<>'array' or jsonb_array_length(p_lines)<2 then raise exception 'Adjustment requires at least two lines.'; end if;
  for r in select * from jsonb_to_recordset(p_lines) as x(code text,debit numeric,credit numeric,description text) loop
    if coalesce(r.debit,0)<0 or coalesce(r.credit,0)<0 or (coalesce(r.debit,0)>0 and coalesce(r.credit,0)>0) or (coalesce(r.debit,0)=0 and coalesce(r.credit,0)=0) then raise exception 'Invalid adjustment line for account %',coalesce(r.code,'?'); end if;
    if not exists(select 1 from public.accounting_accounts where code=r.code and active=true and coalesce(allow_manual_posting,true)=true) then raise exception 'GL account % is missing, inactive or blocks manual posting.',coalesce(r.code,'?'); end if;
    v_debit:=v_debit+round(coalesce(r.debit,0),2); v_credit:=v_credit+round(coalesce(r.credit,0),2); v_count:=v_count+1;
  end loop;
  if round(v_debit,2)=0 or round(v_debit,2)<>round(v_credit,2) then raise exception 'Adjustment must balance. Debits %, credits %',round(v_debit,2),round(v_credit,2); end if;
  insert into public.accounting_period_adjustments(period_id,entry_date,memo,lines_json,reason,created_by) values(p.id,p_entry_date,left(trim(p_memo),500),p_lines,nullif(trim(p_reason),''),p_actor_id) returning id into v_id;
  select to_jsonb(a) into v_row from public.accounting_period_adjustments a where a.id=v_id;
  perform public.accounting_enqueue_event('PERIOD_CLOSE_ADJUSTMENT_POSTED','accounting_period_adjustments',v_id::text,(v_row->>'adjustment_number'),jsonb_build_object('period_adjustment',v_row,'lines',p_lines),now(),1,p_actor_id,p.id::text,null);
  insert into public.accounting_period_close_actions(period_id,action_type,reason,actor_id,metadata) values(p.id,'ADJUSTMENT',p_reason,p_actor_id,jsonb_build_object('adjustment_id',v_id,'entry_date',p_entry_date,'debits',round(v_debit,2)));
  return v_id;
end $$;

create or replace function public.accounting_create_period_close_reversal(p_adjustment_id uuid,p_reversal_date date,p_reason text,p_actor_id text)
returns uuid language plpgsql security definer set search_path=public as $$
declare a public.accounting_period_adjustments%rowtype; v_id uuid; v_lines jsonb; v_row jsonb;
begin
  select * into a from public.accounting_period_adjustments where id=p_adjustment_id; if not found then raise exception 'Adjustment not found.'; end if;
  if a.reversal_of is not null then raise exception 'A reversal cannot itself be reversed through this workflow.'; end if;
  if exists(select 1 from public.accounting_period_adjustments where reversal_of=a.id) then raise exception 'This adjustment already has a reversal.'; end if;
  if not exists(select 1 from public.please_accounting_outbox where event_key='PLEASE:PERIOD_CLOSE_ADJUSTMENT_POSTED:'||a.id::text and status='POSTED') then raise exception 'Original adjustment accounting event must be POSTED before reversal.'; end if;
  if length(trim(coalesce(p_reason,'')))<10 then raise exception 'Reversal reason must be at least 10 characters.'; end if;
  perform public.accounting_assert_period_open(p_reversal_date,'period-close adjustment reversal');
  select jsonb_agg(jsonb_build_object('code',x.code,'debit',coalesce(x.credit,0),'credit',coalesce(x.debit,0),'description','Reversal · '||coalesce(x.description,a.memo))) into v_lines
  from jsonb_to_recordset(a.lines_json) as x(code text,debit numeric,credit numeric,description text);
  insert into public.accounting_period_adjustments(period_id,entry_date,memo,lines_json,reversal_of,reason,created_by)
  values(a.period_id,p_reversal_date,left('Reversal: '||a.memo,500),v_lines,a.id,trim(p_reason),p_actor_id) returning id into v_id;
  select to_jsonb(x) into v_row from public.accounting_period_adjustments x where x.id=v_id;
  perform public.accounting_enqueue_event('PERIOD_CLOSE_ADJUSTMENT_POSTED','accounting_period_adjustments',v_id::text,(v_row->>'adjustment_number'),jsonb_build_object('period_adjustment',v_row,'lines',v_lines),now(),1,p_actor_id,a.period_id::text,'PLEASE:PERIOD_CLOSE_ADJUSTMENT_POSTED:'||a.id::text);
  insert into public.accounting_period_close_actions(period_id,action_type,reason,actor_id,metadata) values(a.period_id,'REVERSAL',trim(p_reason),p_actor_id,jsonb_build_object('original_adjustment_id',a.id,'reversal_adjustment_id',v_id,'entry_date',p_reversal_date));
  return v_id;
end $$;

create or replace function public.accounting_close_fiscal_period(p_period_id uuid,p_notes text,p_actor_id text)
returns boolean language plpgsql security definer set search_path=public as $$
declare p public.accounting_fiscal_periods%rowtype; v_version int; v_snapshot jsonb;
begin
  select * into p from public.accounting_fiscal_periods where id=p_period_id for update; if not found then raise exception 'Fiscal period not found.'; end if;
  if p.status='CLOSED' then return true; end if;
  if exists(select 1 from public.accounting_period_locks where period_start<=p.period_end and period_end>=p.period_start) then raise exception 'Another locked period overlaps this period.'; end if;
  if exists(select 1 from public.accounting_period_locks where period_start>p.period_end) then raise exception 'A later period is already closed. Reopen later periods before closing an earlier period.'; end if;
  perform public.accounting_refresh_period_close_checklist(p.id,p_actor_id);
  if exists(select 1 from public.accounting_period_close_checklist where period_id=p.id and status='BLOCKER') then raise exception 'Hard period-close blockers remain.'; end if;
  if exists(select 1 from public.accounting_period_close_checklist where period_id=p.id and status='REVIEW') then raise exception 'Review controls still require sign-off/override.'; end if;
  v_version:=p.close_version+1;
  select jsonb_build_object('period',to_jsonb(p),'controls',coalesce(jsonb_agg(to_jsonb(c) order by c.category,c.control_code),'[]'::jsonb),'closed_at',now()) into v_snapshot
  from public.accounting_period_close_checklist c where c.period_id=p.id;
  insert into public.accounting_period_close_snapshots(period_id,close_version,snapshot_json,created_by) values(p.id,v_version,v_snapshot,p_actor_id);
  insert into public.accounting_period_locks(period_start,period_end,lock_reason,locked_by) values(p.period_start,p.period_end,'STEP 18.9 Advanced Period Close v'||v_version,case when coalesce(p_actor_id,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then p_actor_id::uuid else null end) on conflict(period_start,period_end) do nothing;
  update public.accounting_fiscal_periods set status='CLOSED',close_state='CLOSED',close_version=v_version,closed_at=now(),closed_by=case when coalesce(p_actor_id,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then p_actor_id::uuid else null end,close_notes=nullif(trim(p_notes),''),reopened_at=null,reopened_by=null,reopen_reason=null where id=p.id;
  insert into public.accounting_period_close_actions(period_id,action_type,reason,actor_id,metadata) values(p.id,'CLOSE',p_notes,p_actor_id,jsonb_build_object('close_version',v_version));
  return true;
end $$;

create or replace function public.accounting_reopen_fiscal_period(p_period_id uuid,p_reason text,p_actor_id text)
returns boolean language plpgsql security definer set search_path=public as $$
declare p public.accounting_fiscal_periods%rowtype;
begin
  select * into p from public.accounting_fiscal_periods where id=p_period_id for update; if not found then raise exception 'Fiscal period not found.'; end if;
  if p.status<>'CLOSED' then raise exception 'Only a closed period can be reopened.'; end if;
  if length(trim(coalesce(p_reason,'')))<10 then raise exception 'Reopen reason must be at least 10 characters.'; end if;
  if exists(select 1 from public.accounting_period_locks where period_start>p.period_end) then raise exception 'Reopen later closed periods first.'; end if;
  delete from public.accounting_period_locks where period_start=p.period_start and period_end=p.period_end;
  update public.accounting_fiscal_periods set status='OPEN',close_state='REOPENED',closed_at=null,closed_by=null,reopened_at=now(),reopened_by=p_actor_id,reopen_reason=trim(p_reason) where id=p.id;
  insert into public.accounting_period_close_actions(period_id,action_type,reason,actor_id,metadata) values(p.id,'REOPEN',trim(p_reason),p_actor_id,jsonb_build_object('previous_close_version',p.close_version));
  return true;
end $$;

-- Service-role only. CAL UI accesses these RPCs through admin-gated Netlify functions.
revoke all on table public.accounting_period_close_checklist,public.accounting_period_close_snapshots,public.accounting_period_close_actions,public.accounting_period_adjustments from public,anon,authenticated;
grant select on table public.accounting_period_close_checklist,public.accounting_period_close_snapshots,public.accounting_period_close_actions,public.accounting_period_adjustments to service_role;
grant usage,select on sequence public.accounting_period_adjustment_number_seq to service_role;

revoke all on function public.accounting_assert_period_open(date,text) from public,anon,authenticated;
revoke all on function public.accounting_event_effective_date(text,text,text,jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.accounting_inventory_subledger_value_as_of(date) from public,anon,authenticated;
revoke all on function public.accounting_fixed_asset_gross_subledger_value_as_of(date) from public,anon,authenticated;
revoke all on function public.accounting_fixed_asset_accum_subledger_value_as_of(date) from public,anon,authenticated;
revoke all on function public.accounting_refresh_period_close_checklist(uuid,text) from public,anon,authenticated;
revoke all on function public.accounting_prepare_period_close(date,date,text) from public,anon,authenticated;
revoke all on function public.accounting_override_period_close_control(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.accounting_create_period_close_adjustment(uuid,date,text,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.accounting_create_period_close_reversal(uuid,date,text,text) from public,anon,authenticated;
revoke all on function public.accounting_close_fiscal_period(uuid,text,text) from public,anon,authenticated;
revoke all on function public.accounting_reopen_fiscal_period(uuid,text,text) from public,anon,authenticated;

grant execute on function public.accounting_assert_period_open(date,text) to service_role;
grant execute on function public.accounting_event_effective_date(text,text,text,jsonb,timestamptz) to service_role;
grant execute on function public.accounting_inventory_subledger_value_as_of(date) to service_role;
grant execute on function public.accounting_fixed_asset_gross_subledger_value_as_of(date) to service_role;
grant execute on function public.accounting_fixed_asset_accum_subledger_value_as_of(date) to service_role;
grant execute on function public.accounting_refresh_period_close_checklist(uuid,text) to service_role;
grant execute on function public.accounting_prepare_period_close(date,date,text) to service_role;
grant execute on function public.accounting_override_period_close_control(uuid,text,text,text) to service_role;
grant execute on function public.accounting_create_period_close_adjustment(uuid,date,text,jsonb,text,text) to service_role;
grant execute on function public.accounting_create_period_close_reversal(uuid,date,text,text) to service_role;
grant execute on function public.accounting_close_fiscal_period(uuid,text,text) to service_role;
grant execute on function public.accounting_reopen_fiscal_period(uuid,text,text) to service_role;

commit;
