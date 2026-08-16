-- PLEASE Portal — STEP 8.1: Job Billing Data -> Automatic Invoice Prefill
-- Safe/idempotent. Existing jobs/invoices remain unchanged.

begin;

alter table public.jobs add column if not exists billing_type text;
alter table public.jobs add column if not exists customer_rate numeric(10,2);
alter table public.jobs add column if not exists billable_quantity numeric(10,2);
alter table public.jobs add column if not exists billing_unit text;
alter table public.jobs add column if not exists quoted_subtotal numeric(10,2);

-- New records created by the updated portal use HOURLY or FLAT_RATE.
-- Keep columns nullable so historical jobs created before STEP 8.1 remain valid.
do $$ begin
  if not exists (select 1 from pg_constraint where conname='jobs_billing_type_check') then
    alter table public.jobs add constraint jobs_billing_type_check check (billing_type is null or billing_type in ('HOURLY','FLAT_RATE'));
  end if;
  if not exists (select 1 from pg_constraint where conname='jobs_customer_rate_check') then
    alter table public.jobs add constraint jobs_customer_rate_check check (customer_rate is null or customer_rate >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='jobs_billable_quantity_check') then
    alter table public.jobs add constraint jobs_billable_quantity_check check (billable_quantity is null or billable_quantity > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='jobs_billing_unit_check') then
    alter table public.jobs add constraint jobs_billing_unit_check check (billing_unit is null or billing_unit in ('hour','service'));
  end if;
end $$;

comment on column public.jobs.billing_type is 'Customer billing model defined by PLEASE when the Job is created: HOURLY or FLAT_RATE.';
comment on column public.jobs.customer_rate is 'Customer-facing rate in CAD. This is independent of any provider response/rate.';
comment on column public.jobs.billable_quantity is 'Estimated billable quantity captured with the Job; invoice remains editable before issue.';
comment on column public.jobs.billing_unit is 'Billing unit used to prefill invoice items: hour or service.';
comment on column public.jobs.quoted_subtotal is 'Customer subtotal before GST captured at Job creation.';

commit;
