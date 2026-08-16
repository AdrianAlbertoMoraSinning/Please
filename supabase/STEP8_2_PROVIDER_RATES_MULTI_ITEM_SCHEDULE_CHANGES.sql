-- PLEASE Portal — STEP 8.2
-- Provider Service Rates + Multi-Item Customer Billing + Schedule Change Requests
-- Safe/idempotent. Existing Jobs, invoices and historical STEP 8.1 fields are preserved.

begin;

-- ---------------------------------------------------------------------------
-- 1) Provider service-rate catalog.
-- A provider may have many assigned services and many active rates per service.
-- ---------------------------------------------------------------------------
create table if not exists public.provider_service_rates (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete restrict,
  rate_name text not null,
  description text,
  billing_unit text not null default 'service',
  customer_rate numeric(12,2) not null default 0,
  provider_compensation numeric(12,2),
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_service_rates_name_check check (char_length(trim(rate_name)) between 1 and 160),
  constraint provider_service_rates_unit_check check (billing_unit in ('hour','service','item','load','room','sq_ft','day','other')),
  constraint provider_service_rates_customer_rate_check check (customer_rate >= 0),
  constraint provider_service_rates_provider_comp_check check (provider_compensation is null or provider_compensation >= 0)
);

create index if not exists provider_service_rates_provider_idx
  on public.provider_service_rates(provider_id, active, sort_order, rate_name);
create index if not exists provider_service_rates_service_idx
  on public.provider_service_rates(service_id, active);

alter table public.provider_service_rates enable row level security;

-- ---------------------------------------------------------------------------
-- 2) Frozen billing detail on the Job.
-- Rates copied here never change when the provider later edits the catalog.
-- ---------------------------------------------------------------------------
create table if not exists public.job_billing_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  provider_service_rate_id uuid references public.provider_service_rates(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  service_name text,
  description text not null,
  quantity numeric(12,2) not null default 1,
  unit text not null default 'service',
  unit_rate numeric(12,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  sort_order integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_billing_items_quantity_check check (quantity > 0),
  constraint job_billing_items_rate_check check (unit_rate >= 0),
  constraint job_billing_items_total_check check (line_total >= 0)
);

create index if not exists job_billing_items_job_idx
  on public.job_billing_items(job_id, sort_order, id);
alter table public.job_billing_items enable row level security;

-- Preserve old STEP 8.1 Jobs as one frozen billing line if they have legacy billing
-- values and no multi-item detail yet. Existing invoices are not modified.
insert into public.job_billing_items(
  job_id, service_id, service_name, description, quantity, unit, unit_rate, line_total, sort_order
)
select
  j.id,
  j.service_id,
  j.service_name,
  coalesce(nullif(j.service_name,''),'PLEASE service'),
  coalesce(nullif(j.billable_quantity,0),1),
  coalesce(nullif(j.billing_unit,''),'service'),
  coalesce(j.customer_rate,0),
  round((coalesce(nullif(j.billable_quantity,0),1) * coalesce(j.customer_rate,0))::numeric,2),
  10
from public.jobs j
where coalesce(j.customer_rate,0) > 0
  and not exists (select 1 from public.job_billing_items b where b.job_id=j.id);

-- ---------------------------------------------------------------------------
-- 3) Provider schedule change requests.
-- The provider proposes; PLEASE accepts/rejects. The assignment itself is not
-- changed until PLEASE accepts the request.
-- ---------------------------------------------------------------------------
create table if not exists public.assignment_schedule_change_requests (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.job_assignments(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  provider_id uuid not null references public.providers(id) on delete cascade,
  requested_by_provider_user uuid references public.provider_portal_users(id) on delete set null,
  current_start timestamptz not null,
  current_end timestamptz not null,
  proposed_start timestamptz not null,
  proposed_end timestamptz not null,
  provider_reason text,
  status text not null default 'PENDING',
  reviewed_by_admin_portal_user uuid references public.admin_portal_users(id) on delete set null,
  admin_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assignment_schedule_change_status_check check (status in ('PENDING','ACCEPTED','REJECTED','WITHDRAWN')),
  constraint assignment_schedule_change_window_check check (proposed_end > proposed_start)
);

create unique index if not exists assignment_schedule_change_one_pending_idx
  on public.assignment_schedule_change_requests(assignment_id)
  where status='PENDING';
create index if not exists assignment_schedule_change_provider_idx
  on public.assignment_schedule_change_requests(provider_id, created_at desc);
create index if not exists assignment_schedule_change_status_idx
  on public.assignment_schedule_change_requests(status, created_at desc);
alter table public.assignment_schedule_change_requests enable row level security;

comment on table public.provider_service_rates is 'Provider-owned catalog of active service rates available to PLEASE Customer Billing.';
comment on table public.job_billing_items is 'Immutable billing snapshot selected by PLEASE for one Job. A Job may contain multiple provider rate items across the provider assigned services.';
comment on table public.assignment_schedule_change_requests is 'Provider-proposed schedule changes requiring PLEASE administration approval.';

commit;
