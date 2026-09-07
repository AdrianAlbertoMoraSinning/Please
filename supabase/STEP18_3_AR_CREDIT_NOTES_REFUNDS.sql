-- PLEASE / CAL — STEP 18.3: Accounts Receivable + Credit Notes + Refunds
-- Safe additive migration. Run AFTER STEP18_2_PURCHASES_AP.sql and STEP18_2_1_AR_PAYMENT_INTEGRITY_FIX.sql.
-- Scope: customer A/R master linkage, complete credit-note workflow, customer-credit controls,
-- completed refund accounting, and durable STEP 17 events.
-- This migration does NOT alter Stripe charge creation, payment_transactions, provider_payments,
-- supplier A/P, operational invoice amounts, or posted journal history.

begin;

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Prerequisites
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.accounting_parties') is null or to_regclass('public.accounting_party_roles') is null then
    raise exception 'STEP 18.1 Financial Master Data is required before STEP 18.3.';
  end if;
  if to_regclass('public.please_accounting_outbox') is null
     or to_regprocedure('public.accounting_enqueue_event(text,text,text,text,jsonb,timestamptz,integer,text,text,text)') is null then
    raise exception 'STEP 17 Native Accounting Engine is required before STEP 18.3.';
  end if;
  if to_regclass('public.accounting_invoices') is null or to_regclass('public.accounting_payments') is null then
    raise exception 'CAL invoice/payment accounting mirror is required before STEP 18.3.';
  end if;
end $$;

-- QST payable is additive preparation for Quebec tax credits. Existing Alberta postings remain on 2100.
insert into public.accounting_accounts(code,name,account_type,account_subtype,active,system_managed,allow_manual_posting)
values ('2110','QST Payable','LIABILITY','TAX_PAYABLE',true,true,true)
on conflict(code) do nothing;

update public.accounting_accounts
set system_managed=true,updated_at=now()
where code in ('1100','2100','2110','4000');

-- -----------------------------------------------------------------------------
-- A/R master linkage: preserve legacy contact_id while linking to STEP 18.1 Party Master.
-- -----------------------------------------------------------------------------
alter table public.accounting_invoices add column if not exists party_id uuid references public.accounting_parties(id) on delete set null;
alter table public.accounting_invoices add column if not exists source_invoice_id text;
create index if not exists accounting_invoices_party_idx on public.accounting_invoices(party_id,invoice_date,status);
create unique index if not exists accounting_invoices_source_invoice_uidx on public.accounting_invoices(source_invoice_id) where source_invoice_id is not null;

-- Backfill existing PLEASE invoice mirrors without changing operational invoices.
do $$
begin
  if to_regclass('public.invoices') is not null then
    update public.accounting_invoices ai
    set source_invoice_id=i.id::text,
        party_id=coalesce(ai.party_id,p.id),
        updated_at=now()
    from public.invoices i
    left join public.accounting_parties p
      on p.source_system='PLEASE'
     and p.source_table='customers'
     and p.source_record_id=i.customer_id::text
    where ai.invoice_number=i.invoice_number
      and (ai.source_invoice_id is distinct from i.id::text or (ai.party_id is null and p.id is not null));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Credit Note documents
-- -----------------------------------------------------------------------------
create sequence if not exists public.accounting_credit_note_number_seq start with 1001;
create sequence if not exists public.accounting_customer_refund_number_seq start with 1001;

create table if not exists public.accounting_credit_notes (
  id uuid primary key default gen_random_uuid(),
  credit_note_number text not null unique default ('CN-' || lpad(nextval('public.accounting_credit_note_number_seq')::text,6,'0')),
  invoice_id uuid not null references public.accounting_invoices(id) on delete restrict,
  customer_party_id uuid not null references public.accounting_parties(id) on delete restrict,
  credit_date date not null default current_date,
  status text not null default 'DRAFT' check(status in ('DRAFT','SUBMITTED','APPROVED','POSTED','VOID')),
  reason_code text not null default 'OTHER' check(reason_code in ('RETURN','PRICE_ADJUSTMENT','SERVICE_ADJUSTMENT','TAX_CORRECTION','CUSTOMER_SERVICE','OTHER')),
  reason text not null,
  tax_adjustment_included boolean not null default true,
  subtotal_reduction numeric(14,2) not null default 0 check(subtotal_reduction >= 0),
  tax_reduction numeric(14,2) not null default 0 check(tax_reduction >= 0),
  total numeric(14,2) not null default 0 check(total > 0),
  currency text not null default 'CAD',
  source_reference text,
  created_by text,
  submitted_by text,
  approved_by text,
  posted_by text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  posted_at timestamptz,
  updated_at timestamptz not null default now(),
  check(total = round(subtotal_reduction + tax_reduction,2))
);
create index if not exists accounting_credit_notes_invoice_idx on public.accounting_credit_notes(invoice_id,status,credit_date,id);
create index if not exists accounting_credit_notes_customer_idx on public.accounting_credit_notes(customer_party_id,status,credit_date desc);

create table if not exists public.accounting_credit_note_lines (
  id uuid primary key default gen_random_uuid(),
  credit_note_id uuid not null references public.accounting_credit_notes(id) on delete restrict,
  original_invoice_line_id uuid references public.accounting_invoice_lines(id) on delete set null,
  sort_order integer not null default 0,
  description text not null,
  quantity numeric(14,4) not null default 1 check(quantity > 0),
  unit_price numeric(14,4) not null default 0 check(unit_price >= 0),
  revenue_account_id uuid not null references public.accounting_accounts(id) on delete restrict,
  tax_code_id uuid references public.accounting_tax_codes(id) on delete restrict,
  tax_amount_override numeric(14,2),
  line_subtotal numeric(14,2) not null default 0 check(line_subtotal >= 0),
  line_tax numeric(14,2) not null default 0 check(line_tax >= 0),
  line_total numeric(14,2) not null default 0 check(line_total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(tax_amount_override is null or tax_amount_override >= 0),
  check(line_total = round(line_subtotal + line_tax,2))
);
create index if not exists accounting_credit_note_lines_note_idx on public.accounting_credit_note_lines(credit_note_id,sort_order,id);

-- Refunds are recorded only after money was actually returned. They do not mutate the original
-- successful payment transaction; the original payment remains historically true.
create table if not exists public.accounting_customer_refunds (
  id uuid primary key default gen_random_uuid(),
  refund_number text not null unique default ('REF-' || lpad(nextval('public.accounting_customer_refund_number_seq')::text,6,'0')),
  customer_party_id uuid not null references public.accounting_parties(id) on delete restrict,
  credit_note_id uuid references public.accounting_credit_notes(id) on delete restrict,
  financial_account_id uuid not null references public.accounting_financial_accounts(id) on delete restrict,
  refund_date date not null default current_date,
  amount numeric(14,2) not null check(amount > 0),
  currency text not null default 'CAD',
  method text,
  reference text,
  notes text,
  status text not null default 'COMPLETED' check(status in ('COMPLETED')),
  created_by text,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists accounting_customer_refunds_customer_idx on public.accounting_customer_refunds(customer_party_id,refund_date desc,id);
create index if not exists accounting_customer_refunds_credit_note_idx on public.accounting_customer_refunds(credit_note_id) where credit_note_id is not null;

-- -----------------------------------------------------------------------------
-- Immutability after posting/completion
-- -----------------------------------------------------------------------------
create or replace function public.accounting_protect_credit_note()
returns trigger
language plpgsql
set search_path=public,extensions
as $$
begin
  if tg_op='DELETE' then
    if old.status='POSTED' then raise exception 'Posted credit notes cannot be deleted. Use a controlled accounting correction.'; end if;
    return old;
  end if;
  if old.status='POSTED' then
    if new.invoice_id is distinct from old.invoice_id
       or new.customer_party_id is distinct from old.customer_party_id
       or new.credit_date is distinct from old.credit_date
       or new.reason_code is distinct from old.reason_code
       or new.reason is distinct from old.reason
       or new.tax_adjustment_included is distinct from old.tax_adjustment_included
       or new.subtotal_reduction is distinct from old.subtotal_reduction
       or new.tax_reduction is distinct from old.tax_reduction
       or new.total is distinct from old.total
       or new.currency is distinct from old.currency
       or new.status is distinct from old.status then
      raise exception 'Posted credit note financial fields are immutable.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_accounting_protect_credit_note on public.accounting_credit_notes;
create trigger trg_accounting_protect_credit_note
before update or delete on public.accounting_credit_notes
for each row execute function public.accounting_protect_credit_note();

create or replace function public.accounting_protect_credit_note_line()
returns trigger
language plpgsql
set search_path=public,extensions
as $$
declare v_status text;
begin
  select status into v_status from public.accounting_credit_notes where id=coalesce(new.credit_note_id,old.credit_note_id);
  if v_status='POSTED' then raise exception 'Lines of a posted credit note are immutable.'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists trg_accounting_protect_credit_note_line on public.accounting_credit_note_lines;
create trigger trg_accounting_protect_credit_note_line
before insert or update or delete on public.accounting_credit_note_lines
for each row execute function public.accounting_protect_credit_note_line();

create or replace function public.accounting_protect_customer_refund()
returns trigger
language plpgsql
set search_path=public,extensions
as $$
begin
  if tg_op='DELETE' then raise exception 'Completed customer refunds cannot be deleted. Use a controlled correction workflow.'; end if;
  if to_jsonb(new) is distinct from to_jsonb(old) then raise exception 'Completed customer refunds are immutable.'; end if;
  return new;
end $$;

drop trigger if exists trg_accounting_protect_customer_refund on public.accounting_customer_refunds;
create trigger trg_accounting_protect_customer_refund
before update or delete on public.accounting_customer_refunds
for each row execute function public.accounting_protect_customer_refund();

-- -----------------------------------------------------------------------------
-- Atomic Credit Note save. All financial line calculations are repeated server-side.
-- -----------------------------------------------------------------------------
create or replace function public.accounting_save_credit_note(
  p_id uuid,
  p_invoice_id uuid,
  p_credit_date date,
  p_reason_code text,
  p_reason text,
  p_tax_adjustment_included boolean,
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
  v_invoice public.accounting_invoices%rowtype;
  v_party_id uuid;
  v_status text;
  v_line record;
  v_account_type text;
  v_tax public.accounting_tax_codes%rowtype;
  v_subtotal numeric(14,2):=0;
  v_tax_total numeric(14,2):=0;
  v_total numeric(14,2):=0;
  v_line_sub numeric(14,2);
  v_line_tax numeric(14,2);
  v_rate numeric(12,5);
  v_prior_sub numeric(14,2):=0;
  v_prior_tax numeric(14,2):=0;
  v_prior_total numeric(14,2):=0;
  v_reason text:=upper(coalesce(nullif(btrim(p_reason_code),''),'OTHER'));
begin
  select * into v_invoice from public.accounting_invoices where id=p_invoice_id for update;
  if not found then raise exception 'Accounting invoice not found.'; end if;
  if v_invoice.status='VOID' then raise exception 'A void invoice cannot receive a credit note.'; end if;
  v_party_id:=v_invoice.party_id;
  if v_party_id is null then raise exception 'Invoice is not linked to a Customer Business Partner. Run STEP 18.3 backfill/verification.'; end if;
  if v_reason not in ('RETURN','PRICE_ADJUSTMENT','SERVICE_ADJUSTMENT','TAX_CORRECTION','CUSTOMER_SERVICE','OTHER') then raise exception 'Invalid credit note reason code.'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'Credit note reason is required.'; end if;
  if jsonb_typeof(coalesce(p_lines,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_lines,'[]'::jsonb))=0 then raise exception 'At least one credit note line is required.'; end if;
  if jsonb_array_length(p_lines)>100 then raise exception 'A credit note cannot exceed 100 lines.'; end if;

  if v_id is not null then
    select status into v_status from public.accounting_credit_notes where id=v_id for update;
    if not found then raise exception 'Credit note not found.'; end if;
    if v_status<>'DRAFT' then raise exception 'Only DRAFT credit notes can be edited.'; end if;
    if exists(select 1 from public.accounting_credit_notes where id=v_id and invoice_id<>p_invoice_id) then raise exception 'Credit note invoice cannot be changed after creation.'; end if;
  end if;

  select coalesce(sum(subtotal_reduction),0),coalesce(sum(tax_reduction),0),coalesce(sum(total),0)
    into v_prior_sub,v_prior_tax,v_prior_total
  from public.accounting_credit_notes
  where invoice_id=p_invoice_id and status='POSTED' and (v_id is null or id<>v_id);

  for v_line in
    select * from jsonb_to_recordset(p_lines) as x(
      sort_order integer,
      original_invoice_line_id uuid,
      description text,
      quantity numeric,
      unit_price numeric,
      revenue_account_id uuid,
      tax_code_id uuid,
      tax_amount_override numeric
    )
  loop
    if nullif(btrim(v_line.description),'') is null then raise exception 'Credit note line description is required.'; end if;
    if coalesce(v_line.quantity,0)<=0 or coalesce(v_line.unit_price,0)<0 then raise exception 'Credit note line quantity/unit price is invalid.'; end if;
    select account_type into v_account_type from public.accounting_accounts where id=v_line.revenue_account_id and active=true;
    if v_account_type is distinct from 'REVENUE' then raise exception 'Credit note lines must use an active REVENUE account.'; end if;
    if v_line.original_invoice_line_id is not null and not exists(select 1 from public.accounting_invoice_lines where id=v_line.original_invoice_line_id and invoice_id=p_invoice_id) then
      raise exception 'Original invoice line does not belong to the selected invoice.';
    end if;

    v_line_sub:=round(coalesce(v_line.quantity,0)*coalesce(v_line.unit_price,0),2);
    v_line_tax:=0;
    if coalesce(p_tax_adjustment_included,true) then
      if v_line.tax_code_id is null then
        if coalesce(v_line.tax_amount_override,0)>0 then raise exception 'A tax code is required when crediting sales tax.'; end if;
      else
        select * into v_tax from public.accounting_tax_codes where id=v_line.tax_code_id and active=true;
        if not found then raise exception 'Credit note tax code is inactive or missing.'; end if;
        if v_tax.effective_from>v_invoice.invoice_date or (v_tax.effective_to is not null and v_tax.effective_to<v_invoice.invoice_date) then
          raise exception 'Credit note tax code was not effective on the original invoice date.';
        end if;
        v_rate:=coalesce(v_tax.federal_rate,0)+coalesce(v_tax.provincial_rate,0);
        if v_line.tax_amount_override is not null then v_line_tax:=round(v_line.tax_amount_override,2);
        else v_line_tax:=round(v_line_sub*v_rate/100.0,2);
        end if;
      end if;
    end if;
    if v_line_sub<=0 and v_line_tax<=0 then raise exception 'Each credit note line must reduce consideration or tax.'; end if;
    v_subtotal:=round(v_subtotal+v_line_sub,2);
    v_tax_total:=round(v_tax_total+v_line_tax,2);
  end loop;
  v_total:=round(v_subtotal+v_tax_total,2);
  if v_total<=0 then raise exception 'Credit note total must be positive.'; end if;
  if v_subtotal>round(v_invoice.subtotal-v_prior_sub,2)+0.01 then raise exception 'Credit note subtotal exceeds the remaining creditable invoice subtotal.'; end if;
  if v_tax_total>round(v_invoice.tax_total-v_prior_tax,2)+0.01 then raise exception 'Credit note tax exceeds the remaining creditable invoice tax.'; end if;
  if v_total>round(v_invoice.total-v_prior_total,2)+0.01 then raise exception 'Credit note total exceeds the remaining creditable invoice amount.'; end if;

  if v_id is null then
    insert into public.accounting_credit_notes(
      invoice_id,customer_party_id,credit_date,status,reason_code,reason,tax_adjustment_included,
      subtotal_reduction,tax_reduction,total,currency,source_reference,created_by
    ) values(
      p_invoice_id,v_party_id,coalesce(p_credit_date,current_date),'DRAFT',v_reason,btrim(p_reason),coalesce(p_tax_adjustment_included,true),
      v_subtotal,v_tax_total,v_total,v_invoice.currency,nullif(btrim(p_source_reference),''),p_actor_id
    ) returning id into v_id;
  else
    update public.accounting_credit_notes set
      credit_date=coalesce(p_credit_date,current_date),reason_code=v_reason,reason=btrim(p_reason),
      tax_adjustment_included=coalesce(p_tax_adjustment_included,true),subtotal_reduction=v_subtotal,
      tax_reduction=v_tax_total,total=v_total,source_reference=nullif(btrim(p_source_reference),''),updated_at=now()
    where id=v_id;
    delete from public.accounting_credit_note_lines where credit_note_id=v_id;
  end if;

  for v_line in
    select * from jsonb_to_recordset(p_lines) as x(
      sort_order integer,
      original_invoice_line_id uuid,
      description text,
      quantity numeric,
      unit_price numeric,
      revenue_account_id uuid,
      tax_code_id uuid,
      tax_amount_override numeric
    )
  loop
    v_line_sub:=round(coalesce(v_line.quantity,0)*coalesce(v_line.unit_price,0),2);
    v_line_tax:=0;
    if coalesce(p_tax_adjustment_included,true) and v_line.tax_code_id is not null then
      select * into v_tax from public.accounting_tax_codes where id=v_line.tax_code_id and active=true;
      v_rate:=coalesce(v_tax.federal_rate,0)+coalesce(v_tax.provincial_rate,0);
      if v_line.tax_amount_override is not null then v_line_tax:=round(v_line.tax_amount_override,2);
      else v_line_tax:=round(v_line_sub*v_rate/100.0,2);
      end if;
    end if;
    insert into public.accounting_credit_note_lines(
      credit_note_id,original_invoice_line_id,sort_order,description,quantity,unit_price,revenue_account_id,tax_code_id,tax_amount_override,line_subtotal,line_tax,line_total
    ) values(
      v_id,v_line.original_invoice_line_id,coalesce(v_line.sort_order,0),btrim(v_line.description),v_line.quantity,v_line.unit_price,v_line.revenue_account_id,v_line.tax_code_id,v_line.tax_amount_override,
      v_line_sub,v_line_tax,round(v_line_sub+v_line_tax,2)
    );
  end loop;

  return v_id;
end $$;

create or replace function public.accounting_credit_note_action(
  p_credit_note_id uuid,
  p_action text,
  p_actor_id text
) returns text
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_note public.accounting_credit_notes%rowtype;
  v_action text:=upper(coalesce(p_action,''));
  v_prior_sub numeric(14,2):=0;
  v_prior_tax numeric(14,2):=0;
  v_prior_total numeric(14,2):=0;
begin
  select * into v_note from public.accounting_credit_notes where id=p_credit_note_id for update;
  if not found then raise exception 'Credit note not found.'; end if;

  if v_action='SUBMIT' then
    if v_note.status<>'DRAFT' then raise exception 'Only DRAFT credit notes can be submitted.'; end if;
    update public.accounting_credit_notes set status='SUBMITTED',submitted_by=p_actor_id,submitted_at=now(),updated_at=now() where id=p_credit_note_id;
  elsif v_action='APPROVE' then
    if v_note.status<>'SUBMITTED' then raise exception 'Only SUBMITTED credit notes can be approved.'; end if;
    update public.accounting_credit_notes set status='APPROVED',approved_by=p_actor_id,approved_at=now(),updated_at=now() where id=p_credit_note_id;
  elsif v_action='RETURN_TO_DRAFT' then
    if v_note.status not in ('SUBMITTED','APPROVED') then raise exception 'Only SUBMITTED or APPROVED credit notes can return to Draft.'; end if;
    update public.accounting_credit_notes set status='DRAFT',submitted_by=null,submitted_at=null,approved_by=null,approved_at=null,updated_at=now() where id=p_credit_note_id;
  elsif v_action='POST' then
    if v_note.status<>'APPROVED' then raise exception 'Only APPROVED credit notes can be posted.'; end if;
    -- Serialize postings for the same invoice so concurrent approved notes cannot over-credit it.
    perform 1 from public.accounting_invoices where id=v_note.invoice_id for update;
    select coalesce(sum(subtotal_reduction),0),coalesce(sum(tax_reduction),0),coalesce(sum(total),0)
      into v_prior_sub,v_prior_tax,v_prior_total
    from public.accounting_credit_notes
    where invoice_id=v_note.invoice_id and status='POSTED' and id<>v_note.id;
    if round(v_prior_sub+v_note.subtotal_reduction,2)>(select subtotal+0.01 from public.accounting_invoices where id=v_note.invoice_id) then
      raise exception 'Posted credit notes would exceed the original invoice subtotal.';
    end if;
    if round(v_prior_tax+v_note.tax_reduction,2)>(select tax_total+0.01 from public.accounting_invoices where id=v_note.invoice_id) then
      raise exception 'Posted credit notes would exceed the original invoice tax.';
    end if;
    if round(v_prior_total+v_note.total,2)>(select total+0.01 from public.accounting_invoices where id=v_note.invoice_id) then
      raise exception 'Posted credit notes would exceed the original invoice total.';
    end if;
    update public.accounting_credit_notes set status='POSTED',posted_by=p_actor_id,posted_at=now(),updated_at=now() where id=p_credit_note_id;
  elsif v_action='VOID' then
    if v_note.status not in ('DRAFT','SUBMITTED','APPROVED') then raise exception 'Only unposted credit notes can be voided.'; end if;
    update public.accounting_credit_notes set status='VOID',updated_at=now() where id=p_credit_note_id;
  else
    raise exception 'Unsupported credit note action: %',v_action;
  end if;
  return (select status from public.accounting_credit_notes where id=p_credit_note_id);
end $$;

-- -----------------------------------------------------------------------------
-- Customer credit / refund controls
-- Net customer A/R = issued invoice totals - payments - posted credit notes + completed refunds.
-- A negative balance is a refundable customer credit.
-- -----------------------------------------------------------------------------
create or replace function public.accounting_customer_credit_available(p_party_id uuid)
returns numeric
language sql
stable
security definer
set search_path=public,extensions
as $$
  with inv as (
    select coalesce(sum(total),0)::numeric as total
    from public.accounting_invoices
    where party_id=p_party_id and status not in ('DRAFT','VOID')
  ), pay as (
    select coalesce(sum(p.amount),0)::numeric as total
    from public.accounting_payments p
    join public.accounting_invoices i on i.id=p.invoice_id
    where i.party_id=p_party_id and i.status<>'VOID'
  ), cn as (
    select coalesce(sum(total),0)::numeric as total
    from public.accounting_credit_notes
    where customer_party_id=p_party_id and status='POSTED'
  ), ref as (
    select coalesce(sum(amount),0)::numeric as total
    from public.accounting_customer_refunds
    where customer_party_id=p_party_id and status='COMPLETED'
  )
  select greatest(0,round((select total from pay)+(select total from cn)-(select total from inv)-(select total from ref),2));
$$;

create or replace function public.accounting_record_customer_refund(
  p_customer_party_id uuid,
  p_credit_note_id uuid,
  p_financial_account_id uuid,
  p_refund_date date,
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
  v_refund_id uuid;
  v_available numeric(14,2);
  v_party_currency text;
  v_fin_currency text;
  v_fin_active boolean;
begin
  if p_customer_party_id is null then raise exception 'Customer is required.'; end if;
  if coalesce(p_amount,0)<=0 then raise exception 'Refund amount must be positive.'; end if;
  perform pg_advisory_xact_lock(hashtext(p_customer_party_id::text));
  select default_currency into v_party_currency from public.accounting_parties where id=p_customer_party_id and active=true;
  if not found then raise exception 'Customer Business Partner is inactive or missing.'; end if;
  if not exists(select 1 from public.accounting_party_roles where party_id=p_customer_party_id and role='CUSTOMER' and active=true) then raise exception 'Selected Business Partner does not have an active CUSTOMER role.'; end if;
  if p_credit_note_id is not null and not exists(select 1 from public.accounting_credit_notes where id=p_credit_note_id and customer_party_id=p_customer_party_id and status='POSTED') then
    raise exception 'Selected credit note is not a posted credit note for this customer.';
  end if;
  select currency,active into v_fin_currency,v_fin_active from public.accounting_financial_accounts where id=p_financial_account_id;
  if coalesce(v_fin_active,false)=false then raise exception 'Refund financial account is inactive or missing.'; end if;
  if upper(coalesce(v_fin_currency,'CAD'))<>upper(coalesce(v_party_currency,'CAD')) then raise exception 'Customer and refund financial account currencies must match in STEP 18.3.'; end if;

  v_available:=public.accounting_customer_credit_available(p_customer_party_id);
  if round(p_amount,2)>v_available+0.001 then raise exception 'Refund exceeds available customer credit of %.',v_available; end if;

  insert into public.accounting_customer_refunds(
    customer_party_id,credit_note_id,financial_account_id,refund_date,amount,currency,method,reference,notes,status,created_by,completed_at
  ) values(
    p_customer_party_id,p_credit_note_id,p_financial_account_id,coalesce(p_refund_date,current_date),round(p_amount,2),upper(coalesce(v_party_currency,'CAD')),
    nullif(btrim(p_method),''),nullif(btrim(p_reference),''),nullif(btrim(p_notes),''),'COMPLETED',p_actor_id,now()
  ) returning id into v_refund_id;
  return v_refund_id;
end $$;

-- -----------------------------------------------------------------------------
-- STEP 17 durable events
-- -----------------------------------------------------------------------------
create or replace function public.accounting_credit_note_event_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_lines jsonb;
  v_source_invoice_id text;
  v_causation text;
begin
  if new.status='POSTED' and old.status is distinct from new.status then
    select source_invoice_id into v_source_invoice_id from public.accounting_invoices where id=new.invoice_id;
    select coalesce(jsonb_agg(to_jsonb(l) order by l.sort_order,l.id),'[]'::jsonb) into v_lines
    from public.accounting_credit_note_lines l where l.credit_note_id=new.id;
    v_causation:=case when v_source_invoice_id is not null then 'PLEASE:INVOICE_ISSUED:'||v_source_invoice_id else null end;
    perform public.accounting_enqueue_event(
      'CREDIT_NOTE_ISSUED','accounting_credit_notes',new.id::text,new.credit_note_number,
      jsonb_build_object('credit_note',to_jsonb(new),'lines',v_lines),coalesce(new.posted_at,now()),1,new.posted_by,new.invoice_id::text,v_causation
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_step18_3_credit_note_event on public.accounting_credit_notes;
create trigger trg_step18_3_credit_note_event
after update of status on public.accounting_credit_notes
for each row execute function public.accounting_credit_note_event_trigger();

create or replace function public.accounting_customer_refund_event_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,extensions
as $$
begin
  if new.status='COMPLETED' then
    perform public.accounting_enqueue_event(
      'REFUND_COMPLETED','accounting_customer_refunds',new.id::text,new.refund_number,
      jsonb_build_object('customer_refund',to_jsonb(new)),coalesce(new.completed_at,new.created_at,now()),1,new.created_by,new.customer_party_id::text,
      case when new.credit_note_id is not null then 'PLEASE:CREDIT_NOTE_ISSUED:'||new.credit_note_id::text else null end
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_step18_3_customer_refund_event on public.accounting_customer_refunds;
create trigger trg_step18_3_customer_refund_event
after insert on public.accounting_customer_refunds
for each row execute function public.accounting_customer_refund_event_trigger();

insert into public.accounting_posting_rules(source_system,event_type,debit_account_code,credit_account_code,tax_account_code,enabled,rule_version,configuration_json)
values
  ('PLEASE','CREDIT_NOTE_ISSUED','4000','1100','2100',true,1,jsonb_build_object('qst_payable_account','2110')),
  ('PLEASE','REFUND_COMPLETED','1100','1000',null,true,1,'{}'::jsonb)
on conflict(source_system,event_type,debit_account_code,credit_account_code) do update set
  tax_account_code=excluded.tax_account_code,
  enabled=true,
  rule_version=greatest(public.accounting_posting_rules.rule_version,excluded.rule_version),
  configuration_json=excluded.configuration_json;

-- -----------------------------------------------------------------------------
-- Audit trail fallback
-- -----------------------------------------------------------------------------
create or replace function public.accounting_receivables_audit_trigger()
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
  v_id=coalesce(v_row->>'id',v_row->>'credit_note_id','');
  insert into public.accounting_audit_log(event_type,object_type,object_id,before_data,after_data,metadata)
  values('RECEIVABLES_'||tg_op,tg_table_name,nullif(v_id,''),v_before,v_after,jsonb_build_object('step','18.3','source','DATABASE_TRIGGER'));
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['accounting_credit_notes','accounting_credit_note_lines','accounting_customer_refunds'] loop
    execute format('drop trigger if exists %I on public.%I','trg_'||t||'_receivables_audit',t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.accounting_receivables_audit_trigger()','trg_'||t||'_receivables_audit',t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Security
-- -----------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['accounting_credit_notes','accounting_credit_note_lines','accounting_customer_refunds'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
  end loop;
end $$;
revoke all on sequence public.accounting_credit_note_number_seq from anon,authenticated;
revoke all on sequence public.accounting_customer_refund_number_seq from anon,authenticated;
revoke all on function public.accounting_save_credit_note(uuid,uuid,date,text,text,boolean,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.accounting_credit_note_action(uuid,text,text) from public,anon,authenticated;
revoke all on function public.accounting_customer_credit_available(uuid) from public,anon,authenticated;
revoke all on function public.accounting_record_customer_refund(uuid,uuid,uuid,date,numeric,text,text,text,text) from public,anon,authenticated;
grant execute on function public.accounting_save_credit_note(uuid,uuid,date,text,text,boolean,text,jsonb,text) to service_role;
grant execute on function public.accounting_credit_note_action(uuid,text,text) to service_role;
grant execute on function public.accounting_customer_credit_available(uuid) to service_role;
grant execute on function public.accounting_record_customer_refund(uuid,uuid,uuid,date,numeric,text,text,text,text) to service_role;

comment on table public.accounting_credit_notes is 'STEP 18.3 customer credit notes linked to original CAL invoice. Posted notes are immutable and reduce revenue/tax/A-R through the STEP 17 event engine.';
comment on table public.accounting_customer_refunds is 'STEP 18.3 completed cash/clearing refunds. Original successful payment transactions are preserved and are not rewritten as refunds.';
comment on function public.accounting_customer_credit_available(uuid) is 'Returns refundable customer credit after issued invoices, payments, posted credit notes and completed refunds.';

commit;
