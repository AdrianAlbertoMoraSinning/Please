-- PLEASE / CAL — STEP 18.8: Payroll (Alberta Core)
-- Safe additive migration. Run AFTER STEP18_7_FIXED_ASSETS.sql.
-- Scope: employee payroll profiles, 2026 versioned CRA parameters, regular-pay calculations,
-- pay runs, payroll liabilities, payroll payments, source-deduction remittances and T4 working papers.
-- Full SIN is intentionally NOT stored by CAL; only last four digits / secure-document references.

begin;
create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.accounting_parties') is null or to_regclass('public.accounting_party_roles') is null then
    raise exception 'STEP 18.1 Financial Master Data is required before STEP 18.8.';
  end if;
  if to_regclass('public.please_accounting_outbox') is null
     or to_regprocedure('public.accounting_enqueue_event(text,text,text,text,jsonb,timestamptz,integer,text,text,text)') is null then
    raise exception 'STEP 17 Native Accounting Engine is required before STEP 18.8.';
  end if;
end $$;

-- Payroll control accounts. Existing customized rows are preserved.
insert into public.accounting_accounts(code,name,account_type,account_subtype,active,system_managed,allow_manual_posting)
values
 ('2030','Payroll Payable','LIABILITY','PAYROLL_NET_PAY',true,true,true),
 ('2040','CPP / CPP2 Payable','LIABILITY','PAYROLL_SOURCE_DEDUCTION',true,true,true),
 ('2050','EI Payable','LIABILITY','PAYROLL_SOURCE_DEDUCTION',true,true,true),
 ('2060','Payroll Income Tax Payable','LIABILITY','PAYROLL_SOURCE_DEDUCTION',true,true,true),
 ('2070','Other Payroll Deductions Payable','LIABILITY','PAYROLL_OTHER_DEDUCTION',true,true,true),
 ('7000','Wages & Salaries Expense','EXPENSE','PAYROLL_WAGES',true,true,true),
 ('7010','Employer CPP / CPP2 Expense','EXPENSE','PAYROLL_EMPLOYER_CPP',true,true,true),
 ('7020','Employer EI Expense','EXPENSE','PAYROLL_EMPLOYER_EI',true,true,true)
on conflict(code) do nothing;
update public.accounting_accounts set system_managed=true,updated_at=now()
where code in ('2030','2040','2050','2060','2070','7000','7010','7020');

create sequence if not exists public.accounting_payroll_employee_number_seq start with 1001;
create sequence if not exists public.accounting_payroll_run_number_seq start with 1001;
create sequence if not exists public.accounting_payroll_remittance_number_seq start with 1001;

create table if not exists public.accounting_payroll_parameters (
  id uuid primary key default gen_random_uuid(),
  tax_year integer not null,
  province text not null default 'AB',
  effective_from date not null,
  effective_to date,
  engine_version text not null,
  cpp_rate numeric(9,6) not null,
  cpp_base_rate numeric(9,6) not null,
  cpp_first_additional_rate numeric(9,6) not null,
  cpp_max_contribution numeric(14,2) not null,
  cpp_base_max_contribution numeric(14,2) not null,
  cpp_basic_exemption numeric(14,2) not null,
  ympe numeric(14,2) not null,
  yampe numeric(14,2) not null,
  cpp2_rate numeric(9,6) not null,
  cpp2_max_contribution numeric(14,2) not null,
  ei_rate numeric(9,6) not null,
  ei_employer_rate numeric(9,6) not null,
  ei_max_insurable numeric(14,2) not null,
  ei_max_employee numeric(14,2) not null,
  ei_max_employer numeric(14,2) not null,
  federal_lowest_rate numeric(9,6) not null,
  federal_cea numeric(14,2) not null,
  federal_default_td1 numeric(14,2) not null,
  alberta_lowest_rate numeric(9,6) not null,
  alberta_default_td1 numeric(14,2) not null,
  federal_brackets jsonb not null,
  alberta_brackets jsonb not null,
  alberta_k5_threshold numeric(14,2) not null,
  alberta_k5_factor numeric(9,6) not null,
  source_reference text not null,
  system_managed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(province,effective_from,engine_version),
  check(effective_to is null or effective_to>=effective_from)
);

-- Alberta/federal rates applicable to regular periodic payroll in 2026. July release did not change Alberta/federal brackets.
insert into public.accounting_payroll_parameters(
 tax_year,province,effective_from,effective_to,engine_version,
 cpp_rate,cpp_base_rate,cpp_first_additional_rate,cpp_max_contribution,cpp_base_max_contribution,cpp_basic_exemption,ympe,yampe,cpp2_rate,cpp2_max_contribution,
 ei_rate,ei_employer_rate,ei_max_insurable,ei_max_employee,ei_max_employer,
 federal_lowest_rate,federal_cea,federal_default_td1,alberta_lowest_rate,alberta_default_td1,
 federal_brackets,alberta_brackets,alberta_k5_threshold,alberta_k5_factor,source_reference)
values
 (2026,'AB','2026-01-01','2026-06-30','CRA-T4127-122-2026-01',
  0.0595,0.0495,0.0100,4230.45,3519.45,3500,74600,85000,0.0400,416.00,
  0.0163,0.02282,68900,1123.07,1572.30,
  0.14,1501,16452,0.08,22769,
  '[{"from":0,"rate":0.14,"constant":0},{"from":58523,"rate":0.205,"constant":3804},{"from":117045,"rate":0.26,"constant":10241},{"from":181440,"rate":0.29,"constant":15685},{"from":258482,"rate":0.33,"constant":26024}]'::jsonb,
  '[{"from":0,"rate":0.08,"constant":0},{"from":61200,"rate":0.10,"constant":1224},{"from":154259,"rate":0.12,"constant":4309},{"from":185111,"rate":0.13,"constant":6160},{"from":246813,"rate":0.14,"constant":8628},{"from":370220,"rate":0.15,"constant":12331}]'::jsonb,
  4896,0.25,'CRA T4127 122nd edition / T4032AB 2026'),
 (2026,'AB','2026-07-01',null,'CRA-T4127-123-2026-07',
  0.0595,0.0495,0.0100,4230.45,3519.45,3500,74600,85000,0.0400,416.00,
  0.0163,0.02282,68900,1123.07,1572.30,
  0.14,1501,16452,0.08,22769,
  '[{"from":0,"rate":0.14,"constant":0},{"from":58523,"rate":0.205,"constant":3804},{"from":117045,"rate":0.26,"constant":10241},{"from":181440,"rate":0.29,"constant":15685},{"from":258482,"rate":0.33,"constant":26024}]'::jsonb,
  '[{"from":0,"rate":0.08,"constant":0},{"from":61200,"rate":0.10,"constant":1224},{"from":154259,"rate":0.12,"constant":4309},{"from":185111,"rate":0.13,"constant":6160},{"from":246813,"rate":0.14,"constant":8628},{"from":370220,"rate":0.15,"constant":12331}]'::jsonb,
  4896,0.25,'CRA T4127 123rd edition effective July 1 2026')
on conflict(province,effective_from,engine_version) do update set
 effective_to=excluded.effective_to,cpp_rate=excluded.cpp_rate,cpp_base_rate=excluded.cpp_base_rate,cpp_first_additional_rate=excluded.cpp_first_additional_rate,
 cpp_max_contribution=excluded.cpp_max_contribution,cpp_base_max_contribution=excluded.cpp_base_max_contribution,cpp_basic_exemption=excluded.cpp_basic_exemption,
 ympe=excluded.ympe,yampe=excluded.yampe,cpp2_rate=excluded.cpp2_rate,cpp2_max_contribution=excluded.cpp2_max_contribution,
 ei_rate=excluded.ei_rate,ei_employer_rate=excluded.ei_employer_rate,ei_max_insurable=excluded.ei_max_insurable,ei_max_employee=excluded.ei_max_employee,ei_max_employer=excluded.ei_max_employer,
 federal_lowest_rate=excluded.federal_lowest_rate,federal_cea=excluded.federal_cea,federal_default_td1=excluded.federal_default_td1,
 alberta_lowest_rate=excluded.alberta_lowest_rate,alberta_default_td1=excluded.alberta_default_td1,
 federal_brackets=excluded.federal_brackets,alberta_brackets=excluded.alberta_brackets,alberta_k5_threshold=excluded.alberta_k5_threshold,alberta_k5_factor=excluded.alberta_k5_factor,
 source_reference=excluded.source_reference,system_managed=true,updated_at=now();

create table if not exists public.accounting_payroll_settings (
  id uuid primary key default gen_random_uuid(),
  province text not null default 'AB',
  remitter_type text not null default 'REGULAR' check(remitter_type in ('QUARTERLY','REGULAR','THRESHOLD_1','THRESHOLD_2')),
  payroll_program_account_reference text,
  default_payment_financial_account_id uuid references public.accounting_financial_accounts(id) on delete restrict,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.accounting_payroll_settings(province,remitter_type)
select 'AB','REGULAR' where not exists(select 1 from public.accounting_payroll_settings);

create table if not exists public.accounting_payroll_employees (
  id uuid primary key default gen_random_uuid(),
  employee_number text not null unique default ('EMP-'||lpad(nextval('public.accounting_payroll_employee_number_seq')::text,6,'0')),
  party_id uuid not null unique references public.accounting_parties(id) on delete restrict,
  employment_type text not null default 'HOURLY' check(employment_type in ('HOURLY','SALARY')),
  province_of_employment text not null default 'AB',
  pay_frequency text not null default 'BIWEEKLY' check(pay_frequency in ('WEEKLY','BIWEEKLY','SEMIMONTHLY','MONTHLY')),
  pay_periods_per_year integer not null default 26 check(pay_periods_per_year in (12,24,26,27,52,53)),
  hourly_rate numeric(14,4) not null default 0 check(hourly_rate>=0),
  overtime_multiplier numeric(9,4) not null default 1.5 check(overtime_multiplier>=1),
  annual_salary numeric(14,2) not null default 0 check(annual_salary>=0),
  hire_date date not null,
  termination_date date,
  status text not null default 'ACTIVE' check(status in ('ACTIVE','ON_LEAVE','TERMINATED','INACTIVE')),
  federal_td1_claim numeric(14,2) not null default 16452 check(federal_td1_claim>=0),
  provincial_td1_claim numeric(14,2) not null default 22769 check(provincial_td1_claim>=0),
  additional_tax_per_period numeric(14,2) not null default 0 check(additional_tax_per_period>=0),
  cpp_exempt boolean not null default false,
  ei_exempt boolean not null default false,
  cpp_months integer not null default 12 check(cpp_months between 0 and 12),
  sin_on_file boolean not null default false,
  sin_last4 text check(sin_last4 is null or sin_last4 ~ '^[0-9]{4}$'),
  sin_secure_document_reference text,
  federal_td1_document_reference text,
  provincial_td1_document_reference text,
  notes text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(termination_date is null or termination_date>=hire_date),
  check(province_of_employment='AB')
);

create table if not exists public.accounting_payroll_runs (
  id uuid primary key default gen_random_uuid(),
  run_number text not null unique default ('PAY-'||lpad(nextval('public.accounting_payroll_run_number_seq')::text,6,'0')),
  pay_frequency text not null check(pay_frequency in ('WEEKLY','BIWEEKLY','SEMIMONTHLY','MONTHLY')),
  period_start date not null,
  period_end date not null,
  payment_date date not null,
  status text not null default 'DRAFT' check(status in ('DRAFT','REVIEW','APPROVED','POSTED','PAID','VOID')),
  engine_version text,
  gross_pay numeric(14,2) not null default 0,
  employee_cpp numeric(14,2) not null default 0,
  employee_cpp2 numeric(14,2) not null default 0,
  employee_ei numeric(14,2) not null default 0,
  income_tax numeric(14,2) not null default 0,
  other_deductions numeric(14,2) not null default 0,
  net_pay numeric(14,2) not null default 0,
  employer_cpp numeric(14,2) not null default 0,
  employer_cpp2 numeric(14,2) not null default 0,
  employer_ei numeric(14,2) not null default 0,
  approved_at timestamptz,
  approved_by text,
  posted_at timestamptz,
  posted_by text,
  paid_at timestamptz,
  paid_by text,
  payment_financial_account_id uuid references public.accounting_financial_accounts(id) on delete restrict,
  payment_reference text,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(period_end>=period_start),
  check(payment_date>=period_start)
);

create unique index if not exists accounting_payroll_run_period_active_uq
on public.accounting_payroll_runs(pay_frequency,period_start,period_end)
where status<>'VOID';

create table if not exists public.accounting_payroll_run_lines (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.accounting_payroll_runs(id) on delete restrict,
  employee_id uuid not null references public.accounting_payroll_employees(id) on delete restrict,
  regular_hours numeric(12,4) not null default 0 check(regular_hours>=0),
  overtime_hours numeric(12,4) not null default 0 check(overtime_hours>=0),
  regular_earnings numeric(14,2) not null default 0,
  overtime_earnings numeric(14,2) not null default 0,
  other_regular_earnings numeric(14,2) not null default 0,
  taxable_benefits numeric(14,2) not null default 0,
  gross_pay numeric(14,2) not null default 0,
  pensionable_earnings numeric(14,2) not null default 0,
  insurable_earnings numeric(14,2) not null default 0,
  taxable_earnings numeric(14,2) not null default 0,
  tax_deductible_deductions numeric(14,2) not null default 0,
  employee_cpp numeric(14,2) not null default 0,
  employee_cpp2 numeric(14,2) not null default 0,
  employee_ei numeric(14,2) not null default 0,
  federal_tax numeric(14,2) not null default 0,
  provincial_tax numeric(14,2) not null default 0,
  additional_tax numeric(14,2) not null default 0,
  income_tax numeric(14,2) not null default 0,
  other_deductions numeric(14,2) not null default 0,
  net_pay numeric(14,2) not null default 0,
  employer_cpp numeric(14,2) not null default 0,
  employer_cpp2 numeric(14,2) not null default 0,
  employer_ei numeric(14,2) not null default 0,
  tax_override numeric(14,2),
  tax_override_reason text,
  calculation_version text not null,
  calculation_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(payroll_run_id,employee_id),
  check(tax_override is null or tax_override>=0),
  check(net_pay>=0)
);

create table if not exists public.accounting_payroll_remittances (
  id uuid primary key default gen_random_uuid(),
  remittance_number text not null unique default ('PRM-'||lpad(nextval('public.accounting_payroll_remittance_number_seq')::text,6,'0')),
  period_end date not null,
  remittance_date date not null,
  financial_account_id uuid not null references public.accounting_financial_accounts(id) on delete restrict,
  employee_cpp numeric(14,2) not null default 0,
  employer_cpp numeric(14,2) not null default 0,
  employee_cpp2 numeric(14,2) not null default 0,
  employer_cpp2 numeric(14,2) not null default 0,
  employee_ei numeric(14,2) not null default 0,
  employer_ei numeric(14,2) not null default 0,
  income_tax numeric(14,2) not null default 0,
  total_remittance numeric(14,2) not null default 0,
  reference text,
  status text not null default 'PAID' check(status in ('PAID','VOID')),
  paid_by text,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check(total_remittance>=0)
);

create table if not exists public.accounting_payroll_t4_working_papers (
  id uuid primary key default gen_random_uuid(),
  tax_year integer not null,
  employee_id uuid not null references public.accounting_payroll_employees(id) on delete restrict,
  box14_employment_income numeric(14,2) not null default 0,
  box16_cpp numeric(14,2) not null default 0,
  box16a_cpp2 numeric(14,2) not null default 0,
  box18_ei numeric(14,2) not null default 0,
  box22_income_tax numeric(14,2) not null default 0,
  box24_ei_insurable_earnings numeric(14,2) not null default 0,
  box26_cpp_pensionable_earnings numeric(14,2) not null default 0,
  sin_last4 text,
  status text not null default 'DRAFT' check(status in ('DRAFT','REVIEWED')),
  notes text,
  generated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  unique(tax_year,employee_id)
);

-- Guardrails: payroll profile must reference an active EMPLOYEE business role.
create or replace function public.accounting_payroll_employee_role_guard()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
begin
  if not exists(select 1 from public.accounting_party_roles r where r.party_id=new.party_id and r.role='EMPLOYEE' and r.active=true) then
    raise exception 'Payroll employee must be linked to a Business Partner with active EMPLOYEE role.';
  end if;
  new.updated_at=now();
  return new;
end $$;
drop trigger if exists trg_accounting_payroll_employee_role_guard on public.accounting_payroll_employees;
create trigger trg_accounting_payroll_employee_role_guard before insert or update on public.accounting_payroll_employees for each row execute function public.accounting_payroll_employee_role_guard();

-- Posted payroll lines are immutable. Draft/review/approved lines remain recalculable until posting.
create or replace function public.accounting_payroll_line_guard()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare s text;
begin
  select status into s from public.accounting_payroll_runs where id=coalesce(new.payroll_run_id,old.payroll_run_id);
  if tg_op in ('UPDATE','DELETE') and s in ('POSTED','PAID') then raise exception 'Posted payroll lines are immutable.';end if;
  if tg_op='INSERT' and s in ('POSTED','PAID','VOID') then raise exception 'Cannot add lines to a closed payroll run.';end if;
  if tg_op='DELETE' then return old;end if;new.updated_at=now();return new;
end $$;
drop trigger if exists trg_accounting_payroll_line_guard on public.accounting_payroll_run_lines;
create trigger trg_accounting_payroll_line_guard before insert or update or delete on public.accounting_payroll_run_lines for each row execute function public.accounting_payroll_line_guard();

create or replace function public.accounting_payroll_run_closed_guard()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
begin
  if tg_op='DELETE' and old.status in ('POSTED','PAID') then raise exception 'Posted payroll runs cannot be deleted.';end if;
  if tg_op='UPDATE' and old.status in ('POSTED','PAID') then
    if new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end or new.payment_date is distinct from old.payment_date or new.pay_frequency is distinct from old.pay_frequency or new.gross_pay is distinct from old.gross_pay or new.net_pay is distinct from old.net_pay then
      raise exception 'Posted payroll financial fields are immutable.';
    end if;
  end if;
  if tg_op='DELETE' then return old;end if;new.updated_at=now();return new;
end $$;
drop trigger if exists trg_accounting_payroll_run_closed_guard on public.accounting_payroll_runs;
create trigger trg_accounting_payroll_run_closed_guard before update or delete on public.accounting_payroll_runs for each row execute function public.accounting_payroll_run_closed_guard();

create or replace function public.accounting_post_payroll_run(p_run_id uuid,p_actor_id text)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare r public.accounting_payroll_runs%rowtype;v_lines jsonb;v_count integer;
begin
  select * into r from public.accounting_payroll_runs where id=p_run_id for update;if not found then raise exception 'Payroll run not found.';end if;
  if r.status<>'APPROVED' then raise exception 'Payroll run must be APPROVED before posting.';end if;
  select count(*),coalesce(jsonb_agg(to_jsonb(l) order by l.employee_id),'[]'::jsonb) into v_count,v_lines from public.accounting_payroll_run_lines l where l.payroll_run_id=r.id;
  if v_count=0 then raise exception 'Payroll run has no employee lines.';end if;
  update public.accounting_payroll_runs set status='POSTED',posted_at=now(),posted_by=p_actor_id where id=r.id;
  select * into r from public.accounting_payroll_runs where id=r.id;
  perform public.accounting_enqueue_event('PAYROLL_POSTED','accounting_payroll_runs',r.id::text,r.run_number,jsonb_build_object('payroll_run',to_jsonb(r),'lines',v_lines),now(),1,p_actor_id,r.id::text,null);
  return r.id;
end $$;

create or replace function public.accounting_pay_payroll_run(p_run_id uuid,p_financial_account_id uuid,p_payment_date date,p_reference text,p_actor_id text)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare r public.accounting_payroll_runs%rowtype;f public.accounting_financial_accounts%rowtype;
begin
  select * into r from public.accounting_payroll_runs where id=p_run_id for update;if not found then raise exception 'Payroll run not found.';end if;
  if r.status<>'POSTED' then raise exception 'Payroll run must be POSTED before payment.';end if;
  select * into f from public.accounting_financial_accounts where id=p_financial_account_id and active=true and financial_type in ('BANK','CASH','CLEARING');if not found then raise exception 'Valid Bank/Cash/Clearing financial account is required.';end if;
  update public.accounting_payroll_runs set status='PAID',paid_at=now(),paid_by=p_actor_id,payment_financial_account_id=f.id,payment_reference=nullif(trim(p_reference),'') where id=r.id;
  select * into r from public.accounting_payroll_runs where id=r.id;
  perform public.accounting_enqueue_event('PAYROLL_PAID','accounting_payroll_runs',r.id::text,r.run_number,jsonb_build_object('payroll_run',to_jsonb(r)),now(),1,p_actor_id,r.id::text,'PLEASE:PAYROLL_POSTED:'||r.id::text);
  return r.id;
end $$;

create or replace function public.accounting_record_payroll_remittance(
 p_period_end date,p_remittance_date date,p_financial_account_id uuid,
 p_employee_cpp numeric,p_employer_cpp numeric,p_employee_cpp2 numeric,p_employer_cpp2 numeric,
 p_employee_ei numeric,p_employer_ei numeric,p_income_tax numeric,p_reference text,p_actor_id text)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid;f public.accounting_financial_accounts%rowtype;v_total numeric(14,2);
begin
  select * into f from public.accounting_financial_accounts where id=p_financial_account_id and active=true and financial_type in ('BANK','CASH','CLEARING');if not found then raise exception 'Valid Bank/Cash/Clearing financial account is required.';end if;
  v_total:=round(coalesce(p_employee_cpp,0)+coalesce(p_employer_cpp,0)+coalesce(p_employee_cpp2,0)+coalesce(p_employer_cpp2,0)+coalesce(p_employee_ei,0)+coalesce(p_employer_ei,0)+coalesce(p_income_tax,0),2);
  if v_total<=0 then raise exception 'Payroll remittance total must be positive.';end if;
  insert into public.accounting_payroll_remittances(period_end,remittance_date,financial_account_id,employee_cpp,employer_cpp,employee_cpp2,employer_cpp2,employee_ei,employer_ei,income_tax,total_remittance,reference,paid_by)
  values(p_period_end,p_remittance_date,f.id,round(coalesce(p_employee_cpp,0),2),round(coalesce(p_employer_cpp,0),2),round(coalesce(p_employee_cpp2,0),2),round(coalesce(p_employer_cpp2,0),2),round(coalesce(p_employee_ei,0),2),round(coalesce(p_employer_ei,0),2),round(coalesce(p_income_tax,0),2),v_total,nullif(trim(p_reference),''),p_actor_id) returning id into v_id;
  perform public.accounting_enqueue_event('PAYROLL_REMITTANCE_PAID','accounting_payroll_remittances',v_id::text,(select remittance_number from public.accounting_payroll_remittances where id=v_id),jsonb_build_object('payroll_remittance',(select to_jsonb(x) from public.accounting_payroll_remittances x where x.id=v_id)),now(),1,p_actor_id,v_id::text,null);
  return v_id;
end $$;

create or replace function public.accounting_generate_t4_working_papers(p_tax_year integer,p_actor_id text)
returns integer language plpgsql security definer set search_path=public,extensions as $$
declare e record;v_count integer:=0;
begin
  for e in select pe.id,pe.sin_last4 from public.accounting_payroll_employees pe where exists(select 1 from public.accounting_payroll_run_lines l join public.accounting_payroll_runs r on r.id=l.payroll_run_id where l.employee_id=pe.id and r.status in ('POSTED','PAID') and extract(year from r.payment_date)::integer=p_tax_year) loop
    insert into public.accounting_payroll_t4_working_papers(tax_year,employee_id,box14_employment_income,box16_cpp,box16a_cpp2,box18_ei,box22_income_tax,box24_ei_insurable_earnings,box26_cpp_pensionable_earnings,sin_last4,status,generated_at)
    select p_tax_year,e.id,round(sum(l.gross_pay),2),round(sum(l.employee_cpp),2),round(sum(l.employee_cpp2),2),round(sum(l.employee_ei),2),round(sum(l.income_tax),2),round(sum(l.insurable_earnings),2),round(sum(l.pensionable_earnings),2),e.sin_last4,'DRAFT',now()
    from public.accounting_payroll_run_lines l join public.accounting_payroll_runs r on r.id=l.payroll_run_id
    where l.employee_id=e.id and r.status in ('POSTED','PAID') and extract(year from r.payment_date)::integer=p_tax_year
    on conflict(tax_year,employee_id) do update set box14_employment_income=excluded.box14_employment_income,box16_cpp=excluded.box16_cpp,box16a_cpp2=excluded.box16a_cpp2,box18_ei=excluded.box18_ei,box22_income_tax=excluded.box22_income_tax,box24_ei_insurable_earnings=excluded.box24_ei_insurable_earnings,box26_cpp_pensionable_earnings=excluded.box26_cpp_pensionable_earnings,sin_last4=excluded.sin_last4,status=case when public.accounting_payroll_t4_working_papers.status='REVIEWED' then 'REVIEWED' else 'DRAFT' end,generated_at=now();
    v_count:=v_count+1;
  end loop;return v_count;
end $$;

create or replace function public.accounting_save_t4_working_paper_review(p_id uuid,p_notes text,p_reviewed boolean,p_actor_id text)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
begin
  update public.accounting_payroll_t4_working_papers set notes=nullif(trim(p_notes),''),status=case when p_reviewed then 'REVIEWED' else 'DRAFT' end,reviewed_at=case when p_reviewed then now() else null end,reviewed_by=case when p_reviewed then p_actor_id else null end where id=p_id;
  if not found then raise exception 'T4 working paper not found.';end if;return p_id;
end $$;

-- Posting rules. Dynamic split is built by the STEP 17 worker.
insert into public.accounting_posting_rules(source_system,event_type,debit_account_code,credit_account_code,tax_account_code,enabled,rule_version,configuration_json)
values
 ('PLEASE','PAYROLL_POSTED','7000','2030',null,true,1,jsonb_build_object('employer_cpp_expense','7010','employer_ei_expense','7020','cpp_payable','2040','ei_payable','2050','tax_payable','2060','other_payable','2070')),
 ('PLEASE','PAYROLL_PAID','2030','1000',null,true,1,'{}'::jsonb),
 ('PLEASE','PAYROLL_REMITTANCE_PAID','2040','1000',null,true,1,jsonb_build_object('ei_payable','2050','tax_payable','2060'))
on conflict(source_system,event_type,debit_account_code,credit_account_code) do update set enabled=true,rule_version=greatest(public.accounting_posting_rules.rule_version,excluded.rule_version),configuration_json=excluded.configuration_json;

-- Audit trail.
create or replace function public.accounting_payroll_audit_trigger()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare v_row jsonb;v_before jsonb;v_after jsonb;v_id text;
begin
  if tg_op='DELETE' then v_before=to_jsonb(old);v_after=null;v_row=v_before;elsif tg_op='INSERT' then v_before=null;v_after=to_jsonb(new);v_row=v_after;else v_before=to_jsonb(old);v_after=to_jsonb(new);v_row=v_after;end if;
  v_id=coalesce(v_row->>'id','');
  insert into public.accounting_audit_log(event_type,object_type,object_id,before_data,after_data,metadata)
  values('PAYROLL_'||tg_op,tg_table_name,nullif(v_id,''),v_before,v_after,jsonb_build_object('step','18.8','source','DATABASE_TRIGGER'));
  if tg_op='DELETE' then return old;end if;return new;
end $$;
do $$ declare t text;begin foreach t in array array['accounting_payroll_employees','accounting_payroll_runs','accounting_payroll_run_lines','accounting_payroll_remittances','accounting_payroll_t4_working_papers'] loop execute format('drop trigger if exists %I on public.%I','trg_'||t||'_payroll_audit',t);execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.accounting_payroll_audit_trigger()','trg_'||t||'_payroll_audit',t);end loop;end $$;

-- RLS / service-role mediation.
do $$ declare t text;begin foreach t in array array['accounting_payroll_parameters','accounting_payroll_settings','accounting_payroll_employees','accounting_payroll_runs','accounting_payroll_run_lines','accounting_payroll_remittances','accounting_payroll_t4_working_papers'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);end loop;end $$;
revoke all on sequence public.accounting_payroll_employee_number_seq from anon,authenticated;
revoke all on sequence public.accounting_payroll_run_number_seq from anon,authenticated;
revoke all on sequence public.accounting_payroll_remittance_number_seq from anon,authenticated;
grant usage,select on sequence public.accounting_payroll_employee_number_seq to service_role;
grant usage,select on sequence public.accounting_payroll_run_number_seq to service_role;
grant usage,select on sequence public.accounting_payroll_remittance_number_seq to service_role;

revoke all on function public.accounting_post_payroll_run(uuid,text) from public,anon,authenticated;
revoke all on function public.accounting_pay_payroll_run(uuid,uuid,date,text,text) from public,anon,authenticated;
revoke all on function public.accounting_record_payroll_remittance(date,date,uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text) from public,anon,authenticated;
revoke all on function public.accounting_generate_t4_working_papers(integer,text) from public,anon,authenticated;
revoke all on function public.accounting_save_t4_working_paper_review(uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.accounting_post_payroll_run(uuid,text) to service_role;
grant execute on function public.accounting_pay_payroll_run(uuid,uuid,date,text,text) to service_role;
grant execute on function public.accounting_record_payroll_remittance(date,date,uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text) to service_role;
grant execute on function public.accounting_generate_t4_working_papers(integer,text) to service_role;
grant execute on function public.accounting_save_t4_working_paper_review(uuid,text,boolean,text) to service_role;

comment on table public.accounting_payroll_parameters is 'Versioned CRA payroll calculation parameters. STEP 18.8 supports Alberta regular periodic pay; complex cases require PDOC/manual tax override.';
comment on table public.accounting_payroll_employees is 'Payroll profile linked to an EMPLOYEE business partner. Full SIN is not stored; use secure document custody.';
comment on table public.accounting_payroll_t4_working_papers is 'T4 preparation working paper only. Filing remains through CRA-compatible/certified processes.';

commit;
