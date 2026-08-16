-- ============================================================
-- PLEASE Portal — STEP 8.3
-- Financial Separation + Provider Payments
-- Customer Revenue != Provider Cost. Provider payments are created when a Job is completed.
-- Safe additive migration. Existing invoices remain unchanged.
-- ============================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Clarify provider catalog semantics.
-- customer_rate remains an ADMIN/customer-price default only.
-- provider_compensation_method/value represents what the provider charges PLEASE.
-- Fixed provider compensation is independent from the customer selling price.
-- ---------------------------------------------------------------------------
alter table public.provider_service_rates
  drop constraint if exists provider_service_rates_comp_value_check;

alter table public.provider_service_rates
  add constraint provider_service_rates_comp_value_check
  check (
    (provider_compensation_method = 'NONE' and provider_compensation is null)
    or
    (provider_compensation_method = 'FIXED_CAD'
      and provider_compensation is not null
      and provider_compensation >= 0)
    or
    (provider_compensation_method = 'PERCENT'
      and provider_compensation is not null
      and provider_compensation >= 0
      and provider_compensation <= 100)
  );

comment on column public.provider_service_rates.customer_rate is
  'Optional PLEASE customer-price default. Provider Portal does not control this value after STEP 8.3.';
comment on column public.provider_service_rates.provider_compensation is
  'Provider charge to PLEASE: fixed CAD per billing unit when FIXED_CAD, or percentage of PLEASE customer unit price when PERCENT.';

-- ---------------------------------------------------------------------------
-- 2) Freeze BOTH financial sides on every Job billing item.
-- Legacy unit_rate/line_total are retained as customer-side compatibility fields.
-- ---------------------------------------------------------------------------
alter table public.job_billing_items
  add column if not exists customer_unit_rate numeric(12,2),
  add column if not exists customer_line_total numeric(12,2),
  add column if not exists provider_compensation_method text,
  add column if not exists provider_compensation_value numeric(12,2),
  add column if not exists provider_unit_rate numeric(12,2),
  add column if not exists provider_line_total numeric(12,2),
  add column if not exists gross_profit numeric(12,2),
  add column if not exists gross_margin_pct numeric(9,4);

update public.job_billing_items
set customer_unit_rate = coalesce(customer_unit_rate, unit_rate, 0),
    customer_line_total = coalesce(customer_line_total, line_total, round((quantity * coalesce(unit_rate,0))::numeric,2))
where customer_unit_rate is null or customer_line_total is null;

-- Backfill provider cost when the linked provider rate contains enough information.
update public.job_billing_items b
set provider_compensation_method = coalesce(b.provider_compensation_method, r.provider_compensation_method),
    provider_compensation_value = coalesce(b.provider_compensation_value, r.provider_compensation),
    provider_unit_rate = coalesce(
      b.provider_unit_rate,
      case
        when r.provider_compensation_method='FIXED_CAD' then r.provider_compensation
        when r.provider_compensation_method='PERCENT' then round((b.customer_unit_rate * r.provider_compensation / 100.0)::numeric,2)
        else null
      end
    )
from public.provider_service_rates r
where b.provider_service_rate_id=r.id;

update public.job_billing_items
set provider_line_total = case when provider_unit_rate is null then null else round((quantity * provider_unit_rate)::numeric,2) end,
    gross_profit = case when provider_unit_rate is null then null else round((customer_line_total - (quantity * provider_unit_rate))::numeric,2) end,
    gross_margin_pct = case
      when provider_unit_rate is null or customer_line_total=0 then null
      else round((((customer_line_total - (quantity * provider_unit_rate)) / customer_line_total) * 100)::numeric,4)
    end,
    unit_rate = customer_unit_rate,
    line_total = customer_line_total;

create or replace function public.job_billing_items_financial_trigger()
returns trigger
language plpgsql
as $$
begin
  new.customer_unit_rate := round(coalesce(new.customer_unit_rate,new.unit_rate,0)::numeric,2);
  new.customer_line_total := round((new.quantity * new.customer_unit_rate)::numeric,2);
  new.unit_rate := new.customer_unit_rate;
  new.line_total := new.customer_line_total;
  if new.provider_unit_rate is not null then
    new.provider_unit_rate := round(new.provider_unit_rate::numeric,2);
    new.provider_line_total := round((new.quantity * new.provider_unit_rate)::numeric,2);
    new.gross_profit := round((new.customer_line_total-new.provider_line_total)::numeric,2);
    if new.customer_line_total <> 0 then
      new.gross_margin_pct := round((new.gross_profit/new.customer_line_total*100)::numeric,4);
    else
      new.gross_margin_pct := null;
    end if;
  else
    new.provider_line_total := null;
    new.gross_profit := null;
    new.gross_margin_pct := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_job_billing_items_financial on public.job_billing_items;
create trigger trg_job_billing_items_financial
before insert or update on public.job_billing_items
for each row execute function public.job_billing_items_financial_trigger();

-- ---------------------------------------------------------------------------
-- 3) Provider Payments (manual outbound payment register; no payment processor).
-- One payable per completed Job/provider assignment.
-- ---------------------------------------------------------------------------
create table if not exists public.provider_payments (
  id uuid primary key default gen_random_uuid(),
  payment_reference text not null unique,
  job_id uuid not null unique references public.jobs(id) on delete restrict,
  assignment_id uuid references public.job_assignments(id) on delete set null,
  provider_id uuid not null references public.providers(id) on delete restrict,
  status text not null default 'PENDING',
  amount numeric(12,2) not null default 0,
  currency text not null default 'CAD',
  needs_rate_review boolean not null default false,
  paid_at timestamptz,
  payment_method text,
  payment_reference_external text,
  payment_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_admin_portal_user uuid references public.admin_portal_users(id) on delete set null,
  paid_by_admin_portal_user uuid references public.admin_portal_users(id) on delete set null,
  constraint provider_payments_status_check check (status in ('PENDING','PAID')),
  constraint provider_payments_amount_check check (amount >= 0)
);

create index if not exists provider_payments_provider_idx on public.provider_payments(provider_id,status,created_at desc);
create index if not exists provider_payments_status_idx on public.provider_payments(status,created_at desc);
alter table public.provider_payments enable row level security;

create table if not exists public.provider_payment_items (
  id uuid primary key default gen_random_uuid(),
  provider_payment_id uuid not null references public.provider_payments(id) on delete cascade,
  job_billing_item_id uuid references public.job_billing_items(id) on delete set null,
  service_name text,
  description text not null,
  quantity numeric(12,2) not null default 1,
  unit text not null default 'service',
  provider_unit_rate numeric(12,2),
  line_total numeric(12,2),
  sort_order integer not null default 10,
  created_at timestamptz not null default now()
);
create index if not exists provider_payment_items_payment_idx on public.provider_payment_items(provider_payment_id,sort_order,id);
alter table public.provider_payment_items enable row level security;

create or replace function public.make_provider_payment_reference()
returns text
language sql
volatile
as $$
  select 'PLS-PAY-' || to_char(current_date,'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
$$;

create or replace function public.ensure_provider_payment_for_job(p_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_job public.jobs%rowtype;
  v_assignment public.job_assignments%rowtype;
  v_payment_id uuid;
  v_missing int;
  v_amount numeric(12,2);
begin
  select * into v_job from public.jobs where id=p_job_id;
  if not found or v_job.status <> 'COMPLETED' then return null; end if;

  select * into v_assignment
  from public.job_assignments
  where job_id=p_job_id and status='COMPLETED'
  order by updated_at desc nulls last, assigned_at desc nulls last
  limit 1;
  if not found then return null; end if;

  select id into v_payment_id from public.provider_payments where job_id=p_job_id;
  if v_payment_id is not null then return v_payment_id; end if;

  select count(*) filter (where provider_unit_rate is null), coalesce(sum(provider_line_total),0)
  into v_missing,v_amount
  from public.job_billing_items where job_id=p_job_id;

  insert into public.provider_payments(payment_reference,job_id,assignment_id,provider_id,status,amount,needs_rate_review)
  values(public.make_provider_payment_reference(),p_job_id,v_assignment.id,v_assignment.provider_id,'PENDING',round(v_amount,2),coalesce(v_missing,0)>0)
  returning id into v_payment_id;

  insert into public.provider_payment_items(provider_payment_id,job_billing_item_id,service_name,description,quantity,unit,provider_unit_rate,line_total,sort_order)
  select v_payment_id,id,service_name,description,quantity,unit,provider_unit_rate,provider_line_total,sort_order
  from public.job_billing_items where job_id=p_job_id order by sort_order,id;

  return v_payment_id;
end;
$$;

create or replace function public.provider_payment_on_job_complete_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.status='COMPLETED' and old.status is distinct from new.status then
    perform public.ensure_provider_payment_for_job(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_provider_payment_on_job_complete on public.jobs;
create trigger trg_provider_payment_on_job_complete
after update of status on public.jobs
for each row execute function public.provider_payment_on_job_complete_trigger();

create or replace function public.provider_payment_on_assignment_complete_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.status='COMPLETED' and old.status is distinct from new.status then
    perform public.ensure_provider_payment_for_job(new.job_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_provider_payment_on_assignment_complete on public.job_assignments;
create trigger trg_provider_payment_on_assignment_complete
after update of status on public.job_assignments
for each row execute function public.provider_payment_on_assignment_complete_trigger();

-- Backfill existing completed jobs.
do $$
declare r record;
begin
  for r in select id from public.jobs where status='COMPLETED' loop
    perform public.ensure_provider_payment_for_job(r.id);
  end loop;
end $$;

comment on table public.provider_payments is 'Manual register of amounts PLEASE owes providers for completed work. No outbound payment processor is triggered.';
comment on table public.provider_payment_items is 'Frozen provider-cost detail supporting one provider payment record.';

commit;
