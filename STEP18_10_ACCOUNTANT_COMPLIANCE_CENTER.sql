-- PLEASE / CAL — STEP 18.10: Accountant & Compliance Center
-- Additive migration. Run AFTER STEP 18.9.1 Period Boundary Guardrails.
-- Scope: accountant packages, GIFI working papers/mappings, compliance calendar,
-- review/approval evidence and immutable filing/payment evidence.
-- IMPORTANT: STEP 18.10 does not transmit returns to CRA/TRA and does not create GL journals.

begin;
create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.accounting_fiscal_periods') is null
     or to_regclass('public.accounting_period_locks') is null
     or to_regclass('public.accounting_period_close_snapshots') is null
     or to_regclass('public.accounting_journal_entries') is null
     or to_regclass('public.accounting_journal_lines') is null
     or to_regclass('public.accounting_payroll_settings') is null
     or to_regclass('public.accounting_fixed_assets') is null
     or to_regclass('public.accounting_inventory_movements') is null
     or to_regclass('public.accounting_documents') is null
     or to_regclass('public.accounting_company') is null then
    raise exception 'STEP 18.10 prerequisites missing. Install STEP 17 through STEP 18.9.1 first.';
  end if;
end $$;

create sequence if not exists public.accounting_gifi_working_paper_number_seq start with 1001;
create sequence if not exists public.accounting_accountant_package_number_seq start with 1001;

-- -----------------------------------------------------------------------------
-- Compliance settings: user-controlled filing profile. Defaults are conservative.
-- -----------------------------------------------------------------------------
create table if not exists public.accounting_compliance_settings (
  id uuid primary key default gen_random_uuid(),
  gst_reporting_frequency text not null default 'UNCONFIGURED'
    check(gst_reporting_frequency in ('UNCONFIGURED','MONTHLY','QUARTERLY','ANNUAL')),
  federal_balance_due_months integer not null default 2 check(federal_balance_due_months in (2,3)),
  alberta_balance_due_months integer not null default 2 check(alberta_balance_due_months in (2,3)),
  three_month_balance_due_basis text,
  t2_enabled boolean not null default true,
  at1_enabled boolean not null default true,
  gst_hst_enabled boolean not null default true,
  payroll_remittance_enabled boolean not null default true,
  t4_enabled boolean not null default true,
  accountant_package_enabled boolean not null default true,
  notes text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.accounting_compliance_settings(gst_reporting_frequency)
select 'UNCONFIGURED' where not exists(select 1 from public.accounting_compliance_settings);

-- -----------------------------------------------------------------------------
-- GIFI reference + GL mapping.
-- Reference catalog contains the verified codes needed by the current CAL COA.
-- Additional codes may be added in future migrations from the official RC4088 list.
-- -----------------------------------------------------------------------------
create table if not exists public.accounting_gifi_codes (
  code text primary key check(code ~ '^[0-9]{4}$'),
  name text not null,
  statement_section text not null check(statement_section in ('BALANCE_SHEET','INCOME_STATEMENT','RETAINED_EARNINGS','TOTAL_CONTROL')),
  normal_sign text not null default 'POSITIVE' check(normal_sign in ('POSITIVE','NEGATIVE_ALLOWED')),
  source_reference text not null default 'CRA RC4088 General Index of Financial Information',
  system_managed boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.accounting_gifi_codes(code,name,statement_section,normal_sign) values
 ('1000','Cash and deposits','BALANCE_SHEET','POSITIVE'),
 ('1002','Deposits in Canadian banks and institutions - Canadian currency','BALANCE_SHEET','POSITIVE'),
 ('1060','Accounts receivable','BALANCE_SHEET','POSITIVE'),
 ('1066','Taxes receivable','BALANCE_SHEET','POSITIVE'),
 ('1120','Inventories','BALANCE_SHEET','POSITIVE'),
 ('1480','Other current assets','BALANCE_SHEET','POSITIVE'),
 ('1484','Prepaid expenses','BALANCE_SHEET','POSITIVE'),
 ('1599','Total current assets','TOTAL_CONTROL','POSITIVE'),
 ('1740','Machinery, equipment, furniture and fixtures','BALANCE_SHEET','POSITIVE'),
 ('1741','Accumulated amortization of machinery, equipment, furniture and fixtures','BALANCE_SHEET','NEGATIVE_ALLOWED'),
 ('2008','Total tangible capital assets','TOTAL_CONTROL','POSITIVE'),
 ('2009','Total accumulated amortization of tangible capital assets','TOTAL_CONTROL','NEGATIVE_ALLOWED'),
 ('2599','Total assets','TOTAL_CONTROL','POSITIVE'),
 ('2620','Amounts payable and accrued liabilities','BALANCE_SHEET','POSITIVE'),
 ('2621','Trade payables','BALANCE_SHEET','POSITIVE'),
 ('2624','Wages payable','BALANCE_SHEET','POSITIVE'),
 ('2627','Employee deductions payable','BALANCE_SHEET','POSITIVE'),
 ('2628','Withholding taxes payable','BALANCE_SHEET','POSITIVE'),
 ('2680','Taxes payable','BALANCE_SHEET','POSITIVE'),
 ('2700','Short-term debt','BALANCE_SHEET','POSITIVE'),
 ('3139','Total current liabilities','TOTAL_CONTROL','POSITIVE'),
 ('3499','Total liabilities','TOTAL_CONTROL','POSITIVE'),
 ('3500','Common shares','BALANCE_SHEET','POSITIVE'),
 ('3600','Retained earnings/deficit','BALANCE_SHEET','NEGATIVE_ALLOWED'),
 ('3620','Total shareholder equity','TOTAL_CONTROL','NEGATIVE_ALLOWED'),
 ('3640','Total liabilities and shareholder equity','TOTAL_CONTROL','NEGATIVE_ALLOWED'),
 ('3680','Net income/loss','RETAINED_EARNINGS','NEGATIVE_ALLOWED'),
 ('3849','Retained earnings/deficit - End','RETAINED_EARNINGS','NEGATIVE_ALLOWED'),
 ('8000','Trade sales of goods and services','INCOME_STATEMENT','POSITIVE'),
 ('8210','Realized gains/losses on disposal of assets','INCOME_STATEMENT','NEGATIVE_ALLOWED'),
 ('8230','Other revenue','INCOME_STATEMENT','NEGATIVE_ALLOWED'),
 ('8299','Total revenue','TOTAL_CONTROL','NEGATIVE_ALLOWED'),
 ('8360','Trades and sub-contracts','INCOME_STATEMENT','POSITIVE'),
 ('8458','Inventory write-down','INCOME_STATEMENT','NEGATIVE_ALLOWED'),
 ('8518','Cost of sales','INCOME_STATEMENT','POSITIVE'),
 ('8521','Advertising','INCOME_STATEMENT','POSITIVE'),
 ('8622','Employer''s portion of employee benefits','INCOME_STATEMENT','POSITIVE'),
 ('8670','Amortization of tangible assets','INCOME_STATEMENT','POSITIVE'),
 ('8690','Insurance','INCOME_STATEMENT','POSITIVE'),
 ('8715','Bank charges','INCOME_STATEMENT','POSITIVE'),
 ('8810','Office expenses','INCOME_STATEMENT','POSITIVE'),
 ('8860','Professional fees','INCOME_STATEMENT','POSITIVE'),
 ('8960','Repairs and maintenance','INCOME_STATEMENT','POSITIVE'),
 ('9060','Salaries and wages','INCOME_STATEMENT','POSITIVE'),
 ('9270','Other expenses','INCOME_STATEMENT','NEGATIVE_ALLOWED'),
 ('9281','Vehicle expenses','INCOME_STATEMENT','POSITIVE'),
 ('9367','Total operating expenses','TOTAL_CONTROL','POSITIVE'),
 ('9368','Total expenses','TOTAL_CONTROL','POSITIVE'),
 ('9369','Net non-farming income','TOTAL_CONTROL','NEGATIVE_ALLOWED'),
 ('9970','Net income/loss before taxes and extraordinary items','TOTAL_CONTROL','NEGATIVE_ALLOWED'),
 ('9999','Net income/loss after taxes and extraordinary items','TOTAL_CONTROL','NEGATIVE_ALLOWED')
on conflict(code) do update set name=excluded.name,statement_section=excluded.statement_section,normal_sign=excluded.normal_sign,active=true;

create table if not exists public.accounting_gifi_account_mappings (
  account_id uuid primary key references public.accounting_accounts(id) on delete restrict,
  gifi_code text not null references public.accounting_gifi_codes(code) on delete restrict,
  sign_multiplier numeric(5,2) not null default 1 check(sign_multiplier in (-1,1)),
  mapping_note text,
  mapping_source text not null default 'CAL_DEFAULT' check(mapping_source in ('CAL_DEFAULT','ACCOUNTANT_REVIEWED')),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Default mappings are working-paper defaults, not a substitute for accountant review.
with defaults(account_code,gifi_code,sign_multiplier,note) as (values
 ('1000','1002',1,'Operating bank in Canadian currency.'),
 ('1090','1000',1,'Stripe clearing / undeposited funds presented within cash and deposits; review presentation policy.'),
 ('1100','1060',1,'Accounts receivable.'),
 ('1200','1066',1,'GST/HST recoverable as taxes receivable.'),
 ('1210','1066',1,'QST recoverable as taxes receivable.'),
 ('1300','1480',1,'Provider advances presented as other current assets.'),
 ('1400','1484',1,'Prepaid expenses.'),
 ('1500','1740',1,'Combined equipment/vehicle control account; split GL accounts if a more specific GIFI presentation is required.'),
 ('1510','1741',1,'Contra fixed-asset account retains its natural negative debit-credit balance for accumulated amortization.'),
 ('1600','1120',1,'Inventory.'),
 ('2000','2621',1,'Trade accounts payable.'),
 ('2010','2621',1,'Operational provider trade payable.'),
 ('2020','2620',1,'Employee/contractor reimbursements payable.'),
 ('2030','2624',1,'Net payroll payable / wages payable.'),
 ('2040','2627',1,'CPP/CPP2 source deductions payable.'),
 ('2050','2627',1,'EI source deductions payable.'),
 ('2060','2628',1,'Payroll withholding taxes payable.'),
 ('2070','2627',1,'Other payroll deductions payable.'),
 ('2100','2680',1,'GST/HST payable.'),
 ('2110','2680',1,'QST payable.'),
 ('2200','2700',1,'Credit cards presented as short-term debt.'),
 ('3000','3600',1,'Current CAL equity control is Owner Equity / Retained Earnings; accountant must confirm corporation presentation.'),
 ('4000','8000',1,'Primary service revenue.'),
 ('4050','8210',1,'Book gain on disposal of fixed assets.'),
 ('5000','8360',1,'Subcontract labour / trades.'),
 ('5100','9281',1,'Vehicle expenses.'),
 ('5200','8690',1,'Insurance.'),
 ('5300','8521',1,'Advertising.'),
 ('5400','8810',1,'Office and software.'),
 ('5500','8860',1,'Professional fees.'),
 ('5600','8960',1,'Repairs and maintenance.'),
 ('5700','8715',1,'Merchant / bank fees mapped to bank charges; accountant should review merchant-fee presentation.'),
 ('6000','8518',1,'Cost of goods sold.'),
 ('6100','8458',1,'Inventory write-down/adjustment; credits naturally reduce the amount.'),
 ('6200','8670',1,'Book depreciation / amortization of tangible assets.'),
 ('6300','8210',-1,'Book loss on disposal is reported under GIFI 8210 as a negative amount.'),
 ('7000','9060',1,'Salaries and wages.'),
 ('7010','8622',1,'Employer CPP/CPP2.'),
 ('7020','8622',1,'Employer EI.')
)
insert into public.accounting_gifi_account_mappings(account_id,gifi_code,sign_multiplier,mapping_note,mapping_source)
select a.id,d.gifi_code,d.sign_multiplier,d.note,'CAL_DEFAULT'
from defaults d join public.accounting_accounts a on a.code=d.account_code
on conflict(account_id) do nothing;

create table if not exists public.accounting_gifi_working_papers (
  id uuid primary key default gen_random_uuid(),
  paper_number text not null unique default ('GIFI-'||lpad(nextval('public.accounting_gifi_working_paper_number_seq')::text,6,'0')),
  tax_year_end_year integer not null,
  period_start date not null,
  period_end date not null,
  revision integer not null,
  status text not null default 'DRAFT' check(status in ('DRAFT','REVIEWED','APPROVED')),
  source_trial_balance_difference numeric(14,2) not null default 0,
  unmapped_nonzero_count integer not null default 0,
  closed_coverage_days integer not null default 0,
  required_coverage_days integer not null default 0,
  source_reference text not null default 'CRA RC4088 GIFI working paper',
  prepared_by text,
  prepared_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  notes text,
  unique(tax_year_end_year,revision)
);

create table if not exists public.accounting_gifi_working_paper_lines (
  id bigint generated always as identity primary key,
  working_paper_id uuid not null references public.accounting_gifi_working_papers(id) on delete restrict,
  line_type text not null check(line_type in ('ACCOUNT','DERIVED_TOTAL')),
  account_id uuid references public.accounting_accounts(id) on delete restrict,
  account_code text,
  account_name text,
  account_type text,
  gifi_code text,
  gifi_name text,
  amount numeric(14,2) not null default 0,
  mapping_source text,
  mapping_note text,
  is_unmapped boolean not null default false,
  sort_order integer not null default 0
);
create index if not exists accounting_gifi_lines_paper_idx on public.accounting_gifi_working_paper_lines(working_paper_id,sort_order,id);

-- -----------------------------------------------------------------------------
-- Compliance calendar + approvals + immutable evidence.
-- -----------------------------------------------------------------------------
create table if not exists public.accounting_compliance_obligations (
  id uuid primary key default gen_random_uuid(),
  obligation_key text not null unique,
  obligation_type text not null,
  authority text not null check(authority in ('CRA','ALBERTA_TRA','INTERNAL')),
  action_kind text not null check(action_kind in ('FILE','PAY','REMIT','INTERNAL')),
  title text not null,
  period_start date,
  period_end date,
  due_date date not null,
  due_date_requires_holiday_review boolean not null default true,
  status text not null default 'OPEN' check(status in ('OPEN','PREPARED','REVIEWED','APPROVED','FILED','PAID','WAIVED')),
  source_reference text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  prepared_by text,
  prepared_at timestamptz,
  reviewed_by text,
  reviewed_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  completed_by text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists accounting_compliance_obligations_due_idx on public.accounting_compliance_obligations(due_date,status,authority);

create table if not exists public.accounting_compliance_approvals (
  id bigint generated always as identity primary key,
  object_type text not null check(object_type in ('GIFI_WORKING_PAPER','ACCOUNTANT_PACKAGE','COMPLIANCE_OBLIGATION')),
  object_id text not null,
  action text not null check(action in ('PREPARE','REVIEW','APPROVE','WAIVE','REOPEN')),
  comment text,
  actor_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists accounting_compliance_approvals_object_idx on public.accounting_compliance_approvals(object_type,object_id,occurred_at desc);

create table if not exists public.accounting_filing_evidence (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.accounting_compliance_obligations(id) on delete restrict,
  evidence_type text not null check(evidence_type in ('FILING_CONFIRMATION','PAYMENT_CONFIRMATION','REMITTANCE_CONFIRMATION','OTHER')),
  final_status text not null check(final_status in ('FILED','PAID')),
  filed_or_paid_at timestamptz not null,
  confirmation_reference text not null,
  method text,
  amount numeric(14,2),
  accounting_document_id uuid references public.accounting_documents(id) on delete restrict,
  document_reference text,
  notes text,
  supersedes_evidence_id uuid references public.accounting_filing_evidence(id) on delete restrict,
  recorded_by text,
  recorded_at timestamptz not null default now()
);
drop index if exists public.accounting_filing_evidence_active_reference_uq;
create index if not exists accounting_filing_evidence_obligation_idx on public.accounting_filing_evidence(obligation_id,recorded_at desc);

-- -----------------------------------------------------------------------------
-- Accountant packages are immutable financial snapshots with review/approval state.
-- -----------------------------------------------------------------------------
create table if not exists public.accounting_accountant_packages (
  id uuid primary key default gen_random_uuid(),
  package_number text not null unique default ('ACP-'||lpad(nextval('public.accounting_accountant_package_number_seq')::text,6,'0')),
  tax_year_end_year integer not null,
  period_start date not null,
  period_end date not null,
  revision integer not null,
  status text not null default 'PREPARED' check(status in ('PREPARED','REVIEWED','APPROVED')),
  gifi_working_paper_id uuid references public.accounting_gifi_working_papers(id) on delete restrict,
  snapshot_json jsonb not null,
  snapshot_sha256 text not null,
  prepared_by text,
  prepared_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  notes text,
  unique(tax_year_end_year,revision)
);

-- -----------------------------------------------------------------------------
-- RLS / service-role-only access. CAL admin uses server-side service role.
-- -----------------------------------------------------------------------------
alter table public.accounting_compliance_settings enable row level security;
alter table public.accounting_gifi_codes enable row level security;
alter table public.accounting_gifi_account_mappings enable row level security;
alter table public.accounting_gifi_working_papers enable row level security;
alter table public.accounting_gifi_working_paper_lines enable row level security;
alter table public.accounting_compliance_obligations enable row level security;
alter table public.accounting_compliance_approvals enable row level security;
alter table public.accounting_filing_evidence enable row level security;
alter table public.accounting_accountant_packages enable row level security;

revoke all on public.accounting_compliance_settings,public.accounting_gifi_codes,public.accounting_gifi_account_mappings,
 public.accounting_gifi_working_papers,public.accounting_gifi_working_paper_lines,public.accounting_compliance_obligations,
 public.accounting_compliance_approvals,public.accounting_filing_evidence,public.accounting_accountant_packages from anon,authenticated;
grant select,insert,update,delete on public.accounting_compliance_settings,public.accounting_gifi_codes,public.accounting_gifi_account_mappings,
 public.accounting_gifi_working_papers,public.accounting_gifi_working_paper_lines,public.accounting_compliance_obligations,
 public.accounting_compliance_approvals,public.accounting_filing_evidence,public.accounting_accountant_packages to service_role;
grant usage,select on sequence public.accounting_gifi_working_paper_number_seq,public.accounting_accountant_package_number_seq to service_role;

-- -----------------------------------------------------------------------------
-- Immutability guards: evidence / approvals / snapshot payloads are append-only.
-- -----------------------------------------------------------------------------
create or replace function public.accounting_compliance_immutable_row()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'Compliance approval/evidence rows are immutable. Record a superseding evidence row instead.';
end $$;

drop trigger if exists trg_accounting_compliance_approvals_immutable on public.accounting_compliance_approvals;
create trigger trg_accounting_compliance_approvals_immutable before update or delete on public.accounting_compliance_approvals for each row execute function public.accounting_compliance_immutable_row();
drop trigger if exists trg_accounting_filing_evidence_immutable on public.accounting_filing_evidence;
create trigger trg_accounting_filing_evidence_immutable before update or delete on public.accounting_filing_evidence for each row execute function public.accounting_compliance_immutable_row();
drop trigger if exists trg_accounting_gifi_lines_immutable on public.accounting_gifi_working_paper_lines;
create trigger trg_accounting_gifi_lines_immutable before update or delete on public.accounting_gifi_working_paper_lines for each row execute function public.accounting_compliance_immutable_row();

create or replace function public.accounting_protect_accountant_package_snapshot()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.snapshot_json is distinct from old.snapshot_json
     or new.snapshot_sha256 is distinct from old.snapshot_sha256
     or new.period_start is distinct from old.period_start
     or new.period_end is distinct from old.period_end
     or new.tax_year_end_year is distinct from old.tax_year_end_year
     or new.revision is distinct from old.revision
     or new.gifi_working_paper_id is distinct from old.gifi_working_paper_id then
    raise exception 'Accountant package snapshot is immutable. Generate a new revision.';
  end if;
  return new;
end $$;
drop trigger if exists trg_accounting_package_snapshot_protect on public.accounting_accountant_packages;
create trigger trg_accounting_package_snapshot_protect before update on public.accounting_accountant_packages for each row execute function public.accounting_protect_accountant_package_snapshot();
drop trigger if exists trg_accounting_package_delete_protect on public.accounting_accountant_packages;
create trigger trg_accounting_package_delete_protect before delete on public.accounting_accountant_packages for each row execute function public.accounting_compliance_immutable_row();

-- -----------------------------------------------------------------------------
-- Date / fiscal-year helpers.
-- -----------------------------------------------------------------------------
create or replace function public.accounting_next_weekday(p_date date)
returns date language plpgsql immutable set search_path=public as $$
declare d date:=p_date;
begin
  while extract(isodow from d) in (6,7) loop d:=d+1; end loop;
  return d;
end $$;

create or replace function public.accounting_add_weekdays(p_date date,p_days integer)
returns date language plpgsql immutable set search_path=public as $$
declare d date:=p_date; n integer:=0;
begin
  while n<greatest(coalesce(p_days,0),0) loop
    d:=d+1;
    if extract(isodow from d) not in (6,7) then n:=n+1; end if;
  end loop;
  return d;
end $$;

create or replace function public.accounting_compliance_fiscal_year_bounds(p_tax_year_end_year integer)
returns table(period_start date,period_end date) language plpgsql stable set search_path=public as $$
declare fye text; m integer; d integer; last_day integer; v_end date;
begin
  select coalesce(nullif(fiscal_year_end,''),'12-31') into fye from public.accounting_company order by created_at limit 1;
  m:=split_part(fye,'-',1)::integer; d:=split_part(fye,'-',2)::integer;
  if m<1 or m>12 or d<1 or d>31 then raise exception 'Company fiscal_year_end must use MM-DD.'; end if;
  last_day:=extract(day from (make_date(p_tax_year_end_year,m,1)+interval '1 month - 1 day'))::integer;
  v_end:=make_date(p_tax_year_end_year,m,least(d,last_day));
  period_end:=v_end; period_start:=(v_end+1-interval '1 year')::date;
  return next;
end $$;

create or replace function public.accounting_closed_coverage_days(p_start date,p_end date)
returns integer language sql stable set search_path=public as $$
  select coalesce(sum((least(period_end,p_end)-greatest(period_start,p_start))+1),0)::integer
  from public.accounting_period_locks
  where period_end>=p_start and period_start<=p_end;
$$;

create or replace function public.accounting_trial_balance_difference_for_range(p_start date,p_end date)
returns numeric language sql stable set search_path=public as $$
  select round(coalesce(sum(l.debit-l.credit),0),2)
  from public.accounting_journal_lines l join public.accounting_journal_entries j on j.id=l.journal_entry_id
  where j.status='POSTED' and j.entry_date between p_start and p_end;
$$;

create or replace function public.accounting_gifi_account_amount(p_account_id uuid,p_account_type text,p_start date,p_end date)
returns numeric language sql stable set search_path=public as $$
  select round(coalesce(sum(
    case
      when upper(p_account_type)='ASSET' then l.debit-l.credit
      when upper(p_account_type) in ('LIABILITY','EQUITY') then l.credit-l.debit
      when upper(p_account_type)='REVENUE' then l.credit-l.debit
      when upper(p_account_type)='EXPENSE' then l.debit-l.credit
      else l.debit-l.credit
    end
  ),0),2)
  from public.accounting_journal_lines l join public.accounting_journal_entries j on j.id=l.journal_entry_id
  where l.account_id=p_account_id and j.status='POSTED'
    and j.entry_date<=p_end
    and (upper(p_account_type) in ('ASSET','LIABILITY','EQUITY') or j.entry_date>=p_start);
$$;

-- -----------------------------------------------------------------------------
-- GIFI mapping + immutable working paper revisions.
-- -----------------------------------------------------------------------------
create or replace function public.accounting_save_gifi_mapping(
  p_account_id uuid,p_gifi_code text,p_sign_multiplier numeric default 1,p_note text default null,p_actor_id text default null
) returns uuid language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.accounting_accounts where id=p_account_id and active=true) then raise exception 'Active GL account not found.'; end if;
  if not exists(select 1 from public.accounting_gifi_codes where code=p_gifi_code and active=true and statement_section not in ('TOTAL_CONTROL','RETAINED_EARNINGS')) then
    raise exception 'Select a verified non-total GIFI code from the reference catalog.';
  end if;
  if p_sign_multiplier not in (-1,1) then raise exception 'GIFI sign multiplier must be 1 or -1.'; end if;
  insert into public.accounting_gifi_account_mappings(account_id,gifi_code,sign_multiplier,mapping_note,mapping_source,reviewed_by,reviewed_at,updated_at)
  values(p_account_id,p_gifi_code,p_sign_multiplier,nullif(btrim(p_note),''),'ACCOUNTANT_REVIEWED',p_actor_id,now(),now())
  on conflict(account_id) do update set gifi_code=excluded.gifi_code,sign_multiplier=excluded.sign_multiplier,mapping_note=excluded.mapping_note,
    mapping_source='ACCOUNTANT_REVIEWED',reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,updated_at=now();
  return p_account_id;
end $$;

create or replace function public.accounting_generate_gifi_working_paper(p_tax_year_end_year integer,p_actor_id text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_start date;v_end date;v_revision integer;v_id uuid;v_unmapped integer;v_trial numeric;v_coverage integer;v_required integer;
        v_assets numeric;v_liabilities numeric;v_equity numeric;v_revenue numeric;v_expenses numeric;v_net numeric;v_current_assets numeric;v_tangible numeric;v_accum numeric;
begin
  select period_start,period_end into v_start,v_end from public.accounting_compliance_fiscal_year_bounds(p_tax_year_end_year);
  select coalesce(max(revision),0)+1 into v_revision from public.accounting_gifi_working_papers where tax_year_end_year=p_tax_year_end_year;
  v_trial:=public.accounting_trial_balance_difference_for_range(v_start,v_end);
  v_coverage:=public.accounting_closed_coverage_days(v_start,v_end); v_required:=(v_end-v_start)+1;
  insert into public.accounting_gifi_working_papers(tax_year_end_year,period_start,period_end,revision,status,source_trial_balance_difference,closed_coverage_days,required_coverage_days,prepared_by)
  values(p_tax_year_end_year,v_start,v_end,v_revision,'DRAFT',v_trial,v_coverage,v_required,p_actor_id) returning id into v_id;

  insert into public.accounting_gifi_working_paper_lines(working_paper_id,line_type,account_id,account_code,account_name,account_type,gifi_code,gifi_name,amount,mapping_source,mapping_note,is_unmapped,sort_order)
  select v_id,'ACCOUNT',a.id,a.code,a.name,a.account_type,m.gifi_code,g.name,
         round(public.accounting_gifi_account_amount(a.id,a.account_type,v_start,v_end)*coalesce(m.sign_multiplier,1),2),
         m.mapping_source,m.mapping_note,(m.account_id is null),case when a.code ~ '^[0-9]+$' then a.code::integer else 90000 end
  from public.accounting_accounts a
  left join public.accounting_gifi_account_mappings m on m.account_id=a.id
  left join public.accounting_gifi_codes g on g.code=m.gifi_code
  where a.active=true order by a.code;

  select count(*) into v_unmapped from public.accounting_gifi_working_paper_lines where working_paper_id=v_id and line_type='ACCOUNT' and is_unmapped and abs(amount)>0.004;
  update public.accounting_gifi_working_papers set unmapped_nonzero_count=v_unmapped where id=v_id;

  select coalesce(sum(case when account_type='ASSET' then amount else 0 end),0),
         coalesce(sum(case when account_type='LIABILITY' then amount else 0 end),0),
         coalesce(sum(case when account_type='EQUITY' then amount else 0 end),0),
         coalesce(sum(case when account_type='REVENUE' or coalesce(gifi_code,'')='8210' then amount else 0 end),0),
         coalesce(sum(case when account_type='EXPENSE' and coalesce(gifi_code,'')<>'8210' then amount else 0 end),0),
         coalesce(sum(case when account_type='ASSET' and coalesce(gifi_code,'') not in ('1740','1741') then amount else 0 end),0),
         coalesce(sum(case when gifi_code='1740' then amount else 0 end),0),
         coalesce(sum(case when gifi_code='1741' then amount else 0 end),0)
  into v_assets,v_liabilities,v_equity,v_revenue,v_expenses,v_current_assets,v_tangible,v_accum
  from public.accounting_gifi_working_paper_lines where working_paper_id=v_id and line_type='ACCOUNT';
  v_net:=round(v_revenue-v_expenses,2);

  insert into public.accounting_gifi_working_paper_lines(working_paper_id,line_type,gifi_code,gifi_name,amount,sort_order) values
    (v_id,'DERIVED_TOTAL','1599','Total current assets',round(v_current_assets,2),95001),
    (v_id,'DERIVED_TOTAL','2008','Total tangible capital assets',round(v_tangible,2),95002),
    (v_id,'DERIVED_TOTAL','2009','Total accumulated amortization of tangible capital assets',round(v_accum,2),95003),
    (v_id,'DERIVED_TOTAL','2599','Total assets',round(v_assets,2),95004),
    (v_id,'DERIVED_TOTAL','3139','Total current liabilities',round(v_liabilities,2),95005),
    (v_id,'DERIVED_TOTAL','3499','Total liabilities',round(v_liabilities,2),95006),
    (v_id,'DERIVED_TOTAL','3620','Total shareholder equity',round(v_equity,2),95007),
    (v_id,'DERIVED_TOTAL','3640','Total liabilities and shareholder equity',round(v_liabilities+v_equity,2),95008),
    (v_id,'DERIVED_TOTAL','8299','Total revenue',round(v_revenue,2),96001),
    (v_id,'DERIVED_TOTAL','9368','Total expenses',round(v_expenses,2),96002),
    (v_id,'DERIVED_TOTAL','9369','Net non-farming income',v_net,96003),
    (v_id,'DERIVED_TOTAL','9970','Net income/loss before taxes and extraordinary items',v_net,96004),
    (v_id,'DERIVED_TOTAL','9999','Net income/loss after taxes and extraordinary items',v_net,96005),
    (v_id,'DERIVED_TOTAL','3680','Net income/loss',v_net,97001);

  insert into public.accounting_compliance_approvals(object_type,object_id,action,actor_id,metadata)
  values('GIFI_WORKING_PAPER',v_id::text,'PREPARE',p_actor_id,jsonb_build_object('revision',v_revision,'period_start',v_start,'period_end',v_end,'unmapped_nonzero',v_unmapped,'closed_coverage_days',v_coverage,'required_coverage_days',v_required));
  return v_id;
end $$;

create or replace function public.accounting_review_gifi_working_paper(p_working_paper_id uuid,p_comment text,p_actor_id text default null)
returns text language plpgsql security definer set search_path=public as $$
begin
  if length(btrim(coalesce(p_comment,'')))<5 then raise exception 'Review comment must be at least 5 characters.'; end if;
  update public.accounting_gifi_working_papers set status='REVIEWED',reviewed_by=p_actor_id,reviewed_at=now(),notes=coalesce(nullif(btrim(p_comment),''),notes)
  where id=p_working_paper_id and status='DRAFT';
  if not found then raise exception 'GIFI working paper must be DRAFT to review.'; end if;
  insert into public.accounting_compliance_approvals(object_type,object_id,action,comment,actor_id) values('GIFI_WORKING_PAPER',p_working_paper_id::text,'REVIEW',p_comment,p_actor_id);
  return 'REVIEWED';
end $$;

create or replace function public.accounting_approve_gifi_working_paper(p_working_paper_id uuid,p_comment text,p_actor_id text default null)
returns text language plpgsql security definer set search_path=public as $$
declare p public.accounting_gifi_working_papers%rowtype;
begin
  select * into p from public.accounting_gifi_working_papers where id=p_working_paper_id for update; if not found then raise exception 'GIFI working paper not found.'; end if;
  if p.status<>'REVIEWED' then raise exception 'GIFI working paper must be REVIEWED before approval.'; end if;
  if p.unmapped_nonzero_count<>0 then raise exception 'Non-zero GL accounts remain unmapped to GIFI.'; end if;
  if abs(p.source_trial_balance_difference)>0.01 then raise exception 'Source Trial Balance is not balanced.'; end if;
  if p.closed_coverage_days<>p.required_coverage_days then raise exception 'Fiscal year is not fully covered by closed period locks.'; end if;
  update public.accounting_gifi_working_papers set status='APPROVED',approved_by=p_actor_id,approved_at=now(),notes=coalesce(nullif(btrim(p_comment),''),notes) where id=p_working_paper_id;
  insert into public.accounting_compliance_approvals(object_type,object_id,action,comment,actor_id) values('GIFI_WORKING_PAPER',p_working_paper_id::text,'APPROVE',nullif(btrim(p_comment),''),p_actor_id);
  return 'APPROVED';
end $$;

-- -----------------------------------------------------------------------------
-- Compliance calendar generation.
-- Statutory date rules are reference calculations; recognized public-holiday shifts
-- are flagged for final verification before filing/payment.
-- -----------------------------------------------------------------------------
create or replace function public.accounting_save_compliance_settings(
 p_gst_frequency text,p_federal_balance_months integer,p_alberta_balance_months integer,p_three_month_basis text,
 p_t2 boolean,p_at1 boolean,p_gst boolean,p_payroll boolean,p_t4 boolean,p_package boolean,p_notes text,p_actor_id text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;v_gst text:=upper(coalesce(p_gst_frequency,'UNCONFIGURED'));
begin
  if v_gst not in ('UNCONFIGURED','MONTHLY','QUARTERLY','ANNUAL') then raise exception 'Invalid GST/HST reporting frequency.'; end if;
  if p_federal_balance_months not in (2,3) or p_alberta_balance_months not in (2,3) then raise exception 'Corporate balance-due months must be 2 or 3.'; end if;
  if (p_federal_balance_months=3 or p_alberta_balance_months=3) and length(btrim(coalesce(p_three_month_basis,'')))<10 then
    raise exception 'Document the eligibility basis before using a three-month corporate balance-due date.';
  end if;
  select id into v_id from public.accounting_compliance_settings order by created_at limit 1;
  if v_id is null then
    insert into public.accounting_compliance_settings(gst_reporting_frequency,federal_balance_due_months,alberta_balance_due_months,three_month_balance_due_basis,t2_enabled,at1_enabled,gst_hst_enabled,payroll_remittance_enabled,t4_enabled,accountant_package_enabled,notes,updated_by)
    values(v_gst,p_federal_balance_months,p_alberta_balance_months,nullif(btrim(p_three_month_basis),''),p_t2,p_at1,p_gst,p_payroll,p_t4,p_package,nullif(btrim(p_notes),''),p_actor_id) returning id into v_id;
  else
    update public.accounting_compliance_settings set gst_reporting_frequency=v_gst,federal_balance_due_months=p_federal_balance_months,alberta_balance_due_months=p_alberta_balance_months,
      three_month_balance_due_basis=nullif(btrim(p_three_month_basis),''),t2_enabled=p_t2,at1_enabled=p_at1,gst_hst_enabled=p_gst,payroll_remittance_enabled=p_payroll,t4_enabled=p_t4,
      accountant_package_enabled=p_package,notes=nullif(btrim(p_notes),''),updated_by=p_actor_id,updated_at=now() where id=v_id;
  end if;
  return v_id;
end $$;

create or replace function public.accounting_upsert_compliance_obligation(
 p_key text,p_type text,p_authority text,p_action text,p_title text,p_start date,p_end date,p_due date,p_source text,p_holiday_review boolean,p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  insert into public.accounting_compliance_obligations(obligation_key,obligation_type,authority,action_kind,title,period_start,period_end,due_date,source_reference,due_date_requires_holiday_review,metadata,updated_at)
  values(p_key,p_type,p_authority,p_action,p_title,p_start,p_end,p_due,p_source,coalesce(p_holiday_review,true),coalesce(p_metadata,'{}'::jsonb),now())
  on conflict(obligation_key) do update set obligation_type=excluded.obligation_type,authority=excluded.authority,action_kind=excluded.action_kind,title=excluded.title,
    period_start=excluded.period_start,period_end=excluded.period_end,due_date=excluded.due_date,source_reference=excluded.source_reference,
    due_date_requires_holiday_review=excluded.due_date_requires_holiday_review,metadata=excluded.metadata,updated_at=now()
    where public.accounting_compliance_obligations.status in ('OPEN','PREPARED','REVIEWED','APPROVED')
  returning id into v_id;
  if v_id is null then select id into v_id from public.accounting_compliance_obligations where obligation_key=p_key; end if;
  return v_id;
end $$;

create or replace function public.accounting_generate_compliance_calendar(p_year integer,p_actor_id text default null)
returns integer language plpgsql security definer set search_path=public as $$
declare s public.accounting_compliance_settings%rowtype;ps public.accounting_payroll_settings%rowtype;c public.accounting_company%rowtype;
        fy_start date;fy_end date;d date;pe date;due date;q_start date;q_end date;m integer;count_rows integer:=0;rt text;
begin
  if p_year<2000 or p_year>2200 then raise exception 'Compliance calendar year is invalid.'; end if;
  select * into s from public.accounting_compliance_settings order by created_at limit 1;
  select * into ps from public.accounting_payroll_settings order by created_at limit 1;
  select * into c from public.accounting_company order by created_at limit 1;
  select period_start,period_end into fy_start,fy_end from public.accounting_compliance_fiscal_year_bounds(p_year);

  if s.t2_enabled then
    due:=public.accounting_next_weekday((fy_end+interval '6 months')::date);
    perform public.accounting_upsert_compliance_obligation('T2:'||fy_end,'T2_RETURN','CRA','FILE','T2 Corporation Income Tax Return',fy_start,fy_end,due,'CRA T2 filing deadline: within six months of tax year-end',true,jsonb_build_object('tax_year_end',fy_end));count_rows:=count_rows+1;
    due:=public.accounting_next_weekday((fy_end+make_interval(months=>s.federal_balance_due_months))::date);
    perform public.accounting_upsert_compliance_obligation('T2-BALANCE:'||fy_end,'CORPORATE_TAX_BALANCE','CRA','PAY','Federal corporate income tax balance',fy_start,fy_end,due,'CRA corporate balance due generally 2 months; certain eligible CCPCs 3 months',true,jsonb_build_object('configured_months',s.federal_balance_due_months,'eligibility_basis',s.three_month_balance_due_basis));count_rows:=count_rows+1;
  end if;
  if s.at1_enabled and upper(coalesce(c.province,'AB'))='AB' then
    due:=public.accounting_next_weekday((fy_end+interval '6 months')::date);
    perform public.accounting_upsert_compliance_obligation('AT1:'||fy_end,'AT1_RETURN','ALBERTA_TRA','FILE','Alberta Corporate Income Tax Return (AT1)',fy_start,fy_end,due,'Alberta TRA: AT1 due within six months of corporation tax year-end',true,jsonb_build_object('tax_year_end',fy_end));count_rows:=count_rows+1;
    due:=public.accounting_next_weekday((fy_end+make_interval(months=>s.alberta_balance_due_months))::date);
    perform public.accounting_upsert_compliance_obligation('AT1-BALANCE:'||fy_end,'ALBERTA_CORPORATE_TAX_BALANCE','ALBERTA_TRA','PAY','Alberta corporate income tax balance',fy_start,fy_end,due,'Alberta TRA: balance generally due 2 months after year-end; eligible CCPCs may use 3 months',true,jsonb_build_object('configured_months',s.alberta_balance_due_months,'eligibility_basis',s.three_month_balance_due_basis));count_rows:=count_rows+1;
  end if;

  if s.gst_hst_enabled and coalesce(c.gst_registered,false) then
    if s.gst_reporting_frequency='UNCONFIGURED' then
      perform public.accounting_upsert_compliance_obligation('GST-CONFIG:'||p_year,'GST_HST_CONFIGURATION','INTERNAL','INTERNAL','Confirm CRA-assigned GST/HST reporting frequency',make_date(p_year,1,1),make_date(p_year,12,31),make_date(p_year,1,15),'CRA reporting period must be confirmed in My Business Account / registration records',true,jsonb_build_object('blocking_configuration',true));count_rows:=count_rows+1;
    elsif s.gst_reporting_frequency='MONTHLY' then
      for m in 1..12 loop
        q_start:=make_date(p_year,m,1);q_end:=(q_start+interval '1 month - 1 day')::date;due:=public.accounting_next_weekday((q_end+interval '1 month')::date);
        perform public.accounting_upsert_compliance_obligation('GST-RETURN:'||q_end,'GST_HST_RETURN','CRA','FILE','GST/HST return - monthly',q_start,q_end,due,'CRA monthly GST/HST return due one month after reporting period end',true,jsonb_build_object('frequency','MONTHLY'));count_rows:=count_rows+1;
        perform public.accounting_upsert_compliance_obligation('GST-PAY:'||q_end,'GST_HST_PAYMENT','CRA','PAY','GST/HST payment - monthly',q_start,q_end,due,'CRA monthly GST/HST payment due one month after reporting period end',true,jsonb_build_object('frequency','MONTHLY'));count_rows:=count_rows+1;
      end loop;
    elsif s.gst_reporting_frequency='QUARTERLY' then
      for m in 0..3 loop
        q_start:=make_date(p_year,1+m*3,1);q_end:=(q_start+interval '3 months - 1 day')::date;due:=public.accounting_next_weekday((q_end+interval '1 month')::date);
        perform public.accounting_upsert_compliance_obligation('GST-RETURN:'||q_end,'GST_HST_RETURN','CRA','FILE','GST/HST return - quarterly',q_start,q_end,due,'CRA quarterly GST/HST return due one month after reporting period end',true,jsonb_build_object('frequency','QUARTERLY'));count_rows:=count_rows+1;
        perform public.accounting_upsert_compliance_obligation('GST-PAY:'||q_end,'GST_HST_PAYMENT','CRA','PAY','GST/HST payment - quarterly',q_start,q_end,due,'CRA quarterly GST/HST payment due one month after reporting period end',true,jsonb_build_object('frequency','QUARTERLY'));count_rows:=count_rows+1;
      end loop;
    elsif s.gst_reporting_frequency='ANNUAL' then
      due:=public.accounting_next_weekday((fy_end+interval '3 months')::date);
      perform public.accounting_upsert_compliance_obligation('GST-RETURN:'||fy_end,'GST_HST_RETURN','CRA','FILE','GST/HST return - annual',fy_start,fy_end,due,'CRA annual corporate GST/HST filing deadline generally three months after fiscal year-end',true,jsonb_build_object('frequency','ANNUAL'));count_rows:=count_rows+1;
      perform public.accounting_upsert_compliance_obligation('GST-PAY:'||fy_end,'GST_HST_PAYMENT','CRA','PAY','GST/HST payment - annual',fy_start,fy_end,due,'CRA annual corporate GST/HST payment deadline generally three months after fiscal year-end',true,jsonb_build_object('frequency','ANNUAL'));count_rows:=count_rows+1;
    end if;
  end if;

  if s.payroll_remittance_enabled then
    rt:=upper(coalesce(ps.remitter_type,'REGULAR'));
    if rt='QUARTERLY' then
      for m in 0..3 loop
        q_start:=make_date(p_year,1+m*3,1);q_end:=(q_start+interval '3 months - 1 day')::date;due:=public.accounting_next_weekday((q_end+15)::date);
        perform public.accounting_upsert_compliance_obligation('PAYROLL-REMIT:'||q_end,'PAYROLL_REMITTANCE','CRA','REMIT','Payroll source deductions - quarterly',q_start,q_end,due,'CRA quarterly remitter due on the 15th day of the month after quarter-end',true,jsonb_build_object('remitter_type',rt));count_rows:=count_rows+1;
      end loop;
    elsif rt='REGULAR' then
      for m in 1..12 loop
        q_start:=make_date(p_year,m,1);q_end:=(q_start+interval '1 month - 1 day')::date;due:=public.accounting_next_weekday(make_date(extract(year from q_end+interval '1 month')::int,extract(month from q_end+interval '1 month')::int,15));
        perform public.accounting_upsert_compliance_obligation('PAYROLL-REMIT:'||q_end,'PAYROLL_REMITTANCE','CRA','REMIT','Payroll source deductions - regular remitter',q_start,q_end,due,'CRA regular remitter due on the 15th day of the following month',true,jsonb_build_object('remitter_type',rt));count_rows:=count_rows+1;
      end loop;
    elsif rt='THRESHOLD_1' then
      for m in 1..12 loop
        q_start:=make_date(p_year,m,1);q_end:=make_date(p_year,m,15);due:=public.accounting_next_weekday(make_date(p_year,m,25));
        perform public.accounting_upsert_compliance_obligation('PAYROLL-T1:'||q_start||':'||q_end,'PAYROLL_REMITTANCE','CRA','REMIT','Payroll source deductions - accelerated threshold 1',q_start,q_end,due,'CRA Threshold 1: days 1-15 due the 25th of the same month',true,jsonb_build_object('remitter_type',rt,'segment','1-15'));count_rows:=count_rows+1;
        q_start:=make_date(p_year,m,16);q_end:=(make_date(p_year,m,1)+interval '1 month - 1 day')::date;d:=(q_end+1)::date;due:=public.accounting_next_weekday(make_date(extract(year from d)::int,extract(month from d)::int,10));
        perform public.accounting_upsert_compliance_obligation('PAYROLL-T1:'||q_start||':'||q_end,'PAYROLL_REMITTANCE','CRA','REMIT','Payroll source deductions - accelerated threshold 1',q_start,q_end,due,'CRA Threshold 1: days 16-month end due the 10th of the following month',true,jsonb_build_object('remitter_type',rt,'segment','16-END'));count_rows:=count_rows+1;
      end loop;
    elsif rt='THRESHOLD_2' then
      for m in 1..12 loop
        q_start:=make_date(p_year,m,1);q_end:=make_date(p_year,m,7);due:=public.accounting_add_weekdays(q_end,3);perform public.accounting_upsert_compliance_obligation('PAYROLL-T2:'||q_start||':'||q_end,'PAYROLL_REMITTANCE','CRA','REMIT','Payroll source deductions - accelerated threshold 2',q_start,q_end,due,'CRA Threshold 2: third working day after segment end; public-holiday review required',true,jsonb_build_object('remitter_type',rt,'segment','1-7'));count_rows:=count_rows+1;
        q_start:=make_date(p_year,m,8);q_end:=make_date(p_year,m,14);due:=public.accounting_add_weekdays(q_end,3);perform public.accounting_upsert_compliance_obligation('PAYROLL-T2:'||q_start||':'||q_end,'PAYROLL_REMITTANCE','CRA','REMIT','Payroll source deductions - accelerated threshold 2',q_start,q_end,due,'CRA Threshold 2: third working day after segment end; public-holiday review required',true,jsonb_build_object('remitter_type',rt,'segment','8-14'));count_rows:=count_rows+1;
        q_start:=make_date(p_year,m,15);q_end:=make_date(p_year,m,21);due:=public.accounting_add_weekdays(q_end,3);perform public.accounting_upsert_compliance_obligation('PAYROLL-T2:'||q_start||':'||q_end,'PAYROLL_REMITTANCE','CRA','REMIT','Payroll source deductions - accelerated threshold 2',q_start,q_end,due,'CRA Threshold 2: third working day after segment end; public-holiday review required',true,jsonb_build_object('remitter_type',rt,'segment','15-21'));count_rows:=count_rows+1;
        q_start:=make_date(p_year,m,22);q_end:=(make_date(p_year,m,1)+interval '1 month - 1 day')::date;due:=public.accounting_add_weekdays(q_end,3);perform public.accounting_upsert_compliance_obligation('PAYROLL-T2:'||q_start||':'||q_end,'PAYROLL_REMITTANCE','CRA','REMIT','Payroll source deductions - accelerated threshold 2',q_start,q_end,due,'CRA Threshold 2: third working day after month end; public-holiday review required',true,jsonb_build_object('remitter_type',rt,'segment','22-END'));count_rows:=count_rows+1;
      end loop;
    end if;
  end if;

  if s.t4_enabled then
    q_start:=make_date(p_year,1,1);q_end:=make_date(p_year,12,31);due:=public.accounting_next_weekday((make_date(p_year+1,3,1)-1)::date);
    perform public.accounting_upsert_compliance_obligation('T4:'||p_year,'T4_INFORMATION_RETURN','CRA','FILE','T4 information return',q_start,q_end,due,'CRA T4 information return due the last day of February following the calendar year',true,jsonb_build_object('calendar_year',p_year));count_rows:=count_rows+1;
  end if;
  return count_rows;
end $$;

create or replace function public.accounting_advance_compliance_obligation(p_obligation_id uuid,p_action text,p_comment text,p_actor_id text default null)
returns text language plpgsql security definer set search_path=public as $$
declare o public.accounting_compliance_obligations%rowtype;a text:=upper(coalesce(p_action,''));
begin
  select * into o from public.accounting_compliance_obligations where id=p_obligation_id for update; if not found then raise exception 'Compliance obligation not found.'; end if;
  if a='PREPARE' and o.status='OPEN' then update public.accounting_compliance_obligations set status='PREPARED',prepared_by=p_actor_id,prepared_at=now(),updated_at=now() where id=o.id;
  elsif a='REVIEW' and o.status='PREPARED' then update public.accounting_compliance_obligations set status='REVIEWED',reviewed_by=p_actor_id,reviewed_at=now(),updated_at=now() where id=o.id;
  elsif a='APPROVE' and o.status='REVIEWED' then update public.accounting_compliance_obligations set status='APPROVED',approved_by=p_actor_id,approved_at=now(),updated_at=now() where id=o.id;
  elsif a='WAIVE' and o.status in ('OPEN','PREPARED','REVIEWED','APPROVED') then
    if length(btrim(coalesce(p_comment,'')))<10 then raise exception 'Waiver reason must be at least 10 characters.'; end if;
    update public.accounting_compliance_obligations set status='WAIVED',notes=concat_ws(E'\n',notes,'WAIVER: '||p_comment),completed_by=p_actor_id,completed_at=now(),updated_at=now() where id=o.id;
  else raise exception 'Invalid compliance workflow transition from % using %.',o.status,a; end if;
  insert into public.accounting_compliance_approvals(object_type,object_id,action,comment,actor_id) values('COMPLIANCE_OBLIGATION',o.id::text,a,nullif(btrim(p_comment),''),p_actor_id);
  select status into a from public.accounting_compliance_obligations where id=o.id;return a;
end $$;

create or replace function public.accounting_record_filing_evidence(
 p_obligation_id uuid,p_final_status text,p_evidence_type text,p_when timestamptz,p_confirmation text,p_method text,p_amount numeric,
 p_document_id uuid,p_document_reference text,p_notes text,p_supersedes uuid,p_actor_id text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare o public.accounting_compliance_obligations%rowtype;v_id uuid;v_final text:=upper(coalesce(p_final_status,''));v_type text:=upper(coalesce(p_evidence_type,''));prev public.accounting_filing_evidence%rowtype;
begin
  select * into o from public.accounting_compliance_obligations where id=p_obligation_id for update; if not found then raise exception 'Compliance obligation not found.'; end if;
  if p_supersedes is null then
    if o.status<>'APPROVED' then raise exception 'Compliance obligation must be APPROVED before final evidence is recorded.'; end if;
  else
    select * into prev from public.accounting_filing_evidence where id=p_supersedes and obligation_id=o.id;
    if not found then raise exception 'Superseded evidence must belong to the same obligation.'; end if;
    if exists(select 1 from public.accounting_filing_evidence where supersedes_evidence_id=p_supersedes) then raise exception 'That evidence row has already been superseded.'; end if;
    if o.status not in ('FILED','PAID') then raise exception 'Evidence correction is allowed only for an already completed obligation.'; end if;
    if v_final<>o.status then raise exception 'Evidence correction cannot change the completed obligation status.'; end if;
  end if;
  if o.action_kind='FILE' and v_final<>'FILED' then raise exception 'Filing obligations require FILED evidence.'; end if;
  if o.action_kind in ('PAY','REMIT') and v_final<>'PAID' then raise exception 'Payment/remittance obligations require PAID evidence.'; end if;
  if o.action_kind='INTERNAL' then raise exception 'Internal obligations do not accept filing/payment evidence.'; end if;
  if v_type not in ('FILING_CONFIRMATION','PAYMENT_CONFIRMATION','REMITTANCE_CONFIRMATION','OTHER') then raise exception 'Invalid evidence type.'; end if;
  if o.action_kind='FILE' and v_type not in ('FILING_CONFIRMATION','OTHER') then raise exception 'Filing obligations require filing confirmation evidence.'; end if;
  if o.action_kind='PAY' and v_type not in ('PAYMENT_CONFIRMATION','OTHER') then raise exception 'Payment obligations require payment confirmation evidence.'; end if;
  if o.action_kind='REMIT' and v_type not in ('REMITTANCE_CONFIRMATION','PAYMENT_CONFIRMATION','OTHER') then raise exception 'Remittance obligations require remittance/payment confirmation evidence.'; end if;
  if length(btrim(coalesce(p_confirmation,'')))<3 then raise exception 'Confirmation/reference is required.'; end if;
  if p_amount is not null and p_amount<0 then raise exception 'Evidence amount cannot be negative.'; end if;
  if p_supersedes is null and exists(select 1 from public.accounting_filing_evidence where obligation_id=o.id and confirmation_reference=btrim(p_confirmation)) then
    raise exception 'Evidence with this confirmation already exists. Use a superseding correction if a correction is required.';
  end if;
  insert into public.accounting_filing_evidence(obligation_id,evidence_type,final_status,filed_or_paid_at,confirmation_reference,method,amount,accounting_document_id,document_reference,notes,supersedes_evidence_id,recorded_by)
  values(o.id,v_type,v_final,coalesce(p_when,now()),btrim(p_confirmation),nullif(btrim(p_method),''),p_amount,p_document_id,nullif(btrim(p_document_reference),''),nullif(btrim(p_notes),''),p_supersedes,p_actor_id) returning id into v_id;
  if p_supersedes is null then
    update public.accounting_compliance_obligations set status=v_final,completed_by=p_actor_id,completed_at=coalesce(p_when,now()),updated_at=now() where id=o.id;
  end if;
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- Accountant package snapshot.
-- Includes exact Trial Balance, GIFI revision, closed-period coverage, controls,
-- subledger reconciliations and compliance evidence manifest.
-- -----------------------------------------------------------------------------
create or replace function public.accounting_build_accountant_package_snapshot(p_tax_year_end_year integer,p_gifi_id uuid)
returns jsonb language plpgsql stable set search_path=public as $$
declare v_start date;v_end date;v_coverage integer;v_required integer;
  v_company jsonb;v_trial jsonb;v_bs jsonb;v_pl jsonb;v_ledger jsonb;v_gifi jsonb;v_controls jsonb;v_bank jsonb;v_ar jsonb;v_ap jsonb;v_inventory_detail jsonb;v_assets jsonb;v_payroll jsonb;v_t4 jsonb;v_compliance jsonb;v_evidence jsonb;
  v_inventory numeric:=0;v_inventory_gl numeric:=0;v_fa_gross numeric:=0;v_fa_gross_gl numeric:=0;v_fa_accum numeric:=0;v_fa_accum_gl numeric:=0;
begin
  select period_start,period_end into v_start,v_end from public.accounting_compliance_fiscal_year_bounds(p_tax_year_end_year);
  if not exists(select 1 from public.accounting_gifi_working_papers where id=p_gifi_id and tax_year_end_year=p_tax_year_end_year) then raise exception 'GIFI working paper does not belong to the requested fiscal year.'; end if;
  v_coverage:=public.accounting_closed_coverage_days(v_start,v_end);v_required:=(v_end-v_start)+1;
  select to_jsonb(c) into v_company from (select legal_name,operating_name,business_number,province,fiscal_year_end,currency,gst_registered,sales_tax_account_number from public.accounting_company order by created_at limit 1)c;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.code),'[]'::jsonb) into v_trial from (
    select a.code,a.name,a.account_type,
      round(coalesce(sum(case when j.entry_date between v_start and v_end then l.debit else 0 end),0),2) period_debits,
      round(coalesce(sum(case when j.entry_date between v_start and v_end then l.credit else 0 end),0),2) period_credits,
      round(coalesce(sum(case when j.entry_date<=v_end then l.debit-l.credit else 0 end),0),2) debit_credit_ending,
      round(coalesce(sum(case when j.entry_date<=v_end then case when a.account_type='ASSET' then l.debit-l.credit when a.account_type in ('LIABILITY','EQUITY') then l.credit-l.debit else 0 end else 0 end),0),2) balance_sheet_presentation
    from public.accounting_accounts a left join public.accounting_journal_lines l on l.account_id=a.id left join public.accounting_journal_entries j on j.id=l.journal_entry_id and j.status='POSTED'
    where a.active=true group by a.id,a.code,a.name,a.account_type
  )x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.account_type,x.code),'[]'::jsonb) into v_bs from (
    select a.code,a.name,a.account_type,round(coalesce(sum(case when j.entry_date<=v_end then case when a.account_type='ASSET' then l.debit-l.credit else l.credit-l.debit end else 0 end),0),2) amount
    from public.accounting_accounts a left join public.accounting_journal_lines l on l.account_id=a.id left join public.accounting_journal_entries j on j.id=l.journal_entry_id and j.status='POSTED'
    where a.active=true and a.account_type in ('ASSET','LIABILITY','EQUITY') group by a.id,a.code,a.name,a.account_type
  )x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.account_type,x.code),'[]'::jsonb) into v_pl from (
    select a.code,a.name,a.account_type,round(coalesce(sum(case when j.entry_date between v_start and v_end then case when a.account_type='REVENUE' then l.credit-l.debit else l.debit-l.credit end else 0 end),0),2) amount
    from public.accounting_accounts a left join public.accounting_journal_lines l on l.account_id=a.id left join public.accounting_journal_entries j on j.id=l.journal_entry_id and j.status='POSTED'
    where a.active=true and a.account_type in ('REVENUE','EXPENSE') group by a.id,a.code,a.name,a.account_type
  )x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.entry_date,x.entry_number,x.account_code,x.line_id),'[]'::jsonb) into v_ledger from (
    select j.entry_date,j.entry_number,j.memo,j.source_type,j.source_id,a.code account_code,a.name account_name,l.id line_id,l.debit,l.credit,l.description
    from public.accounting_journal_entries j join public.accounting_journal_lines l on l.journal_entry_id=j.id join public.accounting_accounts a on a.id=l.account_id
    where j.status='POSTED' and j.entry_date between v_start and v_end
  )x;
  select coalesce(jsonb_agg(jsonb_build_object('line_type',line_type,'account_code',account_code,'account_name',account_name,'account_type',account_type,'gifi_code',gifi_code,'gifi_name',gifi_name,'amount',amount,'mapping_source',mapping_source,'mapping_note',mapping_note,'is_unmapped',is_unmapped) order by sort_order,id),'[]'::jsonb)
    into v_gifi from public.accounting_gifi_working_paper_lines where working_paper_id=p_gifi_id;
  select coalesce(jsonb_agg(jsonb_build_object('period_start',p.period_start,'period_end',p.period_end,'close_version',p.close_version,'control_code',c.control_code,'status',c.status,'details',c.details) order by p.period_end,c.control_code),'[]'::jsonb)
    into v_controls from public.accounting_fiscal_periods p join public.accounting_period_close_checklist c on c.period_id=p.id where p.period_end>=v_start and p.period_start<=v_end;
  select coalesce(jsonb_agg(jsonb_build_object('number',r.reconciliation_number,'period_start',r.period_start,'period_end',r.period_end,'status',r.status,'difference',r.difference,'statement_reference',r.statement_reference,'closed_at',r.closed_at) order by r.period_end),'[]'::jsonb)
    into v_bank from public.accounting_bank_reconciliations r where r.period_end>=v_start and r.period_start<=v_end;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.invoice_date,x.invoice_number),'[]'::jsonb) into v_ar from (
    select i.invoice_number,i.invoice_date,i.due_date,i.status,i.total,i.paid_total,round(i.total-i.paid_total,2) open_balance,i.currency,coalesce(p.display_name,p.legal_name,p.party_number) customer
    from public.accounting_invoices i left join public.accounting_parties p on p.id=i.party_id where i.invoice_date<=v_end and i.status<>'VOID' and i.total-i.paid_total>0.004
  )x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.bill_date,x.bill_number),'[]'::jsonb) into v_ap from (
    select b.bill_number,b.supplier_invoice_number,b.bill_date,b.due_date,b.status,b.total,b.amount_paid,round(b.total-b.amount_paid,2) open_balance,b.currency,coalesce(p.display_name,p.legal_name,p.party_number) supplier
    from public.accounting_supplier_bills b left join public.accounting_parties p on p.id=b.supplier_party_id where b.bill_date<=v_end and b.status<>'VOID' and b.total-b.amount_paid>0.004
  )x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.sku,x.location_code),'[]'::jsonb) into v_inventory_detail from (
    select i.sku,i.name,i.unit_of_measure,l.code location_code,l.name location_name,round(sum(m.quantity_delta),4) quantity,round(sum(m.value_delta),2) value
    from public.accounting_inventory_movements m join public.accounting_inventory_items i on i.id=m.item_id join public.accounting_inventory_locations l on l.id=m.location_id
    where m.movement_date<=v_end group by i.id,i.sku,i.name,i.unit_of_measure,l.id,l.code,l.name having abs(sum(m.quantity_delta))>0.00005 or abs(sum(m.value_delta))>0.004
  )x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.asset_number),'[]'::jsonb) into v_assets from (
    select f.asset_number,f.name,f.category,f.serial_number,f.purchase_date,f.available_for_use_date,f.capital_cost,f.opening_accumulated_depreciation,f.residual_value,f.depreciation_method,f.book_useful_life_months,f.status,f.disposal_date,f.disposal_proceeds,f.source_type,f.source_reference,c.class_code cca_class,c.prescribed_rate cca_rate
    from public.accounting_fixed_assets f left join public.accounting_cca_classes c on c.id=f.cca_class_id where f.purchase_date<=v_end
  )x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.payment_date,x.run_number),'[]'::jsonb) into v_payroll from (
    select run_number,pay_frequency,period_start,period_end,payment_date,status,gross_pay,employee_cpp,employee_cpp2,employee_ei,income_tax,other_deductions,net_pay,employer_cpp,employer_cpp2,employer_ei,payment_reference
    from public.accounting_payroll_runs where status<>'VOID' and payment_date between v_start and v_end
  )x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.tax_year,x.employee_number),'[]'::jsonb) into v_t4 from (
    select w.tax_year,e.employee_number,coalesce(p.display_name,p.legal_name,p.party_number) employee,w.sin_last4,w.box14_employment_income,w.box16_cpp,w.box16a_cpp2,w.box18_ei,w.box22_income_tax,w.box24_ei_insurable_earnings,w.box26_cpp_pensionable_earnings,w.status
    from public.accounting_payroll_t4_working_papers w join public.accounting_payroll_employees e on e.id=w.employee_id join public.accounting_parties p on p.id=e.party_id
    where w.tax_year between extract(year from v_start)::integer and extract(year from v_end)::integer
  )x;
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'type',o.obligation_type,'authority',o.authority,'action',o.action_kind,'title',o.title,'period_start',o.period_start,'period_end',o.period_end,'due_date',o.due_date,'status',o.status,'source_reference',o.source_reference) order by o.due_date,o.title),'[]'::jsonb)
    into v_compliance from public.accounting_compliance_obligations o where coalesce(o.period_end,o.due_date)>=v_start and coalesce(o.period_start,o.due_date)<=(v_end+interval '6 months')::date;
  select coalesce(jsonb_agg(jsonb_build_object('obligation_id',e.obligation_id,'evidence_type',e.evidence_type,'final_status',e.final_status,'filed_or_paid_at',e.filed_or_paid_at,'confirmation_reference',e.confirmation_reference,'method',e.method,'amount',e.amount,'document_reference',e.document_reference,'supersedes_evidence_id',e.supersedes_evidence_id,'recorded_at',e.recorded_at) order by e.recorded_at),'[]'::jsonb)
    into v_evidence from public.accounting_filing_evidence e join public.accounting_compliance_obligations o on o.id=e.obligation_id where coalesce(o.period_end,o.due_date)>=v_start and coalesce(o.period_start,o.due_date)<=(v_end+interval '6 months')::date;

  begin v_inventory:=public.accounting_inventory_subledger_value_as_of(v_end); exception when others then v_inventory:=0; end;
  begin select coalesce(sum(case when a.code='1600' then l.debit-l.credit else 0 end),0) into v_inventory_gl from public.accounting_journal_lines l join public.accounting_journal_entries j on j.id=l.journal_entry_id join public.accounting_accounts a on a.id=l.account_id where j.status='POSTED' and j.entry_date<=v_end; exception when others then v_inventory_gl:=0; end;
  begin v_fa_gross:=public.accounting_fixed_asset_gross_subledger_value_as_of(v_end); exception when others then v_fa_gross:=0; end;
  begin v_fa_accum:=public.accounting_fixed_asset_accum_subledger_value_as_of(v_end); exception when others then v_fa_accum:=0; end;
  begin select coalesce(sum(case when a.code='1500' then l.debit-l.credit else 0 end),0),coalesce(sum(case when a.code='1510' then l.credit-l.debit else 0 end),0) into v_fa_gross_gl,v_fa_accum_gl from public.accounting_journal_lines l join public.accounting_journal_entries j on j.id=l.journal_entry_id join public.accounting_accounts a on a.id=l.account_id where j.status='POSTED' and j.entry_date<=v_end; exception when others then v_fa_gross_gl:=0;v_fa_accum_gl:=0; end;
  return jsonb_build_object(
    'schema_version','STEP18.10-2','generated_at',now(),'company',v_company,'tax_year_end_year',p_tax_year_end_year,'period_start',v_start,'period_end',v_end,
    'close_coverage',jsonb_build_object('closed_days',v_coverage,'required_days',v_required,'complete',v_coverage=v_required),
    'trial_balance',v_trial,'trial_balance_difference',public.accounting_trial_balance_difference_for_range(v_start,v_end),'balance_sheet',v_bs,'income_statement',v_pl,'general_ledger',v_ledger,
    'gifi_working_paper_id',p_gifi_id,'gifi_lines',v_gifi,'period_close_controls',v_controls,'bank_reconciliations',v_bank,
    'accounts_receivable_open',v_ar,'accounts_payable_open',v_ap,'inventory_detail_as_of',v_inventory_detail,'fixed_asset_register',v_assets,'payroll_runs',v_payroll,'t4_working_papers',v_t4,
    'inventory_reconciliation',jsonb_build_object('subledger',round(v_inventory,2),'gl_1600',round(v_inventory_gl,2),'difference',round(v_inventory_gl-v_inventory,2)),
    'fixed_assets_reconciliation',jsonb_build_object('gross_subledger',round(v_fa_gross,2),'gross_gl_1500',round(v_fa_gross_gl,2),'gross_difference',round(v_fa_gross_gl-v_fa_gross,2),'accum_subledger',round(v_fa_accum,2),'accum_gl_1510',round(v_fa_accum_gl,2),'accum_difference',round(v_fa_accum_gl-v_fa_accum,2)),
    'ar_control_gl',coalesce((select round(sum(case when a.code='1100' then l.debit-l.credit else 0 end),2) from public.accounting_journal_lines l join public.accounting_journal_entries j on j.id=l.journal_entry_id join public.accounting_accounts a on a.id=l.account_id where j.status='POSTED' and j.entry_date<=v_end),0),
    'ap_control_gl',coalesce((select round(sum(case when a.code='2000' then l.credit-l.debit else 0 end),2) from public.accounting_journal_lines l join public.accounting_journal_entries j on j.id=l.journal_entry_id join public.accounting_accounts a on a.id=l.account_id where j.status='POSTED' and j.entry_date<=v_end),0),
    'payroll_control',jsonb_build_object('net_payable_gl',coalesce((select round(sum(case when a.code='2030' then l.credit-l.debit else 0 end),2) from public.accounting_journal_lines l join public.accounting_journal_entries j on j.id=l.journal_entry_id join public.accounting_accounts a on a.id=l.account_id where j.status='POSTED' and j.entry_date<=v_end),0),'source_deductions_gl',coalesce((select round(sum(case when a.code in ('2040','2050','2060','2070') then l.credit-l.debit else 0 end),2) from public.accounting_journal_lines l join public.accounting_journal_entries j on j.id=l.journal_entry_id join public.accounting_accounts a on a.id=l.account_id where j.status='POSTED' and j.entry_date<=v_end),0)),
    'tax_control',jsonb_build_object('recoverable_gl',coalesce((select round(sum(case when a.code in ('1200','1210') then l.debit-l.credit else 0 end),2) from public.accounting_journal_lines l join public.accounting_journal_entries j on j.id=l.journal_entry_id join public.accounting_accounts a on a.id=l.account_id where j.status='POSTED' and j.entry_date<=v_end),0),'payable_gl',coalesce((select round(sum(case when a.code in ('2100','2110') then l.credit-l.debit else 0 end),2) from public.accounting_journal_lines l join public.accounting_journal_entries j on j.id=l.journal_entry_id join public.accounting_accounts a on a.id=l.account_id where j.status='POSTED' and j.entry_date<=v_end),0)),
    'compliance_obligations',v_compliance,'filing_payment_evidence',v_evidence,
    'disclaimer','Working papers only. CAL does not transmit T2, AT1, GST/HST or T4 filings and does not replace certified tax preparation software or professional review.'
  );
end $$;

create or replace function public.accounting_generate_accountant_package(p_tax_year_end_year integer,p_actor_id text default null)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_start date;v_end date;v_revision integer;v_gifi uuid;v_snapshot jsonb;v_hash text;v_id uuid;
begin
  select period_start,period_end into v_start,v_end from public.accounting_compliance_fiscal_year_bounds(p_tax_year_end_year);
  select id into v_gifi from public.accounting_gifi_working_papers where tax_year_end_year=p_tax_year_end_year order by case status when 'APPROVED' then 1 when 'REVIEWED' then 2 else 3 end,revision desc limit 1;
  if v_gifi is null then v_gifi:=public.accounting_generate_gifi_working_paper(p_tax_year_end_year,p_actor_id); end if;
  select coalesce(max(revision),0)+1 into v_revision from public.accounting_accountant_packages where tax_year_end_year=p_tax_year_end_year;
  v_snapshot:=public.accounting_build_accountant_package_snapshot(p_tax_year_end_year,v_gifi);
  v_hash:=encode(digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
  insert into public.accounting_accountant_packages(tax_year_end_year,period_start,period_end,revision,status,gifi_working_paper_id,snapshot_json,snapshot_sha256,prepared_by)
  values(p_tax_year_end_year,v_start,v_end,v_revision,'PREPARED',v_gifi,v_snapshot,v_hash,p_actor_id) returning id into v_id;
  insert into public.accounting_compliance_approvals(object_type,object_id,action,actor_id,metadata) values('ACCOUNTANT_PACKAGE',v_id::text,'PREPARE',p_actor_id,jsonb_build_object('revision',v_revision,'snapshot_sha256',v_hash));
  return v_id;
end $$;

create or replace function public.accounting_review_accountant_package(p_package_id uuid,p_comment text,p_actor_id text default null)
returns text language plpgsql security definer set search_path=public as $$
begin
  if length(btrim(coalesce(p_comment,'')))<5 then raise exception 'Review comment must be at least 5 characters.'; end if;
  update public.accounting_accountant_packages set status='REVIEWED',reviewed_by=p_actor_id,reviewed_at=now(),notes=coalesce(nullif(btrim(p_comment),''),notes) where id=p_package_id and status='PREPARED';
  if not found then raise exception 'Accountant package must be PREPARED to review.'; end if;
  insert into public.accounting_compliance_approvals(object_type,object_id,action,comment,actor_id) values('ACCOUNTANT_PACKAGE',p_package_id::text,'REVIEW',p_comment,p_actor_id);return 'REVIEWED';
end $$;

create or replace function public.accounting_approve_accountant_package(p_package_id uuid,p_comment text,p_actor_id text default null)
returns text language plpgsql security definer set search_path=public as $$
declare p public.accounting_accountant_packages%rowtype;g public.accounting_gifi_working_papers%rowtype;v_cov integer;v_req integer;
begin
  select * into p from public.accounting_accountant_packages where id=p_package_id for update; if not found then raise exception 'Accountant package not found.'; end if;
  if p.status<>'REVIEWED' then raise exception 'Accountant package must be REVIEWED before approval.'; end if;
  select * into g from public.accounting_gifi_working_papers where id=p.gifi_working_paper_id;
  if g.status<>'APPROVED' then raise exception 'The package GIFI working paper must be APPROVED first.'; end if;
  v_cov:=public.accounting_closed_coverage_days(p.period_start,p.period_end);v_req:=(p.period_end-p.period_start)+1;
  if v_cov<>v_req then raise exception 'Fiscal year is not fully closed. Complete Period Close coverage before approving the package.'; end if;
  if abs(coalesce((p.snapshot_json->>'trial_balance_difference')::numeric,0))>0.01 then raise exception 'Accountant package Trial Balance is not balanced.'; end if;
  if abs(coalesce((p.snapshot_json#>>'{inventory_reconciliation,difference}')::numeric,0))>0.02 then raise exception 'Inventory subledger does not reconcile to GL 1600.'; end if;
  if abs(coalesce((p.snapshot_json#>>'{fixed_assets_reconciliation,gross_difference}')::numeric,0))>0.02 or abs(coalesce((p.snapshot_json#>>'{fixed_assets_reconciliation,accum_difference}')::numeric,0))>0.02 then raise exception 'Fixed Assets subledger does not reconcile to GL 1500/1510.'; end if;
  update public.accounting_accountant_packages set status='APPROVED',approved_by=p_actor_id,approved_at=now(),notes=coalesce(nullif(btrim(p_comment),''),notes) where id=p.id;
  insert into public.accounting_compliance_approvals(object_type,object_id,action,comment,actor_id) values('ACCOUNTANT_PACKAGE',p.id::text,'APPROVE',nullif(btrim(p_comment),''),p_actor_id);return 'APPROVED';
end $$;

-- Grants for RPCs used only through the server-side service role.
revoke all on function public.accounting_save_gifi_mapping(uuid,text,numeric,text,text) from public,anon,authenticated;
revoke all on function public.accounting_generate_gifi_working_paper(integer,text) from public,anon,authenticated;
revoke all on function public.accounting_review_gifi_working_paper(uuid,text,text) from public,anon,authenticated;
revoke all on function public.accounting_approve_gifi_working_paper(uuid,text,text) from public,anon,authenticated;
revoke all on function public.accounting_save_compliance_settings(text,integer,integer,text,boolean,boolean,boolean,boolean,boolean,boolean,text,text) from public,anon,authenticated;
revoke all on function public.accounting_generate_compliance_calendar(integer,text) from public,anon,authenticated;
revoke all on function public.accounting_advance_compliance_obligation(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.accounting_record_filing_evidence(uuid,text,text,timestamptz,text,text,numeric,uuid,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.accounting_generate_accountant_package(integer,text) from public,anon,authenticated;
revoke all on function public.accounting_review_accountant_package(uuid,text,text) from public,anon,authenticated;
revoke all on function public.accounting_approve_accountant_package(uuid,text,text) from public,anon,authenticated;

grant execute on function public.accounting_save_gifi_mapping(uuid,text,numeric,text,text) to service_role;
grant execute on function public.accounting_generate_gifi_working_paper(integer,text) to service_role;
grant execute on function public.accounting_review_gifi_working_paper(uuid,text,text) to service_role;
grant execute on function public.accounting_approve_gifi_working_paper(uuid,text,text) to service_role;
grant execute on function public.accounting_save_compliance_settings(text,integer,integer,text,boolean,boolean,boolean,boolean,boolean,boolean,text,text) to service_role;
grant execute on function public.accounting_generate_compliance_calendar(integer,text) to service_role;
grant execute on function public.accounting_advance_compliance_obligation(uuid,text,text,text) to service_role;
grant execute on function public.accounting_record_filing_evidence(uuid,text,text,timestamptz,text,text,numeric,uuid,text,text,uuid,text) to service_role;
grant execute on function public.accounting_generate_accountant_package(integer,text) to service_role;
grant execute on function public.accounting_review_accountant_package(uuid,text,text) to service_role;
grant execute on function public.accounting_approve_accountant_package(uuid,text,text) to service_role;

commit;
