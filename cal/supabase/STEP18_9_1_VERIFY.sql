-- STEP 18.9.1 — Period Boundary Guardrails verification
-- Read-only. Every row should be PASS.
with checks as (
  select 1 n,'boundary_columns' control,
    case when (
      select count(*) from information_schema.columns
      where table_schema='public' and table_name='accounting_fiscal_periods'
        and column_name in ('boundary_type','boundary_override_reason','boundary_confirmed_by','boundary_confirmed_at')
    )=4 then 'PASS' else 'FAIL' end status
  union all select 2,'calendar_month_helper',case when to_regprocedure('public.accounting_is_calendar_month(date,date)') is not null then 'PASS' else 'FAIL' end
  union all select 3,'guarded_prepare_rpc',case when to_regprocedure('public.accounting_prepare_period_close_guarded(date,date,text,boolean,text)') is not null then 'PASS' else 'FAIL' end
  union all select 4,'legacy_prepare_rpc_preserved',case when to_regprocedure('public.accounting_prepare_period_close(date,date,text)') is not null then 'PASS' else 'FAIL' end
  union all select 5,'overlap_guard_function',case when to_regprocedure('public.accounting_fiscal_period_overlap_guard()') is not null then 'PASS' else 'FAIL' end
  union all select 6,'overlap_guard_trigger',case when exists(
    select 1 from pg_trigger where tgname='trg_accounting_fiscal_period_overlap_guard' and not tgisinternal
      and tgrelid='public.accounting_fiscal_periods'::regclass
  ) then 'PASS' else 'FAIL' end
  union all select 7,'boundary_constraint',case when exists(
    select 1 from pg_constraint where conname='accounting_fiscal_periods_boundary_type_chk'
      and conrelid='public.accounting_fiscal_periods'::regclass
  ) then 'PASS' else 'FAIL' end
  union all select 8,'boundary_values_valid',case when not exists(
    select 1 from public.accounting_fiscal_periods where boundary_type not in ('CALENDAR_MONTH','CUSTOM') or boundary_type is null
  ) then 'PASS' else 'FAIL' end
  union all select 9,'custom_period_reason_present',case when not exists(
    select 1 from public.accounting_fiscal_periods
    where boundary_type='CUSTOM' and length(trim(coalesce(boundary_override_reason,'')))<10
  ) then 'PASS' else 'FAIL' end
  union all select 10,'no_overlapping_fiscal_periods',case when not exists(
    select 1 from public.accounting_fiscal_periods a
    join public.accounting_fiscal_periods b on a.id<b.id
      and a.period_start<=b.period_end and a.period_end>=b.period_start
  ) then 'PASS' else 'FAIL' end
  union all select 11,'calendar_month_classification_consistent',case when not exists(
    select 1 from public.accounting_fiscal_periods
    where boundary_type='CALENDAR_MONTH' and not public.accounting_is_calendar_month(period_start,period_end)
  ) then 'PASS' else 'FAIL' end
  union all select 12,'custom_classification_consistent',case when not exists(
    select 1 from public.accounting_fiscal_periods
    where boundary_type='CUSTOM' and public.accounting_is_calendar_month(period_start,period_end)
  ) then 'PASS' else 'FAIL' end
  union all select 13,'closed_period_locks_still_present',case when not exists(
    select 1 from public.accounting_fiscal_periods p
    where p.status='CLOSED' and not exists(
      select 1 from public.accounting_period_locks l where l.period_start=p.period_start and l.period_end=p.period_end
    )
  ) then 'PASS' else 'FAIL' end
  union all select 14,'period_close_tables_intact',case when to_regclass('public.accounting_period_close_checklist') is not null
    and to_regclass('public.accounting_period_close_snapshots') is not null
    and to_regclass('public.accounting_period_close_actions') is not null
    and to_regclass('public.accounting_period_adjustments') is not null then 'PASS' else 'FAIL' end
)
select n,control,status from checks order by n;
