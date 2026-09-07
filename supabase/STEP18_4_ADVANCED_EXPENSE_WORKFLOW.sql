-- PLEASE / CAL — STEP 18.4: Advanced Expense Workflow
-- Safe additive migration. Run AFTER STEP18_3_AR_CREDIT_NOTES_REFUNDS.sql.
-- Scope: controlled direct expenses, reimbursements, ITC eligibility, supporting documents,
-- approval workflow and STEP 17 event-driven posting.
-- Supplier Bills remain in STEP 18.2 Purchases & A/P. Operational Provider expenses remain unchanged.

begin;

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.accounting_parties') is null or to_regclass('public.accounting_financial_accounts') is null then
    raise exception 'STEP 18.1 Financial Master Data is required before STEP 18.4.';
  end if;
  if to_regclass('public.please_accounting_outbox') is null
     or to_regprocedure('public.accounting_enqueue_event(text,text,text,text,jsonb,timestamptz,integer,text,text,text)') is null then
    raise exception 'STEP 17 Native Accounting Engine is required before STEP 18.4.';
  end if;
end $$;

-- Common expense / asset accounts. Additive only; existing customized accounts are not overwritten.
insert into public.accounting_accounts(code,name,account_type,account_subtype,active,system_managed,allow_manual_posting)
values
 ('1400','Prepaid Expenses','ASSET','PREPAID',true,true,true),
 ('1500','Equipment & Vehicles','ASSET','FIXED_ASSET',true,true,true),
 ('2020','Employee / Contractor Reimbursements Payable','LIABILITY','REIMBURSEMENT_PAYABLE',true,true,true),
 ('5100','Fuel & Vehicle','EXPENSE','OPERATING_EXPENSE',true,true,true),
 ('5200','Insurance','EXPENSE','OPERATING_EXPENSE',true,true,true),
 ('5300','Advertising','EXPENSE','OPERATING_EXPENSE',true,true,true),
 ('5500','Professional Fees','EXPENSE','OPERATING_EXPENSE',true,true,true),
 ('5600','Repairs & Maintenance','EXPENSE','OPERATING_EXPENSE',true,true,true)
on conflict(code) do nothing;

update public.accounting_accounts set system_managed=true,updated_at=now()
where code in ('1200','1210','1400','1500','2020','5100','5200','5300','5400','5500','5600','5700');

-- Document integrity metadata (used by expense receipts; existing documents remain valid).
alter table public.accounting_documents add column if not exists sha256_hash text;
alter table public.accounting_documents add column if not exists source_reference text;

-- Private client-owned receipt/document bucket. Do not fail the migration if Storage is unavailable.
do $$
begin
  begin
    insert into storage.buckets(id,name,public)
    values('accounting-documents','accounting-documents',false)
    on conflict(id) do update set public=false;
  exception when undefined_table or insufficient_privilege then
    raise notice 'Supabase Storage bucket could not be created by SQL; create private bucket accounting-documents before receipt upload.';
  end;
end $$;

create sequence if not exists public.accounting_expense_claim_number_seq start with 1001;
create sequence if not exists public.accounting_expense_reimbursement_number_seq start with 1001;

create table if not exists public.accounting_expense_claims (
  id uuid primary key default gen_random_uuid(),
  expense_number text not null unique default ('EXP-' || lpad(nextval('public.accounting_expense_claim_number_seq')::text,6,'0')),
  expense_date date not null default current_date,
  posting_date date not null default current_date,
  vendor_party_id uuid references public.accounting_parties(id) on delete restrict,
  payee_party_id uuid references public.accounting_parties(id) on delete restrict,
  payment_mode text not null default 'COMPANY_PAID' check(payment_mode in ('COMPANY_PAID','REIMBURSEMENT')),
  financial_account_id uuid references public.accounting_financial_accounts(id) on delete restrict,
  currency text not null default 'CAD',
  reference text,
  description text not null,
  business_purpose text,
  department text,
  project_reference text,
  receipt_document_id uuid references public.accounting_documents(id) on delete set null,
  receipt_status text not null default 'MISSING' check(receipt_status in ('MISSING','ATTACHED','WAIVED')),
  receipt_waiver_reason text,
  subtotal numeric(14,2) not null default 0 check(subtotal >= 0),
  tax_total numeric(14,2) not null default 0 check(tax_total >= 0),
  recoverable_tax numeric(14,2) not null default 0 check(recoverable_tax >= 0),
  nonrecoverable_tax numeric(14,2) not null default 0 check(nonrecoverable_tax >= 0),
  total numeric(14,2) not null default 0 check(total > 0),
  status text not null default 'DRAFT' check(status in ('DRAFT','SUBMITTED','APPROVED','POSTED','PAID','REJECTED','VOID')),
  amount_reimbursed numeric(14,2) not null default 0 check(amount_reimbursed >= 0),
  created_by text,
  submitted_by text,
  approved_by text,
  rejected_by text,
  posted_by text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  rejected_reason text,
  posted_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  check(total = round(subtotal + tax_total,2)),
  check(tax_total = round(recoverable_tax + nonrecoverable_tax,2)),
  check(amount_reimbursed <= total + 0.01),
  check((receipt_status <> 'WAIVED') or nullif(trim(receipt_waiver_reason),'') is not null),
  check((payment_mode <> 'COMPANY_PAID') or financial_account_id is not null),
  check((payment_mode <> 'REIMBURSEMENT') or payee_party_id is not null)
);
create index if not exists accounting_expense_claims_status_idx on public.accounting_expense_claims(status,posting_date desc,created_at desc);
create index if not exists accounting_expense_claims_vendor_idx on public.accounting_expense_claims(vendor_party_id,expense_date desc);
create index if not exists accounting_expense_claims_payee_idx on public.accounting_expense_claims(payee_party_id,status,expense_date desc);

create table if not exists public.accounting_expense_claim_lines (
  id uuid primary key default gen_random_uuid(),
  expense_claim_id uuid not null references public.accounting_expense_claims(id) on delete restrict,
  sort_order integer not null default 0,
  description text not null,
  classification text not null default 'EXPENSE' check(classification in ('EXPENSE','PREPAID','FIXED_ASSET','INVENTORY')),
  quantity numeric(14,4) not null default 1 check(quantity > 0),
  unit_price numeric(14,4) not null default 0 check(unit_price >= 0),
  posting_account_id uuid not null references public.accounting_accounts(id) on delete restrict,
  tax_code_id uuid references public.accounting_tax_codes(id) on delete restrict,
  itc_eligibility text not null default 'FULL' check(itc_eligibility in ('FULL','PARTIAL','NONE','MANUAL')),
  recoverable_percent numeric(7,4) not null default 100 check(recoverable_percent between 0 and 100),
  line_subtotal numeric(14,2) not null default 0 check(line_subtotal >= 0),
  tax_amount numeric(14,2) not null default 0 check(tax_amount >= 0),
  recoverable_tax numeric(14,2) not null default 0 check(recoverable_tax >= 0),
  nonrecoverable_tax numeric(14,2) not null default 0 check(nonrecoverable_tax >= 0),
  line_total numeric(14,2) not null default 0 check(line_total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(tax_amount = round(recoverable_tax + nonrecoverable_tax,2)),
  check(line_total = round(line_subtotal + tax_amount,2))
);
create index if not exists accounting_expense_claim_lines_claim_idx on public.accounting_expense_claim_lines(expense_claim_id,sort_order,id);

create table if not exists public.accounting_expense_reimbursements (
  id uuid primary key default gen_random_uuid(),
  reimbursement_number text not null unique default ('ER-' || lpad(nextval('public.accounting_expense_reimbursement_number_seq')::text,6,'0')),
  expense_claim_id uuid not null references public.accounting_expense_claims(id) on delete restrict,
  payee_party_id uuid not null references public.accounting_parties(id) on delete restrict,
  financial_account_id uuid not null references public.accounting_financial_accounts(id) on delete restrict,
  payment_date date not null default current_date,
  amount numeric(14,2) not null check(amount > 0),
  currency text not null default 'CAD',
  method text,
  reference text,
  notes text,
  status text not null default 'PAID' check(status in ('PAID')),
  created_by text,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists accounting_expense_reimbursements_claim_idx on public.accounting_expense_reimbursements(expense_claim_id,payment_date,id);

-- Keep updated_at current.
drop trigger if exists trg_accounting_expense_claim_touch on public.accounting_expense_claims;
create trigger trg_accounting_expense_claim_touch before update on public.accounting_expense_claims
for each row execute function public.accounting_touch_updated_at();
drop trigger if exists trg_accounting_expense_claim_line_touch on public.accounting_expense_claim_lines;
create trigger trg_accounting_expense_claim_line_touch before update on public.accounting_expense_claim_lines
for each row execute function public.accounting_touch_updated_at();

-- Posted/paid expense financial fields and lines are immutable.
create or replace function public.accounting_protect_expense_claim()
returns trigger language plpgsql set search_path=public,extensions as $$
begin
  if tg_op='DELETE' then
    if old.status in ('POSTED','PAID') then raise exception 'Posted/paid expenses cannot be deleted. Use a controlled accounting correction.'; end if;
    return old;
  end if;
  if old.status in ('POSTED','PAID') then
    if new.expense_date is distinct from old.expense_date or new.posting_date is distinct from old.posting_date
       or new.vendor_party_id is distinct from old.vendor_party_id or new.payee_party_id is distinct from old.payee_party_id
       or new.payment_mode is distinct from old.payment_mode or new.financial_account_id is distinct from old.financial_account_id
       or new.currency is distinct from old.currency or new.subtotal is distinct from old.subtotal
       or new.tax_total is distinct from old.tax_total or new.recoverable_tax is distinct from old.recoverable_tax
       or new.nonrecoverable_tax is distinct from old.nonrecoverable_tax or new.total is distinct from old.total
       or new.receipt_document_id is distinct from old.receipt_document_id or new.receipt_status is distinct from old.receipt_status
       or new.reference is distinct from old.reference or new.description is distinct from old.description
       or new.business_purpose is distinct from old.business_purpose or new.department is distinct from old.department
       or new.project_reference is distinct from old.project_reference then
      raise exception 'Posted/paid expense financial fields are immutable.';
    end if;
    if old.status='PAID' and new.status is distinct from old.status then raise exception 'Paid expense status is immutable.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_accounting_protect_expense_claim on public.accounting_expense_claims;
create trigger trg_accounting_protect_expense_claim before update or delete on public.accounting_expense_claims
for each row execute function public.accounting_protect_expense_claim();

create or replace function public.accounting_protect_expense_claim_line()
returns trigger language plpgsql set search_path=public,extensions as $$
declare v_status text;
begin
  select status into v_status from public.accounting_expense_claims where id=coalesce(new.expense_claim_id,old.expense_claim_id);
  if v_status in ('POSTED','PAID') then raise exception 'Lines of a posted/paid expense are immutable.'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists trg_accounting_protect_expense_claim_line on public.accounting_expense_claim_lines;
create trigger trg_accounting_protect_expense_claim_line before insert or update or delete on public.accounting_expense_claim_lines
for each row execute function public.accounting_protect_expense_claim_line();

create or replace function public.accounting_protect_expense_reimbursement()
returns trigger language plpgsql set search_path=public,extensions as $$
begin
  if tg_op='DELETE' then raise exception 'Paid reimbursements cannot be deleted.'; end if;
  if to_jsonb(new) is distinct from to_jsonb(old) then raise exception 'Paid reimbursements are immutable.'; end if;
  return new;
end $$;
drop trigger if exists trg_accounting_protect_expense_reimbursement on public.accounting_expense_reimbursements;
create trigger trg_accounting_protect_expense_reimbursement before update or delete on public.accounting_expense_reimbursements
for each row execute function public.accounting_protect_expense_reimbursement();

-- Atomic save with server-side totals from normalized lines supplied by the service-role API.
create or replace function public.accounting_save_expense_claim(
  p_id uuid,p_expense_date date,p_posting_date date,p_vendor_party_id uuid,p_payee_party_id uuid,
  p_payment_mode text,p_financial_account_id uuid,p_currency text,p_reference text,p_description text,
  p_business_purpose text,p_department text,p_project_reference text,p_receipt_waiver_reason text,
  p_lines jsonb,p_actor_id text
) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid;v_line jsonb;v_sub numeric(14,2):=0;v_tax numeric(14,2):=0;v_rec numeric(14,2):=0;v_non numeric(14,2):=0;v_total numeric(14,2):=0;v_status text;v_receipt_status text;
begin
  if p_payment_mode not in ('COMPANY_PAID','REIMBURSEMENT') then raise exception 'Invalid expense payment mode.'; end if;
  if p_payment_mode='COMPANY_PAID' and p_financial_account_id is null then raise exception 'Company-paid expense requires a financial account.'; end if;
  if p_payment_mode='REIMBURSEMENT' and p_payee_party_id is null then raise exception 'Reimbursement expense requires a payee.'; end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'At least one expense line is required.'; end if;
  if p_id is not null then
    select status,receipt_status into v_status,v_receipt_status from public.accounting_expense_claims where id=p_id for update;
    if not found then raise exception 'Expense not found.'; end if;
    if v_status not in ('DRAFT','REJECTED') then raise exception 'Only Draft/Rejected expenses may be edited.'; end if;
    v_id:=p_id;
  else
    v_id:=gen_random_uuid();v_receipt_status:='MISSING';
  end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_sub:=v_sub+coalesce((v_line->>'line_subtotal')::numeric,0);
    v_tax:=v_tax+coalesce((v_line->>'tax_amount')::numeric,0);
    v_rec:=v_rec+coalesce((v_line->>'recoverable_tax')::numeric,0);
    v_non:=v_non+coalesce((v_line->>'nonrecoverable_tax')::numeric,0);
    v_total:=v_total+coalesce((v_line->>'line_total')::numeric,0);
  end loop;
  v_sub:=round(v_sub,2);v_tax:=round(v_tax,2);v_rec:=round(v_rec,2);v_non:=round(v_non,2);v_total:=round(v_total,2);
  if v_total<=0 then raise exception 'Expense total must be greater than zero.'; end if;
  if p_id is null then
    insert into public.accounting_expense_claims(id,expense_date,posting_date,vendor_party_id,payee_party_id,payment_mode,financial_account_id,currency,reference,description,business_purpose,department,project_reference,receipt_status,receipt_waiver_reason,subtotal,tax_total,recoverable_tax,nonrecoverable_tax,total,status,created_by)
    values(v_id,coalesce(p_expense_date,current_date),coalesce(p_posting_date,p_expense_date,current_date),p_vendor_party_id,p_payee_party_id,p_payment_mode,p_financial_account_id,upper(coalesce(p_currency,'CAD')),nullif(trim(p_reference),''),p_description,nullif(trim(p_business_purpose),''),nullif(trim(p_department),''),nullif(trim(p_project_reference),''),case when nullif(trim(p_receipt_waiver_reason),'') is null then 'MISSING' else 'WAIVED' end,nullif(trim(p_receipt_waiver_reason),''),v_sub,v_tax,v_rec,v_non,v_total,'DRAFT',p_actor_id);
  else
    update public.accounting_expense_claims set expense_date=coalesce(p_expense_date,current_date),posting_date=coalesce(p_posting_date,p_expense_date,current_date),vendor_party_id=p_vendor_party_id,payee_party_id=p_payee_party_id,payment_mode=p_payment_mode,financial_account_id=p_financial_account_id,currency=upper(coalesce(p_currency,'CAD')),reference=nullif(trim(p_reference),''),description=p_description,business_purpose=nullif(trim(p_business_purpose),''),department=nullif(trim(p_department),''),project_reference=nullif(trim(p_project_reference),''),receipt_status=case when receipt_document_id is not null then 'ATTACHED' when nullif(trim(p_receipt_waiver_reason),'') is not null then 'WAIVED' else 'MISSING' end,receipt_waiver_reason=nullif(trim(p_receipt_waiver_reason),''),subtotal=v_sub,tax_total=v_tax,recoverable_tax=v_rec,nonrecoverable_tax=v_non,total=v_total,status='DRAFT',rejected_at=null,rejected_by=null,rejected_reason=null where id=v_id;
    delete from public.accounting_expense_claim_lines where expense_claim_id=v_id;
  end if;
  insert into public.accounting_expense_claim_lines(expense_claim_id,sort_order,description,classification,quantity,unit_price,posting_account_id,tax_code_id,itc_eligibility,recoverable_percent,line_subtotal,tax_amount,recoverable_tax,nonrecoverable_tax,line_total)
  select v_id,coalesce((x->>'sort_order')::int,0),x->>'description',upper(coalesce(x->>'classification','EXPENSE')),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,(x->>'posting_account_id')::uuid,nullif(x->>'tax_code_id','')::uuid,upper(coalesce(x->>'itc_eligibility','FULL')),coalesce((x->>'recoverable_percent')::numeric,100),(x->>'line_subtotal')::numeric,(x->>'tax_amount')::numeric,(x->>'recoverable_tax')::numeric,(x->>'nonrecoverable_tax')::numeric,(x->>'line_total')::numeric
  from jsonb_array_elements(p_lines) x;
  return v_id;
end $$;

create or replace function public.accounting_expense_claim_action(p_expense_id uuid,p_action text,p_actor_id text,p_reason text default null)
returns text language plpgsql security definer set search_path=public,extensions as $$
declare v public.accounting_expense_claims%rowtype;v_action text:=upper(trim(p_action));v_count int;
begin
  select * into v from public.accounting_expense_claims where id=p_expense_id for update;
  if not found then raise exception 'Expense not found.'; end if;
  if v_action='SUBMIT' then
    if v.status not in ('DRAFT','REJECTED') then raise exception 'Only Draft/Rejected expenses can be submitted.'; end if;
    select count(*) into v_count from public.accounting_expense_claim_lines where expense_claim_id=v.id;
    if v_count=0 then raise exception 'Expense has no lines.'; end if;
    if v.receipt_status='MISSING' then raise exception 'Attach the supporting receipt/invoice or document a receipt waiver before submission.'; end if;
    update public.accounting_expense_claims set status='SUBMITTED',submitted_by=p_actor_id,submitted_at=now() where id=v.id;return 'SUBMITTED';
  elsif v_action='APPROVE' then
    if v.status<>'SUBMITTED' then raise exception 'Only Submitted expenses can be approved.'; end if;
    update public.accounting_expense_claims set status='APPROVED',approved_by=p_actor_id,approved_at=now() where id=v.id;return 'APPROVED';
  elsif v_action='REJECT' then
    if v.status not in ('SUBMITTED','APPROVED') then raise exception 'Only Submitted/Approved expenses can be rejected.'; end if;
    if nullif(trim(p_reason),'') is null then raise exception 'Rejection reason is required.'; end if;
    update public.accounting_expense_claims set status='REJECTED',rejected_by=p_actor_id,rejected_at=now(),rejected_reason=trim(p_reason) where id=v.id;return 'REJECTED';
  elsif v_action='POST' then
    if v.status<>'APPROVED' then raise exception 'Only Approved expenses can be posted.'; end if;
    if v.receipt_status='MISSING' then raise exception 'Supporting document control is incomplete.'; end if;
    if v.payment_mode='COMPANY_PAID' then update public.accounting_expense_claims set status='PAID',posted_by=p_actor_id,posted_at=now(),paid_at=now(),amount_reimbursed=0 where id=v.id;return 'PAID';
    else update public.accounting_expense_claims set status='POSTED',posted_by=p_actor_id,posted_at=now() where id=v.id;return 'POSTED'; end if;
  elsif v_action='VOID' then
    if v.status not in ('DRAFT','REJECTED') then raise exception 'Only Draft/Rejected expenses can be voided without an accounting reversal.'; end if;
    update public.accounting_expense_claims set status='VOID' where id=v.id;return 'VOID';
  else raise exception 'Unsupported expense action %.',v_action; end if;
end $$;

create or replace function public.accounting_record_expense_reimbursement(p_expense_id uuid,p_financial_account_id uuid,p_payment_date date,p_amount numeric,p_method text,p_reference text,p_notes text,p_actor_id text)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v public.accounting_expense_claims%rowtype;v_id uuid;v_paid numeric(14,2);v_remaining numeric(14,2);
begin
  select * into v from public.accounting_expense_claims where id=p_expense_id for update;
  if not found then raise exception 'Expense not found.'; end if;
  if v.payment_mode<>'REIMBURSEMENT' or v.status not in ('POSTED','PAID') then raise exception 'Only posted reimbursement expenses can be reimbursed.'; end if;
  if v.status='PAID' then raise exception 'Expense reimbursement is already fully paid.'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Reimbursement amount must be positive.'; end if;
  select coalesce(sum(amount),0) into v_paid from public.accounting_expense_reimbursements where expense_claim_id=v.id and status='PAID';
  v_remaining:=round(v.total-v_paid,2);
  if round(p_amount,2)>v_remaining+0.001 then raise exception 'Reimbursement exceeds remaining amount %.',v_remaining; end if;
  insert into public.accounting_expense_reimbursements(expense_claim_id,payee_party_id,financial_account_id,payment_date,amount,currency,method,reference,notes,created_by)
  values(v.id,v.payee_party_id,p_financial_account_id,coalesce(p_payment_date,current_date),round(p_amount,2),v.currency,nullif(trim(p_method),''),nullif(trim(p_reference),''),nullif(trim(p_notes),''),p_actor_id)
  returning id into v_id;
  v_paid:=round(v_paid+p_amount,2);
  update public.accounting_expense_claims set amount_reimbursed=v_paid,status=case when v_paid+0.001>=total then 'PAID' else 'POSTED' end,paid_at=case when v_paid+0.001>=total then now() else paid_at end where id=v.id;
  return v_id;
end $$;

-- Durable accounting events.
create or replace function public.accounting_expense_claim_event_trigger()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare v_lines jsonb;
begin
  if new.status in ('POSTED','PAID') and old.status='APPROVED' then
    select coalesce(jsonb_agg(to_jsonb(l) order by l.sort_order,l.id),'[]'::jsonb) into v_lines from public.accounting_expense_claim_lines l where l.expense_claim_id=new.id;
    perform public.accounting_enqueue_event('EXPENSE_POSTED','accounting_expense_claims',new.id::text,new.expense_number,jsonb_build_object('expense_claim',to_jsonb(new),'lines',v_lines),coalesce(new.posted_at,now()),1,new.posted_by,new.id::text,null);
  end if;
  return new;
end $$;
drop trigger if exists trg_step18_4_expense_event on public.accounting_expense_claims;
create trigger trg_step18_4_expense_event after update of status on public.accounting_expense_claims
for each row execute function public.accounting_expense_claim_event_trigger();

create or replace function public.accounting_expense_reimbursement_event_trigger()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
begin
  perform public.accounting_enqueue_event('EXPENSE_REIMBURSEMENT_PAID','accounting_expense_reimbursements',new.id::text,new.reimbursement_number,jsonb_build_object('expense_reimbursement',to_jsonb(new)),coalesce(new.paid_at,new.created_at,now()),1,new.created_by,new.expense_claim_id::text,'PLEASE:EXPENSE_POSTED:'||new.expense_claim_id::text);
  return new;
end $$;
drop trigger if exists trg_step18_4_expense_reimbursement_event on public.accounting_expense_reimbursements;
create trigger trg_step18_4_expense_reimbursement_event after insert on public.accounting_expense_reimbursements
for each row execute function public.accounting_expense_reimbursement_event_trigger();

insert into public.accounting_posting_rules(source_system,event_type,debit_account_code,credit_account_code,tax_account_code,enabled,rule_version,configuration_json)
values
 ('PLEASE','EXPENSE_POSTED','5400','1000','1200',true,1,jsonb_build_object('qst_recoverable_account','1210','reimbursement_payable_account','2020')),
 ('PLEASE','EXPENSE_REIMBURSEMENT_PAID','2020','1000',null,true,1,'{}'::jsonb)
on conflict(source_system,event_type,debit_account_code,credit_account_code) do update set tax_account_code=excluded.tax_account_code,enabled=true,rule_version=greatest(public.accounting_posting_rules.rule_version,excluded.rule_version),configuration_json=excluded.configuration_json;

-- Audit fallback.
create or replace function public.accounting_expense_audit_trigger()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare v_row jsonb;v_id text;v_before jsonb;v_after jsonb;
begin
  if tg_op='DELETE' then v_before=to_jsonb(old);v_after=null;v_row=v_before; elsif tg_op='INSERT' then v_before=null;v_after=to_jsonb(new);v_row=v_after; else v_before=to_jsonb(old);v_after=to_jsonb(new);v_row=v_after; end if;
  v_id=coalesce(v_row->>'id',v_row->>'expense_claim_id','');
  insert into public.accounting_audit_log(event_type,object_type,object_id,before_data,after_data,metadata)
  values('EXPENSE_'||tg_op,tg_table_name,nullif(v_id,''),v_before,v_after,jsonb_build_object('step','18.4','source','DATABASE_TRIGGER'));
  if tg_op='DELETE' then return old; end if;return new;
end $$;
do $$ declare t text;begin foreach t in array array['accounting_expense_claims','accounting_expense_claim_lines','accounting_expense_reimbursements'] loop execute format('drop trigger if exists %I on public.%I','trg_'||t||'_expense_audit',t);execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.accounting_expense_audit_trigger()','trg_'||t||'_expense_audit',t);end loop;end $$;

-- Security.
do $$ declare t text;begin foreach t in array array['accounting_expense_claims','accounting_expense_claim_lines','accounting_expense_reimbursements'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);end loop;end $$;
revoke all on sequence public.accounting_expense_claim_number_seq from anon,authenticated;
revoke all on sequence public.accounting_expense_reimbursement_number_seq from anon,authenticated;
revoke all on function public.accounting_save_expense_claim(uuid,date,date,uuid,uuid,text,uuid,text,text,text,text,text,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.accounting_expense_claim_action(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.accounting_record_expense_reimbursement(uuid,uuid,date,numeric,text,text,text,text) from public,anon,authenticated;
grant execute on function public.accounting_save_expense_claim(uuid,date,date,uuid,uuid,text,uuid,text,text,text,text,text,text,text,jsonb,text) to service_role;
grant execute on function public.accounting_expense_claim_action(uuid,text,text,text) to service_role;
grant execute on function public.accounting_record_expense_reimbursement(uuid,uuid,date,numeric,text,text,text,text) to service_role;

comment on table public.accounting_expense_claims is 'STEP 18.4 controlled direct expenses and reimbursements. Supplier bills remain in Purchases & A/P.';
comment on table public.accounting_expense_claim_lines is 'STEP 18.4 expense lines with GL classification and ITC/recoverable-tax controls.';
comment on table public.accounting_expense_reimbursements is 'STEP 18.4 immutable reimbursement payments against posted reimbursement expenses.';

commit;
