-- STEP 18.2 verification. Run AFTER STEP18_2_PURCHASES_AP.sql.
with checks(test,status,detail) as (
  select 'supplier_bills_table',case when to_regclass('public.accounting_supplier_bills') is not null then 'PASS' else 'FAIL' end,'Supplier Bills table exists'
  union all select 'supplier_bill_lines_table',case when to_regclass('public.accounting_supplier_bill_lines') is not null then 'PASS' else 'FAIL' end,'Supplier Bill Lines table exists'
  union all select 'supplier_payments_table',case when to_regclass('public.accounting_supplier_payments') is not null then 'PASS' else 'FAIL' end,'Supplier Payments table exists'
  union all select 'save_bill_rpc',case when to_regprocedure('public.accounting_save_supplier_bill(uuid,uuid,text,date,date,text,text,text,jsonb,text)') is not null then 'PASS' else 'FAIL' end,'Atomic supplier bill draft save RPC exists'
  union all select 'bill_action_rpc',case when to_regprocedure('public.accounting_supplier_bill_action(uuid,text,text)') is not null then 'PASS' else 'FAIL' end,'Supplier bill workflow RPC exists'
  union all select 'supplier_payment_rpc',case when to_regprocedure('public.accounting_record_supplier_payment(uuid,uuid,date,numeric,text,text,text,text)') is not null then 'PASS' else 'FAIL' end,'Atomic supplier payment RPC exists'
  union all select 'bill_event_trigger',case when exists(select 1 from pg_trigger where tgname='trg_step18_2_supplier_bill_event' and not tgisinternal) then 'PASS' else 'FAIL' end,'Bill posting creates durable accounting event'
  union all select 'payment_event_trigger',case when exists(select 1 from pg_trigger where tgname='trg_step18_2_supplier_payment_event' and not tgisinternal) then 'PASS' else 'FAIL' end,'Supplier payment creates durable accounting event'
  union all select 'vendor_bill_posting_rule',case when exists(select 1 from public.accounting_posting_rules where source_system='PLEASE' and event_type='VENDOR_BILL_POSTED' and enabled=true) then 'PASS' else 'FAIL' end,'Vendor Bill posting rule enabled'
  union all select 'supplier_payment_posting_rule',case when exists(select 1 from public.accounting_posting_rules where source_system='PLEASE' and event_type='SUPPLIER_PAYMENT_PAID' and enabled=true) then 'PASS' else 'FAIL' end,'Supplier Payment posting rule enabled'
  union all select 'ap_control_account',case when exists(select 1 from public.accounting_accounts where code='2000' and account_type='LIABILITY' and active=true) then 'PASS' else 'FAIL' end,'Accounts Payable control account available'
  union all select 'gst_recoverable_account',case when exists(select 1 from public.accounting_accounts where code='1200' and account_type='ASSET' and active=true) then 'PASS' else 'FAIL' end,'GST/HST Recoverable account available'
  union all select 'rls_supplier_bills',case when exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='accounting_supplier_bills' and c.relrowsecurity=true) then 'PASS' else 'FAIL' end,'Supplier Bills RLS enabled'
  union all select 'operational_provider_payments_still_exists',case when to_regclass('public.provider_payments') is not null then 'PASS' else 'FAIL' end,'Existing operational Provider Payments table remains available'
)
select * from checks order by test;
