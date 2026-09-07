-- PLEASE Portal — STEP 16.0: CAL 1.5 Accounting Bridge
-- Run once in the PLEASE-owned Supabase project before relying on live accounting automation.
-- This migration is idempotent and keeps operational PLEASE data separate from CAL accounting records.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- CAL core hardening / compatibility
-- -----------------------------------------------------------------------------
create table if not exists public.accounting_company (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null default 'PLEASE Services',
  operating_name text not null default 'PLEASE Services',
  business_number text,
  province text not null default 'AB',
  fiscal_year_end text not null default '12-31',
  currency text not null default 'CAD',
  gst_registered boolean not null default true,
  sales_tax_account_number text,
  retention_years int not null default 6 check (retention_years >= 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.accounting_company(legal_name,operating_name,province,currency,gst_registered,retention_years)
select 'PLEASE Services','PLEASE Services','AB','CAD',true,6
where not exists (select 1 from public.accounting_company);

create table if not exists public.accounting_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  account_type text not null check(account_type in ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  parent_id uuid references public.accounting_accounts(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.accounting_contacts (
  id uuid primary key default gen_random_uuid(),
  contact_type text not null check(contact_type in ('CUSTOMER','VENDOR','BOTH')),
  legal_name text not null,
  email text,
  phone text,
  address jsonb not null default '{}'::jsonb,
  tax_number text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.accounting_tax_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  federal_rate numeric(9,5) not null default 0,
  provincial_rate numeric(9,5) not null default 0,
  tax_kind text not null,
  province text,
  recoverable_default boolean not null default true,
  effective_from date not null,
  effective_to date,
  active boolean not null default true
);

create table if not exists public.accounting_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  contact_id uuid references public.accounting_contacts(id),
  invoice_date date not null,
  due_date date,
  status text not null default 'DRAFT' check(status in ('DRAFT','SENT','PARTIAL','PAID','OVERDUE','VOID')),
  subtotal numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  paid_total numeric(14,2) not null default 0,
  currency text not null default 'CAD',
  source_reference text,
  notes text,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accounting_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.accounting_invoices(id) on delete restrict,
  description text not null,
  quantity numeric(14,4) not null default 1,
  unit_price numeric(14,4) not null default 0,
  revenue_account_id uuid references public.accounting_accounts(id),
  tax_code_id uuid references public.accounting_tax_codes(id),
  line_subtotal numeric(14,2) not null default 0,
  line_tax numeric(14,2) not null default 0
);

create table if not exists public.accounting_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.accounting_invoices(id),
  payment_date date not null,
  amount numeric(14,2) not null check(amount > 0),
  method text,
  reference text,
  bank_account_id uuid references public.accounting_accounts(id),
  created_at timestamptz not null default now()
);
create unique index if not exists accounting_payments_reference_uidx on public.accounting_payments(reference) where reference is not null;

create table if not exists public.accounting_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_number text not null unique,
  contact_id uuid references public.accounting_contacts(id),
  expense_date date not null,
  category_account_id uuid references public.accounting_accounts(id),
  tax_code_id uuid references public.accounting_tax_codes(id),
  subtotal numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  recoverable_tax numeric(14,2) not null default 0,
  status text not null default 'POSTED' check(status in ('DRAFT','POSTED','VOID')),
  description text,
  source_reference text,
  created_at timestamptz not null default now()
);

create table if not exists public.accounting_journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_number text not null unique,
  entry_date date not null,
  memo text not null,
  source_type text,
  source_id uuid,
  status text not null default 'DRAFT' check(status in ('DRAFT','POSTED','REVERSED')),
  reversal_of uuid references public.accounting_journal_entries(id),
  posted_at timestamptz,
  posted_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists accounting_journal_entries_source_uidx
  on public.accounting_journal_entries(source_type,source_id)
  where source_type is not null and source_id is not null;

create table if not exists public.accounting_journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.accounting_journal_entries(id) on delete restrict,
  account_id uuid not null references public.accounting_accounts(id),
  debit numeric(14,2) not null default 0 check(debit >= 0),
  credit numeric(14,2) not null default 0 check(credit >= 0),
  description text,
  check(not (debit > 0 and credit > 0)),
  check(debit > 0 or credit > 0)
);

create table if not exists public.accounting_fiscal_periods (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  status text not null default 'OPEN' check(status in ('OPEN','CLOSED','LOCKED')),
  closed_at timestamptz,
  closed_by uuid,
  unique(period_start,period_end)
);

create table if not exists public.accounting_period_locks (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  lock_reason text not null,
  locked_by uuid,
  locked_at timestamptz not null default now(),
  unique(period_start,period_end)
);

create table if not exists public.accounting_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  related_type text,
  related_id uuid,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.accounting_audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid,
  event_type text not null,
  object_type text not null,
  object_id text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb
);

-- Legal acceptance can be tied either to native CAL users or to PLEASE admin users.
create table if not exists public.accounting_legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  external_user_id text,
  external_user_email text,
  agreement_version text not null,
  agreement_effective_date date not null,
  legal_company_name text not null,
  signer_name text not null,
  signer_title text not null,
  signer_email text not null,
  signature_text text not null,
  acceptance_method text not null check(acceptance_method in ('ELECTRONIC_SIGNATURE','PHYSICAL_COPY_ON_FILE')),
  accepted_at timestamptz not null default now(),
  signed_document_storage_path text,
  metadata jsonb not null default '{}'::jsonb
);
alter table public.accounting_legal_acceptances alter column user_id drop not null;
alter table public.accounting_legal_acceptances add column if not exists external_user_id text;
alter table public.accounting_legal_acceptances add column if not exists external_user_email text;
create unique index if not exists accounting_legal_external_user_version_uidx
  on public.accounting_legal_acceptances(external_user_id,agreement_version)
  where external_user_id is not null;
create index if not exists accounting_legal_acceptances_version_idx on public.accounting_legal_acceptances(agreement_version,accepted_at);

-- -----------------------------------------------------------------------------
-- Bridge inbox/outbox + idempotent event posting controls
-- -----------------------------------------------------------------------------
create table if not exists public.accounting_external_events (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'PLEASE',
  source_event_id text not null,
  event_type text not null,
  event_version int not null default 1,
  source_table text,
  source_record_id text,
  source_reference text,
  occurred_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  posting_status text not null default 'PENDING' check(posting_status in ('PENDING','POSTED','ERROR','IGNORED','REVERSED')),
  journal_entry_id uuid references public.accounting_journal_entries(id),
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(source_system,source_event_id)
);
create index if not exists accounting_external_events_status_idx on public.accounting_external_events(posting_status,created_at desc);
create index if not exists accounting_external_events_source_ref_idx on public.accounting_external_events(source_system,source_reference);

create table if not exists public.please_accounting_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  source_table text,
  source_record_id text,
  source_reference text,
  occurred_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  status text not null default 'PENDING' check(status in ('PENDING','POSTED','ERROR','IGNORED')),
  attempts int not null default 0,
  last_error text,
  cal_event_id uuid references public.accounting_external_events(id),
  cal_journal_entry_id uuid references public.accounting_journal_entries(id),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists please_accounting_outbox_status_idx on public.please_accounting_outbox(status,created_at desc);

create table if not exists public.accounting_posting_rules (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'PLEASE',
  event_type text not null,
  enabled boolean not null default true,
  debit_account_code text not null,
  credit_account_code text not null,
  tax_account_code text,
  notes text,
  created_at timestamptz not null default now(),
  unique(source_system,event_type,debit_account_code,credit_account_code)
);

insert into public.accounting_accounts(code,name,account_type) values
('1000','Operating Bank','ASSET'),
('1090','Stripe Clearing / Undeposited Funds','ASSET'),
('1100','Accounts Receivable','ASSET'),
('1200','GST/HST Recoverable','ASSET'),
('1300','Provider Advances','ASSET'),
('2000','Accounts Payable','LIABILITY'),
('2010','Provider Payable','LIABILITY'),
('2100','GST/HST Payable','LIABILITY'),
('3000','Owner Equity / Retained Earnings','EQUITY'),
('4000','Service Revenue','REVENUE'),
('5000','Subcontractors Expense','EXPENSE'),
('5400','Office & Software','EXPENSE'),
('5700','Merchant / Bank Fees','EXPENSE')
on conflict(code) do update set name=excluded.name, account_type=excluded.account_type;

insert into public.accounting_tax_codes(code,name,federal_rate,provincial_rate,tax_kind,province,effective_from) values
('AB-GST','Alberta GST',5,0,'GST','AB','2026-01-01'),
('ON-HST','Ontario HST',0,13,'HST','ON','2026-01-01'),
('NS-HST','Nova Scotia HST',0,14,'HST','NS','2026-01-01'),
('NB-HST','New Brunswick HST',0,15,'HST','NB','2026-01-01'),
('NL-HST','Newfoundland and Labrador HST',0,15,'HST','NL','2026-01-01'),
('PE-HST','Prince Edward Island HST',0,15,'HST','PE','2026-01-01'),
('QC-GST','Quebec GST',5,0,'GST','QC','2026-01-01'),
('QC-QST','Quebec QST',0,9.975,'QST','QC','2026-01-01')
on conflict(code) do nothing;

insert into public.accounting_posting_rules(event_type,debit_account_code,credit_account_code,tax_account_code,notes) values
('INVOICE_ISSUED','1100','4000','2100','Customer invoice creates accounts receivable, service revenue and GST/HST payable.'),
('PAYMENT_RECEIVED','1090','1100',null,'Stripe payments debit clearing and credit accounts receivable. Manual payments use Operating Bank.'),
('STRIPE_FEE_RECORDED','5700','1090',null,'Stripe processing fee reduces Stripe clearing.'),
('INVOICE_VOIDED','4000','1100','2100','Void reverses previously issued revenue, tax and receivable.'),
('PROVIDER_PAYABLE_CREATED','5000','2010',null,'Independent provider completion creates subcontractor expense and provider payable.'),
('PROVIDER_PAYMENT_PAID','2010','1000',null,'Provider payment clears payable against bank or provider advances.')
on conflict do nothing;

-- Stripe detail columns used for CAL reconciliation when available.
alter table public.payment_transactions add column if not exists stripe_charge_id text;
alter table public.payment_transactions add column if not exists stripe_receipt_url text;
alter table public.payment_transactions add column if not exists stripe_balance_transaction_id text;
alter table public.payment_transactions add column if not exists stripe_fee_amount numeric(10,2);
alter table public.payment_transactions add column if not exists stripe_net_amount numeric(10,2);

-- -----------------------------------------------------------------------------
-- Accounting integrity: posted entries cannot be unbalanced or placed in locked periods.
-- -----------------------------------------------------------------------------
create or replace function public.accounting_validate_posted_journal()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_debit numeric(14,2);
  v_credit numeric(14,2);
  v_locked int;
begin
  if new.status='POSTED' then
    select coalesce(sum(debit),0), coalesce(sum(credit),0)
      into v_debit, v_credit
      from public.accounting_journal_lines
      where journal_entry_id=new.id;
    if round(v_debit,2) <> round(v_credit,2) or round(v_debit,2)=0 then
      raise exception 'Posted journal entry % must balance and must not be empty. Debits %, credits %', new.entry_number, v_debit, v_credit;
    end if;
    select count(*) into v_locked
      from public.accounting_period_locks
      where new.entry_date between period_start and period_end;
    if v_locked > 0 then
      raise exception 'Accounting period is locked for entry date %', new.entry_date;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_accounting_validate_posted_journal on public.accounting_journal_entries;
create trigger trg_accounting_validate_posted_journal
before insert or update of status,entry_date on public.accounting_journal_entries
for each row execute function public.accounting_validate_posted_journal();

create or replace function public.accounting_prevent_posted_entry_mutation()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if exists (select 1 from public.accounting_journal_entries where id=coalesce(old.journal_entry_id,new.journal_entry_id) and status='POSTED') then
    raise exception 'Posted accounting journal lines cannot be edited or deleted. Use reversal entries.';
  end if;
  if tg_op='DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists trg_accounting_prevent_posted_line_update on public.accounting_journal_lines;
create trigger trg_accounting_prevent_posted_line_update
before update or delete on public.accounting_journal_lines
for each row execute function public.accounting_prevent_posted_entry_mutation();

-- Server-side Functions use the service role. Browsers must not directly read/write accounting data.
do $$ declare t text; begin
  foreach t in array array[
    'accounting_company','accounting_accounts','accounting_contacts','accounting_tax_codes','accounting_invoices','accounting_invoice_lines','accounting_payments','accounting_expenses','accounting_journal_entries','accounting_journal_lines','accounting_fiscal_periods','accounting_period_locks','accounting_documents','accounting_audit_log','accounting_legal_acceptances','accounting_external_events','please_accounting_outbox','accounting_posting_rules'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from anon, authenticated',t);
  end loop;
end $$;

comment on table public.accounting_external_events is 'CAL inbox for idempotent financial events generated by PLEASE operations.';
comment on table public.please_accounting_outbox is 'PLEASE accounting outbox. If CAL posting fails, the operational action still succeeds and this queue records the accounting sync issue.';
comment on table public.accounting_period_locks is 'Closed/locked accounting periods. Ordinary postings are rejected for locked dates.';
comment on function public.accounting_validate_posted_journal() is 'Prevents unbalanced posted journal entries and posting into locked periods.';
