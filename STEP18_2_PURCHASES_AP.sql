-- PLEASE / CAL — STEP 18.2: Purchases & Accounts Payable
-- Safe additive migration. Run AFTER STEP18_1_FINANCIAL_MASTER_DATA.sql.
-- Scope: Supplier Bills, approval/posting workflow, Accounts Payable, supplier payments,
-- and durable STEP 17 accounting events. No changes to PLEASE operational Provider payments.

begin;

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Prerequisites / control accounts
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.accounting_parties') is null or to_regclass('public.accounting_party_roles') is null then
    raise exception 'STEP 18.1 is required before STEP 18.2.';
  end if;
  if to_regclass('public.please_accounting_outbox') is null or to_regprocedure('public.accounting_enqueue_event(text,text,text,text,jsonb,timestamptz,integer,text,text,text)') is null then
    raise exception 'STEP 17 Native Accounting Engine is required before STEP 18.2.';
  end if;
end $$;

insert into public.accounting_accounts(code,name,account_type,account_subtype,active,system_managed,allow_manual_posting)
values
  ('1210','QST Recoverable','ASSET','TAX_RECEIVABLE',true,true,true),
  ('2200','Credit Cards','LIABILITY','CREDIT_CARD',true,false,true)
on conflict(code) do nothing;

update public.accounting_accounts
set system_managed=true, updated_at=now()
where code in ('1200','1210','2000');

-- -----------------------------------------------------------------------------
-- Supplier bill + payment documents
-- -----------------------------------------------------------------------------
create sequence if not exists public.accounting_supplier_bill_number_seq start with 1001;
create sequence if not exists public.accounting_supplier_payment_number_seq start with 1001;

create table if not exists public.accounting_supplier_bills (
  id uuid primary key default gen_random_uuid(),
  bill_number text not null unique default ('BILL-' || lpad(nextval('public.accounting_supplier_bill_number_seq')::text,6,'0')),
  supplier_party_id uuid not null references public.accounting_parties(id) on delete restrict,
  supplier_invoice_number text,
  bill_date date not null default current_date,
  due_date date,
  currency text not null default 'CAD',
  status text not null default 'DRAFT' check(status in ('DRAFT','SUBMITTED','APPROVED','POSTED','PARTIAL','PAID','VOID')),
  subtotal numeric(14,2) not null default 0 check(subtotal >= 0),
  tax_total numeric(14,2) not null default 0 check(tax_total >= 0),
  recoverable_tax numeric(14,2) not null default 0 check(recoverable_tax >= 0),
  total numeric(14,2) not null default 0 check(total >= 0),
  amount_paid numeric(14,2) not null default 0 check(amount_paid >= 0),
  notes text,
  source_reference text,
  source_document_id uuid references public.accounting_documents(id) on delete set null,
  created_by text,
  submitted_by text,
  approved_by text,
  posted_by text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  posted_at timestamptz,
  updated_at timestamptz not null default now(),
  check(due_date is null or due_date >= bill_date),
  check(recoverable_tax <= tax_total + 0.01),
  check(amount_paid <= total + 0.01)
);

create unique index if not exists accounting_supplier_bills_supplier_invoice_uq
on public.accounting_supplier_bills(supplier_party_id,lower(supplier_invoice_number))
where supplier_invoice_number is not null and btrim(supplier_invoice_number)<>'' and status<>'VOID';
create index if not exists accounting_supplier_bills_supplier_idx on public.accounting_supplier_bills(supplier_party_id,status,due_date);
create index if not exists accounting_supplier_bills_status_idx on public.accounting_supplier_bills(status,bill_date desc);

create table if not exists public.accounting_supplier_bill_lines (
  id uuid primary key default gen_random_uuid(),
  supplier_bill_id uuid not null references public.accounting_supplier_bills(id) on delete restrict,
  sort_order integer not null default 0,
  description text not null,
  quantity numeric(14,4) not null default 1 check(quantity > 0),
  unit_price numeric(14,4) not null default 0 check(unit_price >= 0),
  posting_account_id uuid not null references public.accounting_accounts(id) on delete restrict,
  tax_code_id uuid references public.accounting_tax_codes(id) on delete restrict,
  line_subtotal numeric(14,2) not null default 0 check(line_subtotal >= 0),
  tax_amount numeric(14,2) not null default 0 check(tax_amount >= 0),
  recoverable_tax numeric(14,2) not null default 0 check(recoverable_tax >= 0),
  line_total numeric(14,2) not null default 0 check(line_total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(recoverable_tax <= tax_amount + 0.01)
);
create index if not exists accounting_supplier_bill_lines_bill_idx on public.accounting_supplier_bill_lines(supplier_bill_id,sort_order,id);

create table if not exists public.accounting_supplier_payments (
  id uuid primary key default gen_random_uuid(),
  payment_number text not null unique default ('SUPPAY-' || lpad(nextval('public.accounting_supplier_payment_number_seq')::text,6,'0')),
  supplier_bill_id uuid not null references public.accounting_supplier_bills(id) on delete restrict,
  supplier_party_id uuid not null references public.accounting_parties(id) on delete restrict,
  financial_account_id uuid not null references public.accounting_financial_accounts(id) on delete restrict,
  payment_date date not null default current_date,
  amount numeric(14,2) not null check(amount > 0),
  currency text not null default 'CAD',
  method text,
  reference text,
  notes text,
  status text not null default 'PAID' check(status in ('PAID','VOID')),
  created_by text,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists accounting_supplier_payments_bill_idx on public.accounting_supplier_payments(supplier_bill_id,payment_date,id);
create index if not exists accounting_supplier_payments_supplier_idx on public.accounting_supplier_payments(supplier_party_id,payment_date desc);

-- -----------------------------------------------------------------------------
-- Immutable-after-posting protections
-- -----------------------------------------------------------------------------
create or replace function public.accounting_protect_supplier_bill()
returns trigger
language plpgsql
set search_path=public,extensions
as $$
begin
  if tg_op='DELETE' then
    if old.status in ('POSTED','PARTIAL','PAID') then
      raise exception 'Posted supplier bills cannot be deleted. Use a future vendor-credit/reversal workflow.';
    end if;
    return old;
  end if;
  if old.status in ('POSTED','PARTIAL','PAID') then
    if new.supplier_party_id is distinct from old.supplier_party_id
       or new.supplier_invoice_number is distinct from old.supplier_invoice_number
       or new.bill_date is distinct from old.bill_date
       or new.currency is distinct from old.currency
       or new.subtotal is distinct from old.subtotal
       or new.tax_total is distinct from old.tax_total
       or new.recoverable_tax is distinct from old.recoverable_tax
       or new.total is distinct from old.total then
      raise exception 'Posted supplier bill financial fields are immutable.';
    end if;
    if new.status not in ('POSTED','PARTIAL','PAID') then
      raise exception 'Posted supplier bills cannot return to a pre-posting status.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_accounting_protect_supplier_bill on public.accounting_supplier_bills;
create trigger trg_accounting_protect_supplier_bill
before update or delete on public.accounting_supplier_bills
for each row execute function public.accounting_protect_supplier_bill();

create or replace function public.accounting_protect_supplier_bill_line()
returns trigger
language plpgsql
set search_path=public,extensions
as $$
declare v_status text;
begin
  select status into v_status from public.accounting_supplier_bills where id=coalesce(new.supplier_bill_id,old.supplier_bill_id);
  if v_status in ('POSTED','PARTIAL','PAID') then
    raise exception 'Lines of a posted supplier bill are immutable.';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists trg_accounting_protect_supplier_bill_line on public.accounting_supplier_bill_lines;
create trigger trg_accounting_protect_supplier_bill_line
before insert or update or delete on public.accounting_supplier_bill_lines
for each row execute function public.accounting_protect_supplier_bill_line();

create or replace function public.accounting_protect_supplier_payment()
returns trigger
language plpgsql
set search_path=public,extensions
as $$
begin
  if tg_op='DELETE' then raise exception 'Supplier payments cannot be deleted. Use a controlled reversal workflow.'; end if;
  if old.status='PAID' and (
      new.supplier_bill_id is distinct from old.supplier_bill_id
      or new.supplier_party_id is distinct from old.supplier_party_id
      or new.financial_account_id is distinct from old.financial_account_id
      or new.payment_date is distinct from old.payment_date
      or new.amount is distinct from old.amount
      or new.currency is distinct from old.currency
      or new.status is distinct from old.status
  ) then raise exception 'Paid supplier payment financial fields are immutable.'; end if;
  return new;
end $$;

drop trigger if exists trg_accounting_protect_supplier_payment on public.accounting_supplier_payments;
create trigger trg_accounting_protect_supplier_payment
before update or delete on public.accounting_supplier_payments
for each row execute function public.accounting_protect_supplier_payment();

-- -----------------------------------------------------------------------------
-- Atomic draft save. Only DRAFT bills can be edited.
-- Lines are server-normalized before this RPC; SQL re-validates control references.
-- -----------------------------------------------------------------------------
create or replace function public.accounting_save_supplier_bill(
  p_id uuid,
  p_supplier_party_id uuid,
  p_supplier_invoice_number text,
  p_bill_date date,
  p_due_date date,
  p_currency text,
  p_notes text,
  p_source_reference text,
  p_lines jsonb,
  p_actor_id text
) returns uuid
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_id uuid:=p_id;
  v_status text;
  v_line jsonb;
  v_subtotal numeric(14,2):=0;
  v_tax numeric(14,2):=0;
  v_recoverable numeric(14,2):=0;
  v_total numeric(14,2):=0;
  v_count int:=0;
  v_account_type text;
  v_tax_active boolean;
begin
  if not exists(
    select 1 from public.accounting_parties p
    join public.accounting_party_roles r on r.party_id=p.id
    where p.id=p_supplier_party_id and p.active=true and r.role='SUPPLIER' and r.active=true
  ) then raise exception 'Supplier is inactive or does not have an active SUPPLIER role.'; end if;
  if p_due_date is not null and p_due_date < p_bill_date then raise exception 'Due date cannot be before bill date.'; end if;
  if jsonb_typeof(coalesce(p_lines,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_lines,'[]'::jsonb))=0 then
    raise exception 'At least one supplier bill line is required.';
  end if;

  if v_id is null then
    insert into public.accounting_supplier_bills(
      supplier_party_id,supplier_invoice_number,bill_date,due_date,currency,status,notes,source_reference,created_by
    ) values(
      p_supplier_party_id,nullif(btrim(p_supplier_invoice_number),''),coalesce(p_bill_date,current_date),p_due_date,upper(coalesce(nullif(btrim(p_currency),''),'CAD')),'DRAFT',nullif(btrim(p_notes),''),nullif(btrim(p_source_reference),''),p_actor_id
    ) returning id into v_id;
  else
    select status into v_status from public.accounting_supplier_bills where id=v_id for update;
    if v_status is null then raise exception 'Supplier bill not found.'; end if;
    if v_status<>'DRAFT' then raise exception 'Only DRAFT supplier bills can be edited.'; end if;
    update public.accounting_supplier_bills set
      supplier_party_id=p_supplier_party_id,
      supplier_invoice_number=nullif(btrim(p_supplier_invoice_number),''),
      bill_date=coalesce(p_bill_date,current_date),
      due_date=p_due_date,
      currency=upper(coalesce(nullif(btrim(p_currency),''),'CAD')),
      notes=nullif(btrim(p_notes),''),
      source_reference=nullif(btrim(p_source_reference),''),
      updated_at=now()
    where id=v_id;
    delete from public.accounting_supplier_bill_lines where supplier_bill_id=v_id;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_count:=v_count+1;
    select account_type into v_account_type from public.accounting_accounts where id=(v_line->>'posting_account_id')::uuid and active=true;
    if v_account_type not in ('EXPENSE','ASSET') then raise exception 'Purchase line % must post to an active EXPENSE or ASSET account.',v_count; end if;
    if nullif(v_line->>'tax_code_id','') is not null then
      select active into v_tax_active from public.accounting_tax_codes where id=(v_line->>'tax_code_id')::uuid;
      if coalesce(v_tax_active,false)=false then raise exception 'Purchase line % uses an inactive or missing tax code.',v_count; end if;
    end if;
    if coalesce((v_line->>'quantity')::numeric,0)<=0 or coalesce((v_line->>'unit_price')::numeric,0)<0 then raise exception 'Invalid quantity or price on purchase line %.',v_count; end if;
    if coalesce((v_line->>'line_subtotal')::numeric,0)<0 or coalesce((v_line->>'tax_amount')::numeric,0)<0 or coalesce((v_line->>'recoverable_tax')::numeric,0)<0 then raise exception 'Negative amount on purchase line %.',v_count; end if;
    if coalesce((v_line->>'recoverable_tax')::numeric,0) > coalesce((v_line->>'tax_amount')::numeric,0)+0.01 then raise exception 'Recoverable tax exceeds tax on purchase line %.',v_count; end if;
    if abs(coalesce((v_line->>'line_total')::numeric,0) - (coalesce((v_line->>'line_subtotal')::numeric,0)+coalesce((v_line->>'tax_amount')::numeric,0))) > 0.02 then raise exception 'Purchase line % total is inconsistent.',v_count; end if;

    insert into public.accounting_supplier_bill_lines(
      supplier_bill_id,sort_order,description,quantity,unit_price,posting_account_id,tax_code_id,line_subtotal,tax_amount,recoverable_tax,line_total
    ) values(
      v_id,coalesce((v_line->>'sort_order')::int,v_count),coalesce(nullif(btrim(v_line->>'description'),''),'Purchase'),
      (v_line->>'quantity')::numeric,(v_line->>'unit_price')::numeric,(v_line->>'posting_account_id')::uuid,
      nullif(v_line->>'tax_code_id','')::uuid,(v_line->>'line_subtotal')::numeric,(v_line->>'tax_amount')::numeric,
      (v_line->>'recoverable_tax')::numeric,(v_line->>'line_total')::numeric
    );
    v_subtotal:=v_subtotal+round((v_line->>'line_subtotal')::numeric,2);
    v_tax:=v_tax+round((v_line->>'tax_amount')::numeric,2);
    v_recoverable:=v_recoverable+round((v_line->>'recoverable_tax')::numeric,2);
    v_total:=v_total+round((v_line->>'line_total')::numeric,2);
  end loop;

  update public.accounting_supplier_bills set subtotal=round(v_subtotal,2),tax_total=round(v_tax,2),recoverable_tax=round(v_recoverable,2),total=round(v_total,2),updated_at=now() where id=v_id;
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- Workflow transitions. Posting is the only bill transition that creates a GL event.
-- -----------------------------------------------------------------------------
create or replace function public.accounting_supplier_bill_action(
  p_bill_id uuid,
  p_action text,
  p_actor_id text
) returns text
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_bill public.accounting_supplier_bills%rowtype;
  v_action text:=upper(btrim(coalesce(p_action,'')));
begin
  select * into v_bill from public.accounting_supplier_bills where id=p_bill_id for update;
  if not found then raise exception 'Supplier bill not found.'; end if;

  if v_action='SUBMIT' then
    if v_bill.status<>'DRAFT' then raise exception 'Only DRAFT supplier bills can be submitted.'; end if;
    if v_bill.total<=0 then raise exception 'A zero-value supplier bill cannot be submitted.'; end if;
    update public.accounting_supplier_bills set status='SUBMITTED',submitted_by=p_actor_id,submitted_at=now(),updated_at=now() where id=p_bill_id;
  elsif v_action='APPROVE' then
    if v_bill.status<>'SUBMITTED' then raise exception 'Only SUBMITTED supplier bills can be approved.'; end if;
    update public.accounting_supplier_bills set status='APPROVED',approved_by=p_actor_id,approved_at=now(),updated_at=now() where id=p_bill_id;
  elsif v_action='RETURN_TO_DRAFT' then
    if v_bill.status not in ('SUBMITTED','APPROVED') then raise exception 'Only SUBMITTED or APPROVED bills can return to draft.'; end if;
    update public.accounting_supplier_bills set status='DRAFT',submitted_by=null,submitted_at=null,approved_by=null,approved_at=null,updated_at=now() where id=p_bill_id;
  elsif v_action='POST' then
    if v_bill.status<>'APPROVED' then raise exception 'Only APPROVED supplier bills can be posted.'; end if;
    update public.accounting_supplier_bills set status='POSTED',posted_by=p_actor_id,posted_at=now(),updated_at=now() where id=p_bill_id;
  elsif v_action='VOID' then
    if v_bill.status not in ('DRAFT','SUBMITTED','APPROVED') then raise exception 'Only unposted supplier bills can be voided in STEP 18.2.'; end if;
    update public.accounting_supplier_bills set status='VOID',updated_at=now() where id=p_bill_id;
  else
    raise exception 'Unsupported supplier bill action: %',v_action;
  end if;
  return (select status from public.accounting_supplier_bills where id=p_bill_id);
end $$;

-- -----------------------------------------------------------------------------
-- Atomic supplier payment. Insert + AP balance/status update + durable event happen
-- in one PostgreSQL transaction. Overpayments are rejected.
-- -----------------------------------------------------------------------------
create or replace function public.accounting_record_supplier_payment(
  p_bill_id uuid,
  p_financial_account_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_method text,
  p_reference text,
  p_notes text,
  p_actor_id text
) returns uuid
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_bill public.accounting_supplier_bills%rowtype;
  v_payment_id uuid;
  v_paid numeric(14,2);
  v_remaining numeric(14,2);
  v_fin_currency text;
  v_fin_active boolean;
begin
  select * into v_bill from public.accounting_supplier_bills where id=p_bill_id for update;
  if not found then raise exception 'Supplier bill not found.'; end if;
  if v_bill.status not in ('POSTED','PARTIAL') then raise exception 'Only POSTED or PARTIAL supplier bills can be paid.'; end if;
  if coalesce(p_amount,0)<=0 then raise exception 'Supplier payment amount must be positive.'; end if;
  select currency,active into v_fin_currency,v_fin_active from public.accounting_financial_accounts where id=p_financial_account_id;
  if coalesce(v_fin_active,false)=false then raise exception 'Financial account is inactive or missing.'; end if;
  if upper(coalesce(v_fin_currency,'CAD'))<>upper(coalesce(v_bill.currency,'CAD')) then raise exception 'Supplier bill and payment account currencies must match in STEP 18.2.'; end if;

  select coalesce(sum(amount),0) into v_paid from public.accounting_supplier_payments where supplier_bill_id=p_bill_id and status='PAID';
  v_remaining:=round(v_bill.total-v_paid,2);
  if round(p_amount,2)>v_remaining+0.001 then raise exception 'Supplier payment exceeds the outstanding balance of %.',v_remaining; end if;

  insert into public.accounting_supplier_payments(
    supplier_bill_id,supplier_party_id,financial_account_id,payment_date,amount,currency,method,reference,notes,status,created_by,paid_at
  ) values(
    p_bill_id,v_bill.supplier_party_id,p_financial_account_id,coalesce(p_payment_date,current_date),round(p_amount,2),v_bill.currency,
    nullif(btrim(p_method),''),nullif(btrim(p_reference),''),nullif(btrim(p_notes),''),'PAID',p_actor_id,now()
  ) returning id into v_payment_id;

  v_paid:=round(v_paid+round(p_amount,2),2);
  update public.accounting_supplier_bills
  set amount_paid=v_paid,status=case when v_paid+0.001>=total then 'PAID' else 'PARTIAL' end,updated_at=now()
  where id=p_bill_id;
  return v_payment_id;
end $$;

-- -----------------------------------------------------------------------------
-- STEP 17 durable events
-- -----------------------------------------------------------------------------
create or replace function public.accounting_supplier_bill_event_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,extensions
as $$
declare v_lines jsonb;
begin
  if new.status='POSTED' and old.status is distinct from new.status then
    select coalesce(jsonb_agg(to_jsonb(l) order by l.sort_order,l.id),'[]'::jsonb) into v_lines
    from public.accounting_supplier_bill_lines l where l.supplier_bill_id=new.id;
    perform public.accounting_enqueue_event(
      'VENDOR_BILL_POSTED','accounting_supplier_bills',new.id::text,new.bill_number,
      jsonb_build_object('supplier_bill',to_jsonb(new),'lines',v_lines),coalesce(new.posted_at,now()),1,new.posted_by,new.id::text,null
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_step18_2_supplier_bill_event on public.accounting_supplier_bills;
create trigger trg_step18_2_supplier_bill_event
after update of status on public.accounting_supplier_bills
for each row execute function public.accounting_supplier_bill_event_trigger();

create or replace function public.accounting_supplier_payment_event_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,extensions
as $$
begin
  if new.status='PAID' then
    perform public.accounting_enqueue_event(
      'SUPPLIER_PAYMENT_PAID','accounting_supplier_payments',new.id::text,new.payment_number,
      jsonb_build_object('supplier_payment',to_jsonb(new)),coalesce(new.paid_at,new.created_at,now()),1,new.created_by,new.supplier_bill_id::text,
      'PLEASE:VENDOR_BILL_POSTED:'||new.supplier_bill_id::text
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_step18_2_supplier_payment_event on public.accounting_supplier_payments;
create trigger trg_step18_2_supplier_payment_event
after insert on public.accounting_supplier_payments
for each row execute function public.accounting_supplier_payment_event_trigger();

-- Posting rules register the new event families. Line-level account selection is
-- resolved by the worker from the immutable supplier-bill snapshot/current record.
insert into public.accounting_posting_rules(source_system,event_type,debit_account_code,credit_account_code,tax_account_code,enabled,rule_version,configuration_json)
values
('PLEASE','VENDOR_BILL_POSTED','5400','2000','1200',true,1,jsonb_build_object('qst_recoverable_account','1210')),
('PLEASE','SUPPLIER_PAYMENT_PAID','2000','1000',null,true,1,'{}'::jsonb)
on conflict(source_system,event_type,debit_account_code,credit_account_code) do update set
  debit_account_code=excluded.debit_account_code,
  credit_account_code=excluded.credit_account_code,
  tax_account_code=excluded.tax_account_code,
  enabled=true,
  rule_version=greatest(public.accounting_posting_rules.rule_version,excluded.rule_version),
  configuration_json=excluded.configuration_json;

-- -----------------------------------------------------------------------------
-- Audit fallback
-- -----------------------------------------------------------------------------
create or replace function public.accounting_purchase_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,extensions
as $$
declare v_row jsonb; v_id text; v_before jsonb; v_after jsonb;
begin
  if tg_op='DELETE' then v_before=to_jsonb(old);v_after=null;v_row=v_before;
  elsif tg_op='INSERT' then v_before=null;v_after=to_jsonb(new);v_row=v_after;
  else v_before=to_jsonb(old);v_after=to_jsonb(new);v_row=v_after; end if;
  v_id=coalesce(v_row->>'id',v_row->>'supplier_bill_id','');
  insert into public.accounting_audit_log(event_type,object_type,object_id,before_data,after_data,metadata)
  values('PURCHASES_'||tg_op,tg_table_name,nullif(v_id,''),v_before,v_after,jsonb_build_object('step','18.2','source','DATABASE_TRIGGER'));
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['accounting_supplier_bills','accounting_supplier_bill_lines','accounting_supplier_payments'] loop
    execute format('drop trigger if exists %I on public.%I','trg_'||t||'_purchase_audit',t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.accounting_purchase_audit_trigger()','trg_'||t||'_purchase_audit',t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Security
-- -----------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['accounting_supplier_bills','accounting_supplier_bill_lines','accounting_supplier_payments'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
  end loop;
end $$;
revoke all on sequence public.accounting_supplier_bill_number_seq from anon,authenticated;
revoke all on sequence public.accounting_supplier_payment_number_seq from anon,authenticated;
revoke all on function public.accounting_save_supplier_bill(uuid,uuid,text,date,date,text,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.accounting_supplier_bill_action(uuid,text,text) from public,anon,authenticated;
revoke all on function public.accounting_record_supplier_payment(uuid,uuid,date,numeric,text,text,text,text) from public,anon,authenticated;
grant execute on function public.accounting_save_supplier_bill(uuid,uuid,text,date,date,text,text,text,jsonb,text) to service_role;
grant execute on function public.accounting_supplier_bill_action(uuid,text,text) to service_role;
grant execute on function public.accounting_record_supplier_payment(uuid,uuid,date,numeric,text,text,text,text) to service_role;

comment on table public.accounting_supplier_bills is 'STEP 18.2 supplier invoices / purchase bills. Separate from PLEASE operational provider_payments.';
comment on table public.accounting_supplier_payments is 'STEP 18.2 payments against supplier AP. Provider workforce payments remain in provider_payments.';
comment on function public.accounting_record_supplier_payment(uuid,uuid,date,numeric,text,text,text,text) is 'Atomically records supplier payment, updates AP status/balance and enqueues durable accounting event via trigger.';

commit;
