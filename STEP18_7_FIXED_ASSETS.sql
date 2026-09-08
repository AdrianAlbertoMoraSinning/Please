-- PLEASE / CAL — STEP 18.7: Fixed Assets
-- Safe additive migration. Run AFTER STEP18_6_INVENTORY_ACCOUNTING.sql.
-- Scope: fixed asset register, source-backed capitalization intake, opening assets,
-- straight-line book depreciation, disposals, CCA/UCC working papers and GL reconciliation.
-- Book depreciation and tax CCA remain intentionally separate.

begin;

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.accounting_inventory_items') is null
     or to_regclass('public.accounting_supplier_bills') is null
     or to_regclass('public.accounting_expense_claims') is null then
    raise exception 'STEP 18.2, STEP 18.4 and STEP 18.6 are required before STEP 18.7.';
  end if;
  if to_regclass('public.please_accounting_outbox') is null
     or to_regprocedure('public.accounting_enqueue_event(text,text,text,text,jsonb,timestamptz,integer,text,text,text)') is null then
    raise exception 'STEP 17 Native Accounting Engine is required before STEP 18.7.';
  end if;
end $$;

-- Book control accounts. Existing customized accounts are preserved.
insert into public.accounting_accounts(code,name,account_type,account_subtype,active,system_managed,allow_manual_posting)
values
 ('1500','Equipment & Vehicles','ASSET','FIXED_ASSET',true,true,true),
 ('1510','Accumulated Depreciation - Equipment & Vehicles','ASSET','CONTRA_FIXED_ASSET',true,true,true),
 ('4050','Gain on Disposal of Fixed Assets','REVENUE','FIXED_ASSET_DISPOSAL_GAIN',true,true,true),
 ('6200','Depreciation Expense','EXPENSE','DEPRECIATION',true,true,true),
 ('6300','Loss on Disposal of Fixed Assets','EXPENSE','FIXED_ASSET_DISPOSAL_LOSS',true,true,true)
on conflict(code) do nothing;
update public.accounting_accounts set system_managed=true,updated_at=now()
where code in ('1500','1510','4050','6200','6300');

create sequence if not exists public.accounting_fixed_asset_number_seq start with 1001;
create sequence if not exists public.accounting_depreciation_run_number_seq start with 1001;

-- CRA CCA classes are reference metadata only. First-year/special rules remain accountant-reviewed.
create table if not exists public.accounting_cca_classes (
  id uuid primary key default gen_random_uuid(),
  class_code text not null unique,
  name text not null,
  prescribed_rate numeric(9,6) not null default 0 check(prescribed_rate>=0 and prescribed_rate<=1),
  calculation_method text not null default 'DECLINING_BALANCE' check(calculation_method in ('DECLINING_BALANCE','STRAIGHT_LINE','SPECIAL')),
  first_year_rule text not null default 'ACCOUNTANT_REVIEW',
  passenger_vehicle_limit_review boolean not null default false,
  notes text,
  active boolean not null default true,
  system_managed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.accounting_cca_classes(class_code,name,prescribed_rate,calculation_method,first_year_rule,passenger_vehicle_limit_review,notes)
values
 ('1','Buildings acquired after 1987',0.04,'DECLINING_BALANCE','ACCOUNTANT_REVIEW',false,'Building subclasses/additional allowances require accountant review.'),
 ('8','Other tangible capital property / equipment',0.20,'DECLINING_BALANCE','ACCOUNTANT_REVIEW',false,'Common equipment/furniture class; verify property-specific eligibility.'),
 ('10','Motor vehicles and certain automotive equipment',0.30,'DECLINING_BALANCE','ACCOUNTANT_REVIEW',false,'Passenger vehicle and other exclusions may change class treatment.'),
 ('10.1','Passenger vehicles over prescribed cost threshold',0.30,'DECLINING_BALANCE','ACCOUNTANT_REVIEW',true,'Passenger vehicle prescribed limits and disposition rules require review.'),
 ('12','Certain tools, software and other prescribed property',1.00,'DECLINING_BALANCE','ACCOUNTANT_REVIEW',false,'100% prescribed rate does not remove first-year/specific-property review.'),
 ('13','Leasehold interests',0.00,'STRAIGHT_LINE','ACCOUNTANT_REVIEW',false,'Deduction depends on lease term and statutory rules.'),
 ('14.1','Goodwill and eligible capital property',0.05,'DECLINING_BALANCE','ACCOUNTANT_REVIEW',false,'Intangible property rules require accountant review.'),
 ('16','Taxis, rental vehicles and certain heavy trucks',0.40,'DECLINING_BALANCE','ACCOUNTANT_REVIEW',false,'Verify vehicle use and eligibility.'),
 ('43.1','Specified clean energy equipment',0.30,'DECLINING_BALANCE','ENHANCED_FIRST_YEAR_REVIEW',false,'Enhanced/full-expensing rules depend on acquisition and available-for-use date.'),
 ('50','Computer equipment and systems equipment',0.55,'DECLINING_BALANCE','ACCOUNTANT_REVIEW',false,'Verify acquisition date and property eligibility.'),
 ('54','Zero-emission vehicles otherwise Class 10/10.1',0.30,'DECLINING_BALANCE','ZEV_ENHANCED_REVIEW',true,'Enhanced first-year and prescribed passenger vehicle limits require review.'),
 ('55','Zero-emission vehicles otherwise Class 16',0.40,'DECLINING_BALANCE','ZEV_ENHANCED_REVIEW',false,'Enhanced first-year rules require review.'),
 ('56','Certain zero-emission automotive equipment/vehicles',0.30,'DECLINING_BALANCE','ZEV_ENHANCED_REVIEW',false,'Eligibility and enhanced first-year rules require review.')
on conflict(class_code) do update set name=excluded.name,prescribed_rate=excluded.prescribed_rate,calculation_method=excluded.calculation_method,first_year_rule=excluded.first_year_rule,passenger_vehicle_limit_review=excluded.passenger_vehicle_limit_review,notes=excluded.notes,active=true,system_managed=true,updated_at=now();

create table if not exists public.accounting_fixed_assets (
  id uuid primary key default gen_random_uuid(),
  asset_number text not null unique default ('FA-'||lpad(nextval('public.accounting_fixed_asset_number_seq')::text,6,'0')),
  name text not null,
  description text,
  category text,
  serial_number text,
  location_text text,
  responsible_party_id uuid references public.accounting_parties(id) on delete restrict,
  supplier_party_id uuid references public.accounting_parties(id) on delete restrict,
  purchase_date date not null,
  available_for_use_date date,
  depreciation_start_date date,
  currency text not null default 'CAD',
  capital_cost numeric(14,2) not null default 0 check(capital_cost>=0),
  recoverable_tax numeric(14,2) not null default 0 check(recoverable_tax>=0),
  residual_value numeric(14,2) not null default 0 check(residual_value>=0),
  opening_accumulated_depreciation numeric(14,2) not null default 0 check(opening_accumulated_depreciation>=0),
  depreciation_method text not null default 'STRAIGHT_LINE' check(depreciation_method in ('STRAIGHT_LINE','NONE')),
  book_useful_life_months integer check(book_useful_life_months is null or book_useful_life_months>0),
  asset_account_id uuid not null references public.accounting_accounts(id) on delete restrict,
  accumulated_depreciation_account_id uuid not null references public.accounting_accounts(id) on delete restrict,
  depreciation_expense_account_id uuid not null references public.accounting_accounts(id) on delete restrict,
  cca_class_id uuid references public.accounting_cca_classes(id) on delete restrict,
  tax_capital_cost numeric(14,2) not null default 0 check(tax_capital_cost>=0),
  tax_opening_ucc numeric(14,2) not null default 0 check(tax_opening_ucc>=0),
  tax_opening_year integer,
  source_type text not null default 'MANUAL' check(source_type in ('SUPPLIER_BILL','EXPENSE','OPENING','MANUAL')),
  source_table text,
  source_record_id text,
  source_line_id text,
  source_reference text,
  source_posted boolean not null default false,
  document_reference text,
  notes text,
  status text not null default 'PENDING_SETUP' check(status in ('PENDING_SETUP','ACTIVE','INACTIVE','DISPOSED')),
  disposal_date date,
  disposal_proceeds numeric(14,2) check(disposal_proceeds is null or disposal_proceeds>=0),
  disposal_financial_account_id uuid references public.accounting_financial_accounts(id) on delete restrict,
  disposal_reference text,
  disposal_notes text,
  disposal_accumulated_depreciation numeric(14,2),
  disposal_net_book_value numeric(14,2),
  disposal_gain_loss numeric(14,2),
  tax_disposition_proceeds numeric(14,2),
  created_by text,
  updated_by text,
  disposed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disposed_at timestamptz,
  check(residual_value<=capital_cost+0.001),
  check(opening_accumulated_depreciation<=capital_cost+0.001),
  check(tax_capital_cost>=0),
  unique(source_table,source_line_id)
);
create index if not exists accounting_fixed_assets_status_idx on public.accounting_fixed_assets(status,purchase_date desc);
create index if not exists accounting_fixed_assets_cca_idx on public.accounting_fixed_assets(cca_class_id,status);
create index if not exists accounting_fixed_assets_source_idx on public.accounting_fixed_assets(source_type,source_record_id,source_line_id);

create table if not exists public.accounting_fixed_asset_depreciation_runs (
  id uuid primary key default gen_random_uuid(),
  run_number text not null unique default ('DEP-'||lpad(nextval('public.accounting_depreciation_run_number_seq')::text,6,'0')),
  period_end date not null unique,
  convention text not null default 'FULL_MONTH' check(convention in ('FULL_MONTH')),
  total_depreciation numeric(14,2) not null default 0,
  status text not null default 'DRAFT' check(status in ('DRAFT','POSTED','VOID')),
  created_by text,
  posted_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  posted_at timestamptz
);

create table if not exists public.accounting_fixed_asset_depreciation_lines (
  id uuid primary key default gen_random_uuid(),
  depreciation_run_id uuid not null references public.accounting_fixed_asset_depreciation_runs(id) on delete restrict,
  asset_id uuid not null references public.accounting_fixed_assets(id) on delete restrict,
  opening_net_book_value numeric(14,2) not null,
  opening_accumulated_depreciation numeric(14,2) not null,
  depreciation_amount numeric(14,2) not null check(depreciation_amount>=0),
  closing_accumulated_depreciation numeric(14,2) not null,
  closing_net_book_value numeric(14,2) not null,
  months_elapsed integer not null default 0,
  created_at timestamptz not null default now(),
  unique(depreciation_run_id,asset_id)
);
create index if not exists accounting_fixed_asset_dep_lines_asset_idx on public.accounting_fixed_asset_depreciation_lines(asset_id,depreciation_run_id);

create table if not exists public.accounting_cca_working_papers (
  id uuid primary key default gen_random_uuid(),
  tax_year integer not null check(tax_year between 2000 and 2200),
  cca_class_id uuid not null references public.accounting_cca_classes(id) on delete restrict,
  opening_ucc numeric(14,2) not null default 0,
  additions numeric(14,2) not null default 0,
  disposition_reduction numeric(14,2) not null default 0,
  pre_cca_ucc numeric(14,2) not null default 0,
  prescribed_rate numeric(9,6) not null default 0,
  rate_reference_amount numeric(14,2) not null default 0,
  cca_claimed numeric(14,2) not null default 0 check(cca_claimed>=0),
  closing_ucc numeric(14,2) not null default 0,
  recapture_candidate numeric(14,2) not null default 0,
  terminal_loss_candidate numeric(14,2) not null default 0,
  class_empty_at_year_end boolean not null default false,
  review_flags text[] not null default '{}',
  status text not null default 'DRAFT' check(status in ('DRAFT','REVIEWED')),
  notes text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tax_year,cca_class_id)
);
create index if not exists accounting_cca_working_papers_year_idx on public.accounting_cca_working_papers(tax_year,cca_class_id);

-- Link source expense/purchase lines to their generated fixed-asset intake record.
alter table public.accounting_supplier_bill_lines add column if not exists fixed_asset_id uuid references public.accounting_fixed_assets(id) on delete restrict;
alter table public.accounting_expense_claim_lines add column if not exists fixed_asset_id uuid references public.accounting_fixed_assets(id) on delete restrict;

-- Touch helpers.
drop trigger if exists trg_accounting_cca_class_touch on public.accounting_cca_classes;
create trigger trg_accounting_cca_class_touch before update on public.accounting_cca_classes for each row execute function public.accounting_touch_updated_at();
drop trigger if exists trg_accounting_fixed_asset_touch on public.accounting_fixed_assets;
create trigger trg_accounting_fixed_asset_touch before update on public.accounting_fixed_assets for each row execute function public.accounting_touch_updated_at();
drop trigger if exists trg_accounting_fixed_asset_dep_run_touch on public.accounting_fixed_asset_depreciation_runs;
create trigger trg_accounting_fixed_asset_dep_run_touch before update on public.accounting_fixed_asset_depreciation_runs for each row execute function public.accounting_touch_updated_at();
drop trigger if exists trg_accounting_cca_paper_touch on public.accounting_cca_working_papers;
create trigger trg_accounting_cca_paper_touch before update on public.accounting_cca_working_papers for each row execute function public.accounting_touch_updated_at();

-- Posted depreciation lines/runs and disposed asset financial facts are immutable.
create or replace function public.accounting_protect_fixed_asset_depreciation()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare v_status text;
begin
  if tg_table_name='accounting_fixed_asset_depreciation_runs' then
    if tg_op='DELETE' and old.status='POSTED' then raise exception 'Posted depreciation runs are immutable.'; end if;
    if tg_op='UPDATE' and old.status='POSTED' and to_jsonb(new) is distinct from to_jsonb(old) then raise exception 'Posted depreciation runs are immutable.'; end if;
  else
    select status into v_status from public.accounting_fixed_asset_depreciation_runs where id=coalesce(new.depreciation_run_id,old.depreciation_run_id);
    if v_status='POSTED' then raise exception 'Lines of a posted depreciation run are immutable.'; end if;
  end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
drop trigger if exists trg_protect_fixed_asset_dep_run on public.accounting_fixed_asset_depreciation_runs;
create trigger trg_protect_fixed_asset_dep_run before update or delete on public.accounting_fixed_asset_depreciation_runs for each row execute function public.accounting_protect_fixed_asset_depreciation();
drop trigger if exists trg_protect_fixed_asset_dep_line on public.accounting_fixed_asset_depreciation_lines;
create trigger trg_protect_fixed_asset_dep_line before update or delete on public.accounting_fixed_asset_depreciation_lines for each row execute function public.accounting_protect_fixed_asset_depreciation();

create or replace function public.accounting_fixed_asset_source_register(
  p_source_type text,p_source_table text,p_source_record_id text,p_source_line_id text,p_source_reference text,
  p_name text,p_purchase_date date,p_supplier_party_id uuid,p_capital_cost numeric,p_recoverable_tax numeric,p_currency text,p_actor_id text
) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid;v_asset uuid;v_accum uuid;v_dep uuid;v_cost numeric(14,2):=round(coalesce(p_capital_cost,0),2);
begin
  if v_cost<=0 then raise exception 'Fixed asset source cost must be positive.';end if;
  if nullif(trim(p_source_line_id),'') is null then raise exception 'Fixed asset source line is required.';end if;
  select id into v_id from public.accounting_fixed_assets where source_table=p_source_table and source_line_id=p_source_line_id limit 1;
  if v_id is not null then return v_id;end if;
  select id into v_asset from public.accounting_accounts where code='1500';
  select id into v_accum from public.accounting_accounts where code='1510';
  select id into v_dep from public.accounting_accounts where code='6200';
  insert into public.accounting_fixed_assets(name,purchase_date,available_for_use_date,currency,capital_cost,recoverable_tax,residual_value,opening_accumulated_depreciation,depreciation_method,asset_account_id,accumulated_depreciation_account_id,depreciation_expense_account_id,tax_capital_cost,source_type,source_table,source_record_id,source_line_id,source_reference,source_posted,supplier_party_id,status,created_by)
  values(coalesce(nullif(trim(p_name),''),'Fixed Asset'),coalesce(p_purchase_date,current_date),coalesce(p_purchase_date,current_date),upper(coalesce(nullif(trim(p_currency),''),'CAD')),v_cost,round(coalesce(p_recoverable_tax,0),2),0,0,'STRAIGHT_LINE',v_asset,v_accum,v_dep,v_cost,upper(trim(p_source_type)),p_source_table,p_source_record_id,p_source_line_id,nullif(trim(p_source_reference),''),true,p_supplier_party_id,'PENDING_SETUP',p_actor_id)
  returning id into v_id;
  return v_id;
end $$;

-- Supplier Bill account 1500 creates a pending asset setup record without a duplicate acquisition journal.
create or replace function public.accounting_fixed_asset_supplier_bill_trigger()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare l record;v_id uuid;v_cost numeric(14,2);
begin
  if new.status='POSTED' and old.status is distinct from new.status then
    for l in
      select bl.*,a.code from public.accounting_supplier_bill_lines bl join public.accounting_accounts a on a.id=bl.posting_account_id
      where bl.supplier_bill_id=new.id and a.code='1500'
    loop
      v_cost:=round(l.line_subtotal+greatest(0,coalesce(l.tax_amount,0)-coalesce(l.recoverable_tax,0)),2);
      v_id:=public.accounting_fixed_asset_source_register('SUPPLIER_BILL','accounting_supplier_bills',new.id::text,l.id::text,new.bill_number,l.description,new.bill_date,new.supplier_party_id,v_cost,l.recoverable_tax,new.currency,new.posted_by);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_step18_7_supplier_bill_fixed_asset on public.accounting_supplier_bills;
create trigger trg_step18_7_supplier_bill_fixed_asset after update of status on public.accounting_supplier_bills for each row execute function public.accounting_fixed_asset_supplier_bill_trigger();

-- Advanced Expense FIXED_ASSET account 1500 creates a pending setup record; source expense owns the acquisition journal.
create or replace function public.accounting_fixed_asset_expense_trigger()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare l record;v_id uuid;v_cost numeric(14,2);
begin
  if new.status in ('POSTED','PAID') and old.status='APPROVED' then
    for l in
      select el.*,a.code from public.accounting_expense_claim_lines el join public.accounting_accounts a on a.id=el.posting_account_id
      where el.expense_claim_id=new.id and el.classification='FIXED_ASSET' and a.code='1500'
    loop
      v_cost:=round(l.line_subtotal+coalesce(l.nonrecoverable_tax,0),2);
      v_id:=public.accounting_fixed_asset_source_register('EXPENSE','accounting_expense_claims',new.id::text,l.id::text,new.expense_number,l.description,new.posting_date,new.vendor_party_id,v_cost,l.recoverable_tax,new.currency,new.posted_by);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_step18_7_expense_fixed_asset on public.accounting_expense_claims;
create trigger trg_step18_7_expense_fixed_asset after update of status on public.accounting_expense_claims for each row execute function public.accounting_fixed_asset_expense_trigger();

-- Backfill already-posted source lines into the new register. No financial event is generated.
do $$ declare l record;v_id uuid;v_cost numeric(14,2);begin
  for l in
    select b.id bill_id,b.bill_number,b.bill_date,b.supplier_party_id,b.currency,b.posted_by,bl.id line_id,bl.description,bl.line_subtotal,bl.tax_amount,bl.recoverable_tax
    from public.accounting_supplier_bills b join public.accounting_supplier_bill_lines bl on bl.supplier_bill_id=b.id join public.accounting_accounts a on a.id=bl.posting_account_id
    where b.status in ('POSTED','PARTIAL','PAID') and a.code='1500' and not exists(select 1 from public.accounting_fixed_assets fa where fa.source_table='accounting_supplier_bills' and fa.source_line_id=bl.id::text)
  loop
    v_cost:=round(l.line_subtotal+greatest(0,coalesce(l.tax_amount,0)-coalesce(l.recoverable_tax,0)),2);
    v_id:=public.accounting_fixed_asset_source_register('SUPPLIER_BILL','accounting_supplier_bills',l.bill_id::text,l.line_id::text,l.bill_number,l.description,l.bill_date,l.supplier_party_id,v_cost,l.recoverable_tax,l.currency,l.posted_by);
  end loop;
  for l in
    select e.id expense_id,e.expense_number,e.posting_date,e.vendor_party_id,e.currency,e.posted_by,el.id line_id,el.description,el.line_subtotal,el.nonrecoverable_tax,el.recoverable_tax
    from public.accounting_expense_claims e join public.accounting_expense_claim_lines el on el.expense_claim_id=e.id join public.accounting_accounts a on a.id=el.posting_account_id
    where e.status in ('POSTED','PAID') and el.classification='FIXED_ASSET' and a.code='1500' and not exists(select 1 from public.accounting_fixed_assets fa where fa.source_table='accounting_expense_claims' and fa.source_line_id=el.id::text)
  loop
    v_cost:=round(l.line_subtotal+coalesce(l.nonrecoverable_tax,0),2);
    v_id:=public.accounting_fixed_asset_source_register('EXPENSE','accounting_expense_claims',l.expense_id::text,l.line_id::text,l.expense_number,l.description,l.posting_date,l.vendor_party_id,v_cost,l.recoverable_tax,l.currency,l.posted_by);
  end loop;
end $$;

-- Setup/edit an asset. Financial source/cost facts remain immutable once created.
create or replace function public.accounting_save_fixed_asset_setup(
  p_asset_id uuid,p_name text,p_description text,p_category text,p_serial_number text,p_location_text text,p_responsible_party_id uuid,
  p_available_for_use_date date,p_depreciation_start_date date,p_depreciation_method text,p_book_useful_life_months integer,p_residual_value numeric,
  p_cca_class_id uuid,p_tax_capital_cost numeric,p_tax_opening_ucc numeric,p_tax_opening_year integer,p_document_reference text,p_notes text,p_active boolean,p_actor_id text
) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v public.accounting_fixed_assets%rowtype;v_method text:=upper(coalesce(nullif(trim(p_depreciation_method),''),'STRAIGHT_LINE'));v_has_dep boolean;v_status text;
begin
  select * into v from public.accounting_fixed_assets where id=p_asset_id for update;if not found then raise exception 'Fixed asset not found.';end if;
  if v.status='DISPOSED' then raise exception 'Disposed fixed assets are immutable. Use supporting notes/audit records rather than editing the asset.';end if;
  if coalesce(p_residual_value,0)<0 or coalesce(p_residual_value,0)>v.capital_cost then raise exception 'Residual value must be between zero and capital cost.';end if;
  if v_method not in ('STRAIGHT_LINE','NONE') then raise exception 'Unsupported book depreciation method.';end if;
  if v_method='STRAIGHT_LINE' and (coalesce(p_book_useful_life_months,0)<=0 or p_depreciation_start_date is null) then raise exception 'Straight-line assets require depreciation start date and useful life in months.';end if;
  if p_available_for_use_date is not null and p_available_for_use_date<v.purchase_date then raise exception 'Available-for-use date cannot precede purchase date.';end if;
  select exists(select 1 from public.accounting_fixed_asset_depreciation_lines dl join public.accounting_fixed_asset_depreciation_runs dr on dr.id=dl.depreciation_run_id where dl.asset_id=v.id and dr.status='POSTED') into v_has_dep;
  if v_has_dep and (v.depreciation_method is distinct from v_method or v.depreciation_start_date is distinct from p_depreciation_start_date or v.book_useful_life_months is distinct from p_book_useful_life_months or abs(v.residual_value-coalesce(p_residual_value,0))>0.001) then
    raise exception 'Book depreciation policy cannot be changed after posted depreciation exists. Use a controlled accountant adjustment.';
  end if;
  if p_cca_class_id is not null and not exists(select 1 from public.accounting_cca_classes where id=p_cca_class_id and active=true) then raise exception 'CCA class is inactive or missing.';end if;
  if coalesce(p_tax_capital_cost,v.tax_capital_cost,0)<0 or coalesce(p_tax_opening_ucc,v.tax_opening_ucc,0)<0 then raise exception 'Tax capital cost/UCC cannot be negative.';end if;
  v_status:=case when coalesce(p_active,true) then 'ACTIVE' else 'INACTIVE' end;
  update public.accounting_fixed_assets set
    name=coalesce(nullif(trim(p_name),''),name),description=nullif(trim(p_description),''),category=nullif(trim(p_category),''),serial_number=nullif(trim(p_serial_number),''),location_text=nullif(trim(p_location_text),''),responsible_party_id=p_responsible_party_id,
    available_for_use_date=p_available_for_use_date,depreciation_start_date=case when v_method='NONE' then null else p_depreciation_start_date end,depreciation_method=v_method,book_useful_life_months=case when v_method='NONE' then null else p_book_useful_life_months end,residual_value=round(coalesce(p_residual_value,0),2),
    cca_class_id=p_cca_class_id,tax_capital_cost=round(coalesce(p_tax_capital_cost,v.tax_capital_cost),2),tax_opening_ucc=round(coalesce(p_tax_opening_ucc,v.tax_opening_ucc),2),tax_opening_year=p_tax_opening_year,document_reference=nullif(trim(p_document_reference),''),notes=nullif(trim(p_notes),''),status=v_status,updated_by=p_actor_id
  where id=v.id;
  return v.id;
end $$;

-- Opening/migration asset. Posts gross cost, opening accumulated depreciation and opening equity through STEP 17.
create or replace function public.accounting_create_opening_fixed_asset(
  p_name text,p_description text,p_category text,p_serial_number text,p_location_text text,p_responsible_party_id uuid,p_supplier_party_id uuid,
  p_purchase_date date,p_available_for_use_date date,p_depreciation_start_date date,p_depreciation_method text,p_book_useful_life_months integer,
  p_capital_cost numeric,p_opening_accumulated_depreciation numeric,p_residual_value numeric,p_cca_class_id uuid,p_tax_capital_cost numeric,p_tax_opening_ucc numeric,p_tax_opening_year integer,
  p_reference text,p_document_reference text,p_notes text,p_actor_id text
) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid;v_asset uuid;v_accum uuid;v_dep uuid;v_cost numeric(14,2):=round(coalesce(p_capital_cost,0),2);v_open numeric(14,2):=round(coalesce(p_opening_accumulated_depreciation,0),2);v_method text:=upper(coalesce(nullif(trim(p_depreciation_method),''),'STRAIGHT_LINE'));v_row jsonb;
begin
  if v_cost<=0 then raise exception 'Opening asset capital cost must be positive.';end if;
  if v_open<0 or v_open>v_cost then raise exception 'Opening accumulated depreciation must be between zero and capital cost.';end if;
  if coalesce(p_residual_value,0)<0 or coalesce(p_residual_value,0)>v_cost then raise exception 'Residual value must be between zero and capital cost.';end if;
  if v_method not in ('STRAIGHT_LINE','NONE') then raise exception 'Unsupported book depreciation method.';end if;
  if v_method='STRAIGHT_LINE' and (coalesce(p_book_useful_life_months,0)<=0 or p_depreciation_start_date is null) then raise exception 'Straight-line assets require depreciation start date and useful life in months.';end if;
  if p_available_for_use_date is not null and p_available_for_use_date<coalesce(p_purchase_date,current_date) then raise exception 'Available-for-use date cannot precede purchase date.';end if;
  select id into v_asset from public.accounting_accounts where code='1500';select id into v_accum from public.accounting_accounts where code='1510';select id into v_dep from public.accounting_accounts where code='6200';
  insert into public.accounting_fixed_assets(name,description,category,serial_number,location_text,responsible_party_id,supplier_party_id,purchase_date,available_for_use_date,depreciation_start_date,currency,capital_cost,residual_value,opening_accumulated_depreciation,depreciation_method,book_useful_life_months,asset_account_id,accumulated_depreciation_account_id,depreciation_expense_account_id,cca_class_id,tax_capital_cost,tax_opening_ucc,tax_opening_year,source_type,source_table,source_reference,source_posted,document_reference,notes,status,created_by)
  values(trim(p_name),nullif(trim(p_description),''),nullif(trim(p_category),''),nullif(trim(p_serial_number),''),nullif(trim(p_location_text),''),p_responsible_party_id,p_supplier_party_id,coalesce(p_purchase_date,current_date),p_available_for_use_date,case when v_method='NONE' then null else p_depreciation_start_date end,'CAD',v_cost,round(coalesce(p_residual_value,0),2),v_open,v_method,case when v_method='NONE' then null else p_book_useful_life_months end,v_asset,v_accum,v_dep,p_cca_class_id,round(coalesce(p_tax_capital_cost,v_cost),2),round(coalesce(p_tax_opening_ucc,0),2),p_tax_opening_year,'OPENING','accounting_fixed_assets',nullif(trim(p_reference),''),true,nullif(trim(p_document_reference),''),nullif(trim(p_notes),''),'ACTIVE',p_actor_id)
  returning id into v_id;
  select to_jsonb(a) into v_row from public.accounting_fixed_assets a where a.id=v_id;
  perform public.accounting_enqueue_event('FIXED_ASSET_OPENING_POSTED','accounting_fixed_assets',v_id::text,(v_row->>'asset_number'),jsonb_build_object('fixed_asset',v_row),now(),1,p_actor_id,v_id::text,null);
  return v_id;
end $$;

-- Refresh a draft monthly straight-line depreciation run using full-month convention.
create or replace function public.accounting_refresh_fixed_asset_depreciation_run(p_run_id uuid,p_actor_id text)
returns numeric language plpgsql security definer set search_path=public,extensions as $$
declare r public.accounting_fixed_asset_depreciation_runs%rowtype;a record;v_months int;v_base numeric(14,2);v_monthly numeric(18,6);v_posted numeric(14,2);v_target numeric(14,2);v_due numeric(14,2);v_open_accum numeric(14,2);v_open_nbv numeric(14,2);v_total numeric(14,2):=0;
begin
  select * into r from public.accounting_fixed_asset_depreciation_runs where id=p_run_id for update;if not found then raise exception 'Depreciation run not found.';end if;if r.status<>'DRAFT' then raise exception 'Only Draft depreciation runs can be refreshed.';end if;
  delete from public.accounting_fixed_asset_depreciation_lines where depreciation_run_id=r.id;
  for a in select * from public.accounting_fixed_assets where status='ACTIVE' and depreciation_method='STRAIGHT_LINE' and depreciation_start_date is not null and depreciation_start_date<=r.period_end order by asset_number loop
    v_base:=round(greatest(0,a.capital_cost-a.residual_value),2);
    v_months:=greatest(0,least(a.book_useful_life_months,((extract(year from r.period_end)::int-extract(year from a.depreciation_start_date)::int)*12+(extract(month from r.period_end)::int-extract(month from a.depreciation_start_date)::int)+1)));
    v_monthly:=case when a.book_useful_life_months>0 then v_base/a.book_useful_life_months else 0 end;
    v_target:=round(least(v_base,v_monthly*v_months),2);
    select round(coalesce(sum(dl.depreciation_amount),0),2) into v_posted from public.accounting_fixed_asset_depreciation_lines dl join public.accounting_fixed_asset_depreciation_runs dr on dr.id=dl.depreciation_run_id where dl.asset_id=a.id and dr.status='POSTED' and dr.id<>r.id;
    v_open_accum:=round(a.opening_accumulated_depreciation+v_posted,2);
    v_due:=round(greatest(0,v_target-v_open_accum),2);
    v_due:=least(v_due,round(greatest(0,a.capital_cost-a.residual_value-v_open_accum),2));
    if v_due>0.004 then
      v_open_nbv:=round(a.capital_cost-v_open_accum,2);
      insert into public.accounting_fixed_asset_depreciation_lines(depreciation_run_id,asset_id,opening_net_book_value,opening_accumulated_depreciation,depreciation_amount,closing_accumulated_depreciation,closing_net_book_value,months_elapsed)
      values(r.id,a.id,v_open_nbv,v_open_accum,v_due,round(v_open_accum+v_due,2),round(v_open_nbv-v_due,2),v_months);
      v_total:=round(v_total+v_due,2);
    end if;
  end loop;
  update public.accounting_fixed_asset_depreciation_runs set total_depreciation=v_total,updated_at=now() where id=r.id;
  return v_total;
end $$;

create or replace function public.accounting_create_fixed_asset_depreciation_run(p_period_end date,p_actor_id text)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid;v_end date:=coalesce(p_period_end,current_date);
begin
  if v_end>current_date then raise exception 'Depreciation period end cannot be in the future.';end if;
  if exists(select 1 from public.accounting_fixed_asset_depreciation_runs where status='POSTED' and period_end>=v_end) then raise exception 'Depreciation period must be later than the latest posted depreciation run.';end if;
  select id into v_id from public.accounting_fixed_asset_depreciation_runs where period_end=v_end limit 1;
  if v_id is null then insert into public.accounting_fixed_asset_depreciation_runs(period_end,created_by) values(v_end,p_actor_id) returning id into v_id;end if;
  perform public.accounting_refresh_fixed_asset_depreciation_run(v_id,p_actor_id);
  return v_id;
end $$;

create or replace function public.accounting_post_fixed_asset_depreciation_run(p_run_id uuid,p_actor_id text)
returns text language plpgsql security definer set search_path=public,extensions as $$
declare r public.accounting_fixed_asset_depreciation_runs%rowtype;v_total numeric(14,2);v_lines jsonb;
begin
  select * into r from public.accounting_fixed_asset_depreciation_runs where id=p_run_id for update;if not found then raise exception 'Depreciation run not found.';end if;if r.status<>'DRAFT' then raise exception 'Only Draft depreciation runs can be posted.';end if;
  v_total:=public.accounting_refresh_fixed_asset_depreciation_run(r.id,p_actor_id);if v_total<=0.004 then raise exception 'No book depreciation is due for this period.';end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.asset_id),'[]'::jsonb) into v_lines from public.accounting_fixed_asset_depreciation_lines x where x.depreciation_run_id=r.id;
  update public.accounting_fixed_asset_depreciation_runs set status='POSTED',posted_by=p_actor_id,posted_at=now(),total_depreciation=v_total where id=r.id;
  perform public.accounting_enqueue_event('FIXED_ASSET_DEPRECIATION_POSTED','accounting_fixed_asset_depreciation_runs',r.id::text,r.run_number,jsonb_build_object('depreciation_run',to_jsonb(r)||jsonb_build_object('total_depreciation',v_total,'status','POSTED'),'lines',v_lines),now(),1,p_actor_id,r.id::text,null);
  return 'POSTED';
end $$;

-- Exact book snapshot used by disposal and UI.
create or replace function public.accounting_fixed_asset_book_snapshot(p_asset_id uuid,p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare a public.accounting_fixed_assets%rowtype;v_dep numeric(14,2);v_accum numeric(14,2);v_nbv numeric(14,2);
begin
  select * into a from public.accounting_fixed_assets where id=p_asset_id;if not found then raise exception 'Fixed asset not found.';end if;
  select round(coalesce(sum(dl.depreciation_amount),0),2) into v_dep from public.accounting_fixed_asset_depreciation_lines dl join public.accounting_fixed_asset_depreciation_runs dr on dr.id=dl.depreciation_run_id where dl.asset_id=a.id and dr.status='POSTED' and dr.period_end<=coalesce(p_as_of,current_date);
  v_accum:=round(a.opening_accumulated_depreciation+v_dep,2);v_nbv:=round(a.capital_cost-v_accum,2);
  return jsonb_build_object('asset_id',a.id,'capital_cost',a.capital_cost,'accumulated_depreciation',v_accum,'net_book_value',v_nbv,'as_of',coalesce(p_as_of,current_date));
end $$;

create or replace function public.accounting_dispose_fixed_asset(p_asset_id uuid,p_disposal_date date,p_proceeds numeric,p_financial_account_id uuid,p_reference text,p_notes text,p_tax_proceeds numeric,p_actor_id text)
returns text language plpgsql security definer set search_path=public,extensions as $$
declare a public.accounting_fixed_assets%rowtype;v_snap jsonb;v_accum numeric(14,2);v_nbv numeric(14,2);v_proceeds numeric(14,2):=round(coalesce(p_proceeds,0),2);v_gain numeric(14,2);v_row jsonb;v_depkey text;
begin
  select * into a from public.accounting_fixed_assets where id=p_asset_id for update;if not found then raise exception 'Fixed asset not found.';end if;if a.status not in ('ACTIVE','INACTIVE') then raise exception 'Only active/inactive undisposed assets can be disposed.';end if;
  if coalesce(p_disposal_date,current_date)<a.purchase_date or coalesce(p_disposal_date,current_date)>current_date then raise exception 'Disposal date is invalid.';end if;
  if exists(select 1 from public.accounting_fixed_asset_depreciation_lines dl join public.accounting_fixed_asset_depreciation_runs dr on dr.id=dl.depreciation_run_id where dl.asset_id=a.id and dr.status='POSTED' and dr.period_end>coalesce(p_disposal_date,current_date)) then raise exception 'Posted depreciation exists after the disposal date. Reverse/correct that depreciation before disposal.';end if;
  if v_proceeds>0 then
    if p_financial_account_id is null or not exists(select 1 from public.accounting_financial_accounts where id=p_financial_account_id and active=true and financial_type in ('BANK','CASH','CLEARING')) then raise exception 'A Bank/Cash/Clearing financial account is required for positive disposal proceeds.';end if;
  end if;
  v_snap:=public.accounting_fixed_asset_book_snapshot(a.id,coalesce(p_disposal_date,current_date));v_accum:=(v_snap->>'accumulated_depreciation')::numeric;v_nbv:=(v_snap->>'net_book_value')::numeric;v_gain:=round(v_proceeds-v_nbv,2);
  update public.accounting_fixed_assets set status='DISPOSED',disposal_date=coalesce(p_disposal_date,current_date),disposal_proceeds=v_proceeds,disposal_financial_account_id=case when v_proceeds>0 then p_financial_account_id else null end,disposal_reference=nullif(trim(p_reference),''),disposal_notes=nullif(trim(p_notes),''),disposal_accumulated_depreciation=v_accum,disposal_net_book_value=v_nbv,disposal_gain_loss=v_gain,tax_disposition_proceeds=round(coalesce(p_tax_proceeds,v_proceeds),2),disposed_by=p_actor_id,disposed_at=now(),updated_by=p_actor_id where id=a.id;
  select to_jsonb(x) into v_row from public.accounting_fixed_assets x where x.id=a.id;
  v_depkey:=case when a.source_type='OPENING' then 'PLEASE:FIXED_ASSET_OPENING_POSTED:'||a.id::text when a.source_type='SUPPLIER_BILL' then 'PLEASE:VENDOR_BILL_POSTED:'||coalesce(a.source_record_id,'') when a.source_type='EXPENSE' then 'PLEASE:EXPENSE_POSTED:'||coalesce(a.source_record_id,'') else null end;
  perform public.accounting_enqueue_event('FIXED_ASSET_DISPOSAL_POSTED','accounting_fixed_assets',a.id::text,a.asset_number,jsonb_build_object('fixed_asset',v_row),now(),1,p_actor_id,a.id::text,v_depkey);
  return 'DISPOSED';
end $$;

-- GL/subledger controls. Accumulated depreciation is presented as a positive credit balance.
create or replace function public.accounting_fixed_asset_gross_gl_balance(p_as_of date default current_date)
returns numeric language sql security definer set search_path=public,extensions as $$
  select round(coalesce(sum(coalesce(jl.debit,0)-coalesce(jl.credit,0)),0),2)
  from public.accounting_journal_lines jl join public.accounting_journal_entries je on je.id=jl.journal_entry_id join public.accounting_accounts a on a.id=jl.account_id
  where je.status='POSTED' and a.code='1500' and je.entry_date<=coalesce(p_as_of,current_date)
$$;
create or replace function public.accounting_fixed_asset_accum_gl_balance(p_as_of date default current_date)
returns numeric language sql security definer set search_path=public,extensions as $$
  select round(coalesce(sum(coalesce(jl.credit,0)-coalesce(jl.debit,0)),0),2)
  from public.accounting_journal_lines jl join public.accounting_journal_entries je on je.id=jl.journal_entry_id join public.accounting_accounts a on a.id=jl.account_id
  where je.status='POSTED' and a.code='1510' and je.entry_date<=coalesce(p_as_of,current_date)
$$;
create or replace function public.accounting_fixed_asset_gross_subledger_value()
returns numeric language sql security definer set search_path=public,extensions as $$
  select round(coalesce(sum(capital_cost),0),2) from public.accounting_fixed_assets where status<>'DISPOSED'
$$;
create or replace function public.accounting_fixed_asset_accum_subledger_value(p_as_of date default current_date)
returns numeric language sql security definer set search_path=public,extensions as $$
  select round(coalesce(sum(x.accum),0),2) from (
    select a.id,a.opening_accumulated_depreciation+coalesce((select sum(dl.depreciation_amount) from public.accounting_fixed_asset_depreciation_lines dl join public.accounting_fixed_asset_depreciation_runs dr on dr.id=dl.depreciation_run_id where dl.asset_id=a.id and dr.status='POSTED' and dr.period_end<=coalesce(p_as_of,current_date)),0) accum
    from public.accounting_fixed_assets a where a.status<>'DISPOSED'
  ) x
$$;

-- CCA/UCC working paper. CAL tracks continuity; special first-year rules and final claims require accountant review.
create or replace function public.accounting_generate_cca_working_paper(p_tax_year integer,p_actor_id text)
returns integer language plpgsql security definer set search_path=public,extensions as $$
declare c record;v_prior numeric(14,2);v_open numeric(14,2);v_add numeric(14,2);v_disp numeric(14,2);v_pre numeric(14,2);v_claim numeric(14,2);v_close numeric(14,2);v_empty boolean;v_rec numeric(14,2);v_term numeric(14,2);v_flags text[];v_count int:=0;
begin
  if p_tax_year<2000 or p_tax_year>extract(year from current_date)::int+1 then raise exception 'Invalid CCA tax year.';end if;
  for c in select * from public.accounting_cca_classes where active=true order by class_code loop
    select closing_ucc into v_prior from public.accounting_cca_working_papers where tax_year=p_tax_year-1 and cca_class_id=c.id;
    if v_prior is null then select round(coalesce(sum(tax_opening_ucc),0),2) into v_open from public.accounting_fixed_assets where cca_class_id=c.id and tax_opening_year=p_tax_year;else v_open:=v_prior;end if;
    select round(coalesce(sum(tax_capital_cost),0),2) into v_add from public.accounting_fixed_assets where cca_class_id=c.id and coalesce(tax_opening_ucc,0)=0 and available_for_use_date between make_date(p_tax_year,1,1) and make_date(p_tax_year,12,31);
    select round(coalesce(sum(least(coalesce(tax_disposition_proceeds,disposal_proceeds,0),tax_capital_cost)),0),2) into v_disp from public.accounting_fixed_assets where cca_class_id=c.id and disposal_date between make_date(p_tax_year,1,1) and make_date(p_tax_year,12,31);
    if abs(coalesce(v_open,0))+abs(coalesce(v_add,0))+abs(coalesce(v_disp,0))<0.005 and not exists(select 1 from public.accounting_fixed_assets where cca_class_id=c.id) then continue;end if;
    v_pre:=round(coalesce(v_open,0)+coalesce(v_add,0)-coalesce(v_disp,0),2);
    select cca_claimed into v_claim from public.accounting_cca_working_papers where tax_year=p_tax_year and cca_class_id=c.id;v_claim:=coalesce(v_claim,0);
    if v_claim>greatest(v_pre,0)+0.001 then v_claim:=0;end if;
    select not exists(select 1 from public.accounting_fixed_assets where cca_class_id=c.id and (disposal_date is null or disposal_date>make_date(p_tax_year,12,31))) into v_empty;
    v_rec:=greatest(0,-v_pre);v_term:=case when v_empty and v_pre>0 then v_pre else 0 end;v_close:=round(greatest(0,v_pre-v_claim),2);
    v_flags:=array[]::text[];
    if c.first_year_rule<>'STANDARD_HALF_YEAR' and v_add>0 then v_flags:=array_append(v_flags,c.first_year_rule);end if;
    if c.passenger_vehicle_limit_review then v_flags:=array_append(v_flags,'PASSENGER_VEHICLE_LIMIT_REVIEW');end if;
    if v_rec>0 then v_flags:=array_append(v_flags,'RECAPTURE_REVIEW');end if;
    if v_term>0 then v_flags:=array_append(v_flags,'TERMINAL_LOSS_REVIEW');end if;
    insert into public.accounting_cca_working_papers(tax_year,cca_class_id,opening_ucc,additions,disposition_reduction,pre_cca_ucc,prescribed_rate,rate_reference_amount,cca_claimed,closing_ucc,recapture_candidate,terminal_loss_candidate,class_empty_at_year_end,review_flags,status,updated_by)
    values(p_tax_year,c.id,coalesce(v_open,0),coalesce(v_add,0),coalesce(v_disp,0),v_pre,c.prescribed_rate,round(greatest(v_pre,0)*c.prescribed_rate,2),v_claim,v_close,v_rec,v_term,v_empty,v_flags,'DRAFT',p_actor_id)
    on conflict(tax_year,cca_class_id) do update set opening_ucc=excluded.opening_ucc,additions=excluded.additions,disposition_reduction=excluded.disposition_reduction,pre_cca_ucc=excluded.pre_cca_ucc,prescribed_rate=excluded.prescribed_rate,rate_reference_amount=excluded.rate_reference_amount,closing_ucc=greatest(0,excluded.pre_cca_ucc-public.accounting_cca_working_papers.cca_claimed),recapture_candidate=excluded.recapture_candidate,terminal_loss_candidate=excluded.terminal_loss_candidate,class_empty_at_year_end=excluded.class_empty_at_year_end,review_flags=excluded.review_flags,status=case when public.accounting_cca_working_papers.status='REVIEWED' then 'REVIEWED' else 'DRAFT' end,updated_by=p_actor_id,updated_at=now();
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;

create or replace function public.accounting_save_cca_claim(p_working_paper_id uuid,p_cca_claimed numeric,p_notes text,p_mark_reviewed boolean,p_actor_id text)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v public.accounting_cca_working_papers%rowtype;v_claim numeric(14,2):=round(coalesce(p_cca_claimed,0),2);
begin
  select * into v from public.accounting_cca_working_papers where id=p_working_paper_id for update;if not found then raise exception 'CCA working paper not found.';end if;
  if v_claim<0 or v_claim>greatest(v.pre_cca_ucc,0)+0.001 then raise exception 'CCA claimed must be between zero and positive pre-CCA UCC. Special tax rules still require accountant review.';end if;
  update public.accounting_cca_working_papers set cca_claimed=v_claim,closing_ucc=round(greatest(0,v.pre_cca_ucc-v_claim),2),notes=nullif(trim(p_notes),''),status=case when coalesce(p_mark_reviewed,false) then 'REVIEWED' else 'DRAFT' end,updated_by=p_actor_id where id=v.id;
  return v.id;
end $$;

-- Posting rules for the three financial fixed-asset events.
insert into public.accounting_posting_rules(source_system,event_type,debit_account_code,credit_account_code,tax_account_code,enabled,rule_version,configuration_json)
values
 ('PLEASE','FIXED_ASSET_OPENING_POSTED','1500','3000',null,true,1,jsonb_build_object('accumulated_depreciation_account','1510')),
 ('PLEASE','FIXED_ASSET_DEPRECIATION_POSTED','6200','1510',null,true,1,'{}'::jsonb),
 ('PLEASE','FIXED_ASSET_DISPOSAL_POSTED','1510','1500',null,true,1,jsonb_build_object('gain_account','4050','loss_account','6300'))
on conflict(source_system,event_type,debit_account_code,credit_account_code) do update set enabled=true,rule_version=greatest(public.accounting_posting_rules.rule_version,excluded.rule_version),configuration_json=excluded.configuration_json;

-- Audit trail.
create or replace function public.accounting_fixed_asset_audit_trigger()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare v_row jsonb;v_id text;v_before jsonb;v_after jsonb;
begin
  if tg_op='DELETE' then v_before=to_jsonb(old);v_after=null;v_row=v_before;elsif tg_op='INSERT' then v_before=null;v_after=to_jsonb(new);v_row=v_after;else v_before=to_jsonb(old);v_after=to_jsonb(new);v_row=v_after;end if;
  v_id=coalesce(v_row->>'id','');
  insert into public.accounting_audit_log(event_type,object_type,object_id,before_data,after_data,metadata)
  values('FIXED_ASSET_'||tg_op,tg_table_name,nullif(v_id,''),v_before,v_after,jsonb_build_object('step','18.7','source','DATABASE_TRIGGER'));
  if tg_op='DELETE' then return old;end if;return new;
end $$;
do $$ declare t text;begin foreach t in array array['accounting_fixed_assets','accounting_fixed_asset_depreciation_runs','accounting_fixed_asset_depreciation_lines','accounting_cca_working_papers'] loop execute format('drop trigger if exists %I on public.%I','trg_'||t||'_fixed_asset_audit',t);execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.accounting_fixed_asset_audit_trigger()','trg_'||t||'_fixed_asset_audit',t);end loop;end $$;

-- RLS / service-role mediation.
do $$ declare t text;begin foreach t in array array['accounting_cca_classes','accounting_fixed_assets','accounting_fixed_asset_depreciation_runs','accounting_fixed_asset_depreciation_lines','accounting_cca_working_papers'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);end loop;end $$;
revoke all on sequence public.accounting_fixed_asset_number_seq from anon,authenticated;
revoke all on sequence public.accounting_depreciation_run_number_seq from anon,authenticated;

revoke all on function public.accounting_fixed_asset_source_register(text,text,text,text,text,text,date,uuid,numeric,numeric,text,text) from public,anon,authenticated;
revoke all on function public.accounting_save_fixed_asset_setup(uuid,text,text,text,text,text,uuid,date,date,text,integer,numeric,uuid,numeric,numeric,integer,text,text,boolean,text) from public,anon,authenticated;
revoke all on function public.accounting_create_opening_fixed_asset(text,text,text,text,text,uuid,uuid,date,date,date,text,integer,numeric,numeric,numeric,uuid,numeric,numeric,integer,text,text,text,text) from public,anon,authenticated;
revoke all on function public.accounting_refresh_fixed_asset_depreciation_run(uuid,text) from public,anon,authenticated;
revoke all on function public.accounting_create_fixed_asset_depreciation_run(date,text) from public,anon,authenticated;
revoke all on function public.accounting_post_fixed_asset_depreciation_run(uuid,text) from public,anon,authenticated;
revoke all on function public.accounting_fixed_asset_book_snapshot(uuid,date) from public,anon,authenticated;
revoke all on function public.accounting_dispose_fixed_asset(uuid,date,numeric,uuid,text,text,numeric,text) from public,anon,authenticated;
revoke all on function public.accounting_fixed_asset_gross_gl_balance(date) from public,anon,authenticated;
revoke all on function public.accounting_fixed_asset_accum_gl_balance(date) from public,anon,authenticated;
revoke all on function public.accounting_fixed_asset_gross_subledger_value() from public,anon,authenticated;
revoke all on function public.accounting_fixed_asset_accum_subledger_value(date) from public,anon,authenticated;
revoke all on function public.accounting_generate_cca_working_paper(integer,text) from public,anon,authenticated;
revoke all on function public.accounting_save_cca_claim(uuid,numeric,text,boolean,text) from public,anon,authenticated;

grant execute on function public.accounting_fixed_asset_source_register(text,text,text,text,text,text,date,uuid,numeric,numeric,text,text) to service_role;
grant execute on function public.accounting_save_fixed_asset_setup(uuid,text,text,text,text,text,uuid,date,date,text,integer,numeric,uuid,numeric,numeric,integer,text,text,boolean,text) to service_role;
grant execute on function public.accounting_create_opening_fixed_asset(text,text,text,text,text,uuid,uuid,date,date,date,text,integer,numeric,numeric,numeric,uuid,numeric,numeric,integer,text,text,text,text) to service_role;
grant execute on function public.accounting_refresh_fixed_asset_depreciation_run(uuid,text) to service_role;
grant execute on function public.accounting_create_fixed_asset_depreciation_run(date,text) to service_role;
grant execute on function public.accounting_post_fixed_asset_depreciation_run(uuid,text) to service_role;
grant execute on function public.accounting_fixed_asset_book_snapshot(uuid,date) to service_role;
grant execute on function public.accounting_dispose_fixed_asset(uuid,date,numeric,uuid,text,text,numeric,text) to service_role;
grant execute on function public.accounting_fixed_asset_gross_gl_balance(date) to service_role;
grant execute on function public.accounting_fixed_asset_accum_gl_balance(date) to service_role;
grant execute on function public.accounting_fixed_asset_gross_subledger_value() to service_role;
grant execute on function public.accounting_fixed_asset_accum_subledger_value(date) to service_role;
grant execute on function public.accounting_generate_cca_working_paper(integer,text) to service_role;
grant execute on function public.accounting_save_cca_claim(uuid,numeric,text,boolean,text) to service_role;

comment on table public.accounting_fixed_assets is 'STEP 18.7 fixed asset register. Source-backed purchases/expenses create Pending Setup assets without duplicate acquisition journals.';
comment on table public.accounting_fixed_asset_depreciation_runs is 'Book depreciation runs only. Tax CCA is separate.';
comment on table public.accounting_cca_working_papers is 'CCA/UCC continuity working paper. Special first-year rules, recapture and terminal loss require accountant review.';

commit;
