-- ============================================================
-- PLEASE Portal — STEP 8.2.1
-- Service Rate UI + Provider Compensation Model
-- Safe additive migration. Existing rate values are preserved.
-- ============================================================

begin;

alter table public.provider_service_rates
  add column if not exists provider_compensation_method text not null default 'NONE';

-- Existing STEP 8.2 records with a compensation number had no explicit method.
-- Preserve the literal numeric value and classify it as FIXED_CAD rather than
-- silently guessing that it was a percentage.
update public.provider_service_rates
set provider_compensation_method = 'FIXED_CAD'
where provider_compensation is not null
  and coalesce(provider_compensation_method, 'NONE') = 'NONE';

alter table public.provider_service_rates
  drop constraint if exists provider_service_rates_comp_method_check;

alter table public.provider_service_rates
  add constraint provider_service_rates_comp_method_check
  check (provider_compensation_method in ('NONE','FIXED_CAD','PERCENT'));

alter table public.provider_service_rates
  drop constraint if exists provider_service_rates_comp_value_check;

alter table public.provider_service_rates
  add constraint provider_service_rates_comp_value_check
  check (
    (provider_compensation_method = 'NONE' and provider_compensation is null)
    or
    (provider_compensation_method = 'FIXED_CAD'
      and provider_compensation is not null
      and provider_compensation >= 0
      and provider_compensation <= customer_rate)
    or
    (provider_compensation_method = 'PERCENT'
      and provider_compensation is not null
      and provider_compensation >= 0
      and provider_compensation <= 100)
  );

comment on column public.provider_service_rates.provider_compensation_method is
  'NONE = not configured; FIXED_CAD = fixed provider amount per billing unit; PERCENT = percentage of customer rate. provider_compensation stores the fixed CAD amount or percentage according to this method.';

commit;
