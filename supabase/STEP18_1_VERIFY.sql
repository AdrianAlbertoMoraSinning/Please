-- STEP 18.1 — Post-migration verification (read-only)
-- Expected: every row returns status = PASS.
with checks as (
  select 1 as ord,'accounting_parties table' as check_name,
         case when to_regclass('public.accounting_parties') is not null then 'PASS' else 'FAIL' end as status,
         coalesce((select count(*)::text from public.accounting_parties),'0') as detail
  union all
  select 2,'accounting_party_roles table',case when to_regclass('public.accounting_party_roles') is not null then 'PASS' else 'FAIL' end,
         coalesce((select count(*)::text from public.accounting_party_roles),'0')
  union all
  select 3,'accounting_financial_accounts table',case when to_regclass('public.accounting_financial_accounts') is not null then 'PASS' else 'FAIL' end,
         coalesce((select count(*)::text from public.accounting_financial_accounts),'0')
  union all
  select 4,'STEP 17 system GL protection',case when (select count(*) from public.accounting_accounts where system_managed=true and code in ('1000','1090','1100','1200','1300','2000','2010','2100','3000','4000','5000','5400','5700'))=13 then 'PASS' else 'FAIL' end,
         (select count(*)::text||'/13 protected' from public.accounting_accounts where system_managed=true and code in ('1000','1090','1100','1200','1300','2000','2010','2100','3000','4000','5000','5400','5700'))
  union all
  select 5,'Operating Bank master mapping',case when exists(select 1 from public.accounting_financial_accounts f join public.accounting_accounts a on a.id=f.gl_account_id where a.code='1000' and f.financial_type='BANK') then 'PASS' else 'FAIL' end,
         coalesce((select f.name from public.accounting_financial_accounts f join public.accounting_accounts a on a.id=f.gl_account_id where a.code='1000' limit 1),'missing')
  union all
  select 6,'Stripe Clearing master mapping',case when exists(select 1 from public.accounting_financial_accounts f join public.accounting_accounts a on a.id=f.gl_account_id where a.code='1090' and f.financial_type='CLEARING') then 'PASS' else 'FAIL' end,
         coalesce((select f.name from public.accounting_financial_accounts f join public.accounting_accounts a on a.id=f.gl_account_id where a.code='1090' limit 1),'missing')
  union all
  select 7,'Source sync function',case when to_regprocedure('public.accounting_upsert_source_party(text,text,jsonb)') is not null then 'PASS' else 'FAIL' end,'best-effort source sync'
  union all
  select 8,'Customer source trigger',case when to_regclass('public.customers') is null or exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='customers' and t.tgname='trg_step18_1_customer_party_sync' and not t.tgisinternal) then 'PASS' else 'FAIL' end,
         case when to_regclass('public.customers') is null then 'customers table not present' else 'trigger expected' end
  union all
  select 9,'Provider source trigger',case when to_regclass('public.providers') is null or exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='providers' and t.tgname='trg_step18_1_provider_party_sync' and not t.tgisinternal) then 'PASS' else 'FAIL' end,
         case when to_regclass('public.providers') is null then 'providers table not present' else 'trigger expected' end
  union all
  select 10,'PLEASE customer party backfill',case when to_regclass('public.customers') is null or not exists(select 1 from public.customers) or exists(select 1 from public.accounting_parties where source_system='PLEASE' and source_table='customers') then 'PASS' else 'FAIL' end,
         (select count(*)::text||' linked customer parties' from public.accounting_parties where source_system='PLEASE' and source_table='customers')
  union all
  select 11,'PLEASE provider party backfill',case when to_regclass('public.providers') is null or not exists(select 1 from public.providers) or exists(select 1 from public.accounting_parties where source_system='PLEASE' and source_table='providers') then 'PASS' else 'FAIL' end,
         (select count(*)::text||' linked provider parties' from public.accounting_parties where source_system='PLEASE' and source_table='providers')
)
select check_name,status,detail from checks order by ord;
