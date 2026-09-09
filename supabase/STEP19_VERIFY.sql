-- PLEASE — STEP 19 Verification (read-only)
-- Run AFTER STEP19_OPERATIONAL_FINANCE_AUTOMATION.sql.
-- This script does not modify production data. It returns PASS/FAIL controls.

with controls as (
  select 1 as n,'operational_finance_settings_exists' as control,
    (to_regclass('public.operational_finance_settings') is not null) as ok,
    'STEP 19 automation settings table' as detail
  union all select 2,'operational_finance_queue_exists',to_regclass('public.operational_finance_queue') is not null,'Durable completed-job finance queue'
  union all select 3,'operational_finance_exceptions_exists',to_regclass('public.operational_finance_exceptions') is not null,'Needs-review items are explicit, not guessed journals'
  union all select 4,'operational_finance_cash_counts_exists',to_regclass('public.operational_finance_cash_counts') is not null,'Physical cash closing control'
  union all select 5,'job_completion_trigger_exists',exists(select 1 from pg_trigger where tgname='trg_step19_operational_finance_job_completed' and not tgisinternal),'Completed Job durable enqueue trigger'
  union all select 6,'finance_worker_function_exists',exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='operational_finance_process_pending'),'Operational finance worker function'
  union all select 7,'finance_backfill_function_exists',exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='operational_finance_enqueue_completed_jobs'),'Controlled completed-job enqueue recovery function'
  union all select 8,'cash_count_function_exists',exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='operational_finance_record_cash_count'),'Cash count creates review exception rather than guessed posting'
  union all select 9,'provider_live_action_exists',exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='provider_live_service_action'),'PLEASE Staff daily shift lifecycle is installed'
  union all select 10,'safe_default_auto_draft_on',coalesce((select auto_create_invoice_draft from public.operational_finance_settings where singleton_id=1),false)=true,'Completed Jobs may prepare DRAFT invoices automatically'
  union all select 11,'safe_default_auto_issue_off',coalesce((select auto_issue_invoice from public.operational_finance_settings where singleton_id=1),true)=false,'Invoice issue remains a commercial decision by default'
  union all select 12,'safe_default_auto_email_off',coalesce((select auto_email_invoice from public.operational_finance_settings where singleton_id=1),true)=false,'Invoice email remains opt-in by default'
  union all select 13,'queue_event_key_unique',exists(
    select 1 from pg_indexes where schemaname='public' and tablename='operational_finance_queue' and indexdef ilike '%unique%' and indexdef ilike '%event_key%'
  ),'Idempotent queue event key prevents duplicate completion tasks'
  union all select 14,'invoice_job_link_available',exists(
    select 1 from information_schema.columns where table_schema='public' and table_name='invoices' and column_name='job_id'
  ),'Invoice remains tied to source Job'
  union all select 15,'job_billing_snapshot_available',to_regclass('public.job_billing_items') is not null,'Automated invoice uses frozen Job billing items'
  union all select 16,'step17_outbox_preserved',to_regclass('public.please_accounting_outbox') is not null,'STEP 17 remains native accounting event engine'
  union all select 17,'daily_check_in_logic_present',exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='provider_live_service_action'
      and pg_get_functiondef(p.oid) ilike '%Daily Check In%'
      and pg_get_functiondef(p.oid) ilike '%first confirmed PLEASE Staff service of the day%'
  ),'One Daily Check In is enforced at the first confirmed staff service'
  union all select 18,'daily_check_out_logic_present',exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='provider_live_service_action'
      and pg_get_functiondef(p.oid) ilike '%Daily Check Out%'
      and pg_get_functiondef(p.oid) ilike '%final scheduled%'
  ),'One Daily Check Out is enforced after the final staff service'
  union all select 19,'finance_tables_rls_enabled',not exists(
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('operational_finance_settings','operational_finance_queue','operational_finance_exceptions','operational_finance_cash_counts')
      and not c.relrowsecurity
  ),'STEP 19 finance control tables are RLS hardened'
  union all select 20,'no_historical_invoice_backfill_pending',not exists(
    select 1 from public.operational_finance_queue q
    where q.event_type='JOB_COMPLETED' and q.created_at < now()-interval '30 days' and q.status in ('PENDING','PROCESSING')
  ),'No stale historical completion task is unexpectedly waiting after deployment'
)
select n,control,case when ok then 'PASS' else 'FAIL' end as result,detail
from controls
order by n;

-- Final gate: should return 20 PASS / 0 FAIL.
with controls as (
  select (to_regclass('public.operational_finance_settings') is not null) ok
  union all select to_regclass('public.operational_finance_queue') is not null
  union all select to_regclass('public.operational_finance_exceptions') is not null
  union all select to_regclass('public.operational_finance_cash_counts') is not null
  union all select exists(select 1 from pg_trigger where tgname='trg_step19_operational_finance_job_completed' and not tgisinternal)
  union all select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='operational_finance_process_pending')
  union all select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='operational_finance_enqueue_completed_jobs')
  union all select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='operational_finance_record_cash_count')
  union all select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='provider_live_service_action')
  union all select coalesce((select auto_create_invoice_draft from public.operational_finance_settings where singleton_id=1),false)=true
  union all select coalesce((select auto_issue_invoice from public.operational_finance_settings where singleton_id=1),true)=false
  union all select coalesce((select auto_email_invoice from public.operational_finance_settings where singleton_id=1),true)=false
  union all select exists(select 1 from pg_indexes where schemaname='public' and tablename='operational_finance_queue' and indexdef ilike '%unique%' and indexdef ilike '%event_key%')
  union all select exists(select 1 from information_schema.columns where table_schema='public' and table_name='invoices' and column_name='job_id')
  union all select to_regclass('public.job_billing_items') is not null
  union all select to_regclass('public.please_accounting_outbox') is not null
  union all select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='provider_live_service_action' and pg_get_functiondef(p.oid) ilike '%Daily Check In%' and pg_get_functiondef(p.oid) ilike '%first confirmed PLEASE Staff service of the day%')
  union all select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='provider_live_service_action' and pg_get_functiondef(p.oid) ilike '%Daily Check Out%' and pg_get_functiondef(p.oid) ilike '%final scheduled%')
  union all select not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('operational_finance_settings','operational_finance_queue','operational_finance_exceptions','operational_finance_cash_counts') and not c.relrowsecurity)
  union all select not exists(select 1 from public.operational_finance_queue q where q.event_type='JOB_COMPLETED' and q.created_at < now()-interval '30 days' and q.status in ('PENDING','PROCESSING'))
)
select count(*) filter(where ok) as pass_count,count(*) filter(where not ok) as fail_count,
       case when bool_and(ok) then 'STEP 19 DATABASE READY' else 'STEP 19 NOT READY — REVIEW FAIL CONTROLS' end as release_gate
from controls;
