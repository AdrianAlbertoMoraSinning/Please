-- CAL 1.5 Canadian Accounting by Lottus — core schema
-- Run this in EACH CLIENT'S OWN Supabase project. Never in a shared Lottus customer-data project.
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

create table if not exists accounting_company (
  id uuid primary key default gen_random_uuid(), legal_name text not null, operating_name text not null,
  business_number text, province text not null default 'AB', fiscal_year_end text not null default '12-31',
  currency text not null default 'CAD', gst_registered boolean not null default false, sales_tax_account_number text,
  retention_years int not null default 6 check (retention_years >= 6), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists accounting_portal_users (
  id uuid primary key default gen_random_uuid(), email text not null unique, password_hash text not null,
  display_name text not null, role text not null check(role in ('OWNER','ADMIN','BOOKKEEPER','ACCOUNTANT','EMPLOYEE','EXTERNAL_ACCOUNTANT')),
  active boolean not null default true, created_at timestamptz not null default now(), last_login_at timestamptz
);
create table if not exists accounting_sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references accounting_portal_users(id), token_hash text not null unique,
  expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists accounting_sessions_token_idx on accounting_sessions(token_hash);

create table if not exists accounting_accounts (
  id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
  account_type text not null check(account_type in ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  parent_id uuid references accounting_accounts(id), active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists accounting_contacts (
  id uuid primary key default gen_random_uuid(), contact_type text not null check(contact_type in ('CUSTOMER','VENDOR','BOTH')),
  legal_name text not null, email text, phone text, address jsonb not null default '{}'::jsonb, tax_number text, active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists accounting_tax_codes (
  id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
  federal_rate numeric(9,5) not null default 0, provincial_rate numeric(9,5) not null default 0,
  tax_kind text not null, province text, recoverable_default boolean not null default true,
  effective_from date not null, effective_to date, active boolean not null default true
);

create table if not exists accounting_invoices (
  id uuid primary key default gen_random_uuid(), invoice_number text not null unique, contact_id uuid references accounting_contacts(id),
  invoice_date date not null, due_date date, status text not null default 'DRAFT' check(status in ('DRAFT','SENT','PARTIAL','PAID','OVERDUE','VOID')),
  subtotal numeric(14,2) not null default 0, tax_total numeric(14,2) not null default 0, total numeric(14,2) not null default 0,
  paid_total numeric(14,2) not null default 0, currency text not null default 'CAD', source_reference text, notes text,
  posted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists accounting_invoice_lines (
  id uuid primary key default gen_random_uuid(), invoice_id uuid not null references accounting_invoices(id) on delete restrict,
  description text not null, quantity numeric(14,4) not null default 1, unit_price numeric(14,4) not null default 0,
  revenue_account_id uuid references accounting_accounts(id), tax_code_id uuid references accounting_tax_codes(id), line_subtotal numeric(14,2) not null default 0, line_tax numeric(14,2) not null default 0
);
create table if not exists accounting_payments (
  id uuid primary key default gen_random_uuid(), invoice_id uuid references accounting_invoices(id), payment_date date not null,
  amount numeric(14,2) not null check(amount > 0), method text, reference text, bank_account_id uuid references accounting_accounts(id), created_at timestamptz not null default now()
);

create table if not exists accounting_expenses (
  id uuid primary key default gen_random_uuid(), expense_number text not null unique, contact_id uuid references accounting_contacts(id),
  expense_date date not null, category_account_id uuid references accounting_accounts(id), tax_code_id uuid references accounting_tax_codes(id),
  subtotal numeric(14,2) not null default 0, tax_total numeric(14,2) not null default 0, total numeric(14,2) not null default 0,
  recoverable_tax numeric(14,2) not null default 0, status text not null default 'POSTED' check(status in ('DRAFT','POSTED','VOID')),
  description text, source_reference text, created_at timestamptz not null default now()
);

create table if not exists accounting_bank_transactions (
  id uuid primary key default gen_random_uuid(), bank_account_id uuid references accounting_accounts(id), transaction_date date not null,
  description text not null, amount numeric(14,2) not null, direction text not null check(direction in ('CREDIT','DEBIT')),
  external_reference text, import_batch text, matched boolean not null default false, reconciled boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists accounting_reconciliations (
  id uuid primary key default gen_random_uuid(), bank_account_id uuid not null references accounting_accounts(id), statement_date date not null,
  statement_balance numeric(14,2) not null, book_balance numeric(14,2) not null, difference numeric(14,2) not null,
  status text not null default 'OPEN' check(status in ('OPEN','COMPLETED')), completed_at timestamptz, created_at timestamptz not null default now()
);

create table if not exists accounting_journal_entries (
  id uuid primary key default gen_random_uuid(), entry_number text not null unique, entry_date date not null, memo text not null,
  source_type text, source_id uuid, status text not null default 'DRAFT' check(status in ('DRAFT','POSTED','REVERSED')),
  reversal_of uuid references accounting_journal_entries(id), posted_at timestamptz, posted_by uuid references accounting_portal_users(id), created_at timestamptz not null default now()
);
create table if not exists accounting_journal_lines (
  id uuid primary key default gen_random_uuid(), journal_entry_id uuid not null references accounting_journal_entries(id) on delete restrict,
  account_id uuid not null references accounting_accounts(id), debit numeric(14,2) not null default 0 check(debit >= 0), credit numeric(14,2) not null default 0 check(credit >= 0),
  description text, check(not (debit > 0 and credit > 0)), check(debit > 0 or credit > 0)
);

create table if not exists accounting_fiscal_periods (
  id uuid primary key default gen_random_uuid(), period_start date not null, period_end date not null, status text not null default 'OPEN' check(status in ('OPEN','CLOSED','LOCKED')),
  closed_at timestamptz, closed_by uuid references accounting_portal_users(id), unique(period_start,period_end)
);
create table if not exists accounting_documents (
  id uuid primary key default gen_random_uuid(), document_type text not null, storage_path text not null unique, original_name text not null,
  mime_type text not null, size_bytes bigint not null, related_type text, related_id uuid, uploaded_by uuid references accounting_portal_users(id), created_at timestamptz not null default now()
);
create table if not exists accounting_audit_log (
  id bigint generated always as identity primary key, occurred_at timestamptz not null default now(), actor_user_id uuid references accounting_portal_users(id),
  event_type text not null, object_type text not null, object_id text, before_data jsonb, after_data jsonb, metadata jsonb not null default '{}'::jsonb
);


create table if not exists accounting_legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references accounting_portal_users(id),
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
  metadata jsonb not null default '{}'::jsonb,
  unique(user_id, agreement_version)
);
create index if not exists accounting_legal_acceptances_version_idx on accounting_legal_acceptances(agreement_version, accepted_at);

-- Deny direct browser access to sensitive tables. Production access is server Functions using the client's server secret.
do $$ declare t text; begin
  foreach t in array array['accounting_company','accounting_portal_users','accounting_sessions','accounting_accounts','accounting_contacts','accounting_tax_codes','accounting_invoices','accounting_invoice_lines','accounting_payments','accounting_expenses','accounting_bank_transactions','accounting_reconciliations','accounting_journal_entries','accounting_journal_lines','accounting_fiscal_periods','accounting_documents','accounting_audit_log','accounting_legal_acceptances'] loop
    execute format('alter table %I enable row level security',t);
    execute format('revoke all on table %I from anon, authenticated',t);
  end loop;
end $$;

-- Starter Canadian chart of accounts.
insert into accounting_accounts(code,name,account_type) values
('1000','Operating Bank','ASSET'),('1100','Accounts Receivable','ASSET'),('1200','GST/HST Recoverable','ASSET'),('1210','QST Recoverable','ASSET'),
('1500','Equipment & Vehicles','ASSET'),('2000','Accounts Payable','LIABILITY'),('2100','GST/HST Payable','LIABILITY'),('2110','QST Payable','LIABILITY'),('2200','Credit Cards','LIABILITY'),
('3000','Share Capital','EQUITY'),('3100','Retained Earnings','EQUITY'),('4000','Service Revenue','REVENUE'),('4100','Other Revenue','REVENUE'),
('5000','Subcontractors','EXPENSE'),('5100','Fuel & Vehicle','EXPENSE'),('5200','Insurance','EXPENSE'),('5300','Advertising','EXPENSE'),('5400','Office & Software','EXPENSE'),
('5500','Professional Fees','EXPENSE'),('5600','Repairs & Maintenance','EXPENSE'),('5700','Bank Fees','EXPENSE')
on conflict(code) do nothing;

-- Reference tax configuration, editable by accountant. Effective dates matter; do not hard-code application logic to these rows.
insert into accounting_tax_codes(code,name,federal_rate,provincial_rate,tax_kind,province,effective_from) values
('AB-GST','Alberta GST',5,0,'GST','AB','2026-01-01'),('ON-HST','Ontario HST',0,13,'HST','ON','2026-01-01'),
('NS-HST','Nova Scotia HST',0,14,'HST','NS','2026-01-01'),('NB-HST','New Brunswick HST',0,15,'HST','NB','2026-01-01'),
('NL-HST','Newfoundland and Labrador HST',0,15,'HST','NL','2026-01-01'),('PE-HST','Prince Edward Island HST',0,15,'HST','PE','2026-01-01'),
('QC-GST','Quebec GST',5,0,'GST','QC','2026-01-01'),('QC-QST','Quebec QST',0,9.975,'QST','QC','2026-01-01')
on conflict(code) do nothing;

-- Helper for first administrator. Replace placeholder BEFORE running in production, then remove the statement from deployment history if appropriate.
-- insert into accounting_portal_users(email,password_hash,display_name,role)
-- values ('owner@client.ca', crypt('CHANGE-ME', gen_salt('bf',12)), 'Client Owner', 'OWNER');
