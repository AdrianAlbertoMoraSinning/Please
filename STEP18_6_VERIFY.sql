-- STEP 18.6 verification. Every row should return PASS after the migration.
with checks as (
select 1 n,'inventory_items_table' check_name,case when to_regclass('public.accounting_inventory_items') is not null then 'PASS' else 'FAIL' end result union all
select 2,'inventory_locations_table',case when to_regclass('public.accounting_inventory_locations') is not null then 'PASS' else 'FAIL' end union all
select 3,'inventory_balances_table',case when to_regclass('public.accounting_inventory_balances') is not null then 'PASS' else 'FAIL' end union all
select 4,'inventory_movements_table',case when to_regclass('public.accounting_inventory_movements') is not null then 'PASS' else 'FAIL' end union all
select 5,'inventory_counts_table',case when to_regclass('public.accounting_inventory_counts') is not null then 'PASS' else 'FAIL' end union all
select 6,'inventory_count_lines_table',case when to_regclass('public.accounting_inventory_count_lines') is not null then 'PASS' else 'FAIL' end union all
select 7,'inventory_gl_account_1600',case when exists(select 1 from public.accounting_accounts where code='1600' and active=true) then 'PASS' else 'FAIL' end union all
select 8,'cogs_account_6000',case when exists(select 1 from public.accounting_accounts where code='6000' and active=true) then 'PASS' else 'FAIL' end union all
select 9,'adjustment_account_6100',case when exists(select 1 from public.accounting_accounts where code='6100' and active=true) then 'PASS' else 'FAIL' end union all
select 10,'main_location_seed',case when exists(select 1 from public.accounting_inventory_locations where code='MAIN' and active=true) then 'PASS' else 'FAIL' end union all
select 11,'movement_engine',case when to_regprocedure('public.accounting_inventory_apply_movement(uuid,uuid,text,date,numeric,numeric,text,text,text,text,text,text,text,text)') is not null then 'PASS' else 'FAIL' end union all
select 12,'transfer_engine',case when to_regprocedure('public.accounting_inventory_transfer(uuid,uuid,uuid,date,numeric,text,text,text,text)') is not null then 'PASS' else 'FAIL' end union all
select 13,'physical_count_engine',case when to_regprocedure('public.accounting_post_inventory_count(uuid,text)') is not null then 'PASS' else 'FAIL' end union all
select 14,'supplier_inventory_mapping',case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='accounting_supplier_bill_lines' and column_name='inventory_item_id') and exists(select 1 from information_schema.columns where table_schema='public' and table_name='accounting_supplier_bill_lines' and column_name='inventory_location_id') then 'PASS' else 'FAIL' end union all
select 15,'expense_inventory_mapping',case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='accounting_expense_claim_lines' and column_name='inventory_item_id') and exists(select 1 from information_schema.columns where table_schema='public' and table_name='accounting_expense_claim_lines' and column_name='inventory_location_id') then 'PASS' else 'FAIL' end union all
select 16,'inventory_posting_rules',case when (select count(distinct event_type) from public.accounting_posting_rules where source_system='PLEASE' and enabled=true and event_type in ('INVENTORY_OPENING_POSTED','INVENTORY_ISSUE_POSTED','INVENTORY_ADJUSTMENT_POSTED'))=3 then 'PASS' else 'FAIL' end union all
select 17,'inventory_gl_balance_rpc',case when to_regprocedure('public.accounting_inventory_gl_balance(date)') is not null then 'PASS' else 'FAIL' end union all
select 18,'manufacturing_disabled',case when not exists(select 1 from public.accounting_inventory_items where manufacturing_enabled=true) then 'PASS' else 'FAIL' end union all
select 19,'inventory_tables_rls',case when not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('accounting_inventory_items','accounting_inventory_locations','accounting_inventory_balances','accounting_inventory_movements','accounting_inventory_counts','accounting_inventory_count_lines') and c.relrowsecurity=false) then 'PASS' else 'FAIL' end union all
select 20,'initial_subledger_gl_control',case when abs(coalesce(public.accounting_inventory_gl_balance(current_date),0)-coalesce(public.accounting_inventory_subledger_value(),0))<=0.02 then 'PASS' else 'REVIEW' end
) select n,check_name,result from checks order by n;
