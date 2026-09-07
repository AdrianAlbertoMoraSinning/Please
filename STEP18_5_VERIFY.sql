-- PLEASE / CAL — STEP 18.5 Verification
-- Read-only checks. Every row should return PASS.

with checks as (
  select 1 ord,'bank reconciliation table' check_name,(to_regclass('public.accounting_bank_reconciliations') is not null) ok,
         coalesce(to_regclass('public.accounting_bank_reconciliations')::text,'missing') detail
  union all select 2,'bank imports table',to_regclass('public.accounting_bank_imports') is not null,coalesce(to_regclass('public.accounting_bank_imports')::text,'missing')
  union all select 3,'bank transactions table',to_regclass('public.accounting_bank_transactions') is not null,coalesce(to_regclass('public.accounting_bank_transactions')::text,'missing')
  union all select 4,'bank matches table',to_regclass('public.accounting_bank_matches') is not null,coalesce(to_regclass('public.accounting_bank_matches')::text,'missing')
  union all select 5,'financial-account balance RPC',to_regprocedure('public.accounting_financial_account_balance(uuid,date)') is not null,coalesce(to_regprocedure('public.accounting_financial_account_balance(uuid,date)')::text,'missing')
  union all select 6,'start reconciliation RPC',to_regprocedure('public.accounting_start_bank_reconciliation(uuid,date,date,numeric,numeric,text,text)') is not null,coalesce(to_regprocedure('public.accounting_start_bank_reconciliation(uuid,date,date,numeric,numeric,text,text)')::text,'missing')
  union all select 7,'update statement control RPC',to_regprocedure('public.accounting_update_bank_reconciliation_control(uuid,numeric,numeric,text,text)') is not null,coalesce(to_regprocedure('public.accounting_update_bank_reconciliation_control(uuid,numeric,numeric,text,text)')::text,'missing')
  union all select 8,'statement import RPC',to_regprocedure('public.accounting_import_bank_rows(uuid,text,text,text,jsonb,text)') is not null,coalesce(to_regprocedure('public.accounting_import_bank_rows(uuid,text,text,text,jsonb,text)')::text,'missing')
  union all select 9,'manual matching RPC',to_regprocedure('public.accounting_match_bank_transaction(uuid,uuid[],text,text)') is not null,coalesce(to_regprocedure('public.accounting_match_bank_transaction(uuid,uuid[],text,text)')::text,'missing')
  union all select 10,'auto match RPC',to_regprocedure('public.accounting_auto_match_bank_reconciliation(uuid,text)') is not null,coalesce(to_regprocedure('public.accounting_auto_match_bank_reconciliation(uuid,text)')::text,'missing')
  union all select 11,'reconciliation snapshot RPC',to_regprocedure('public.accounting_bank_reconciliation_snapshot(uuid)') is not null,coalesce(to_regprocedure('public.accounting_bank_reconciliation_snapshot(uuid)')::text,'missing')
  union all select 12,'close reconciliation RPC',to_regprocedure('public.accounting_close_bank_reconciliation(uuid,text)') is not null,coalesce(to_regprocedure('public.accounting_close_bank_reconciliation(uuid,text)')::text,'missing')
  union all select 13,'financial master accounts available',exists(select 1 from public.accounting_financial_accounts where active=true),coalesce((select count(*)::text from public.accounting_financial_accounts where active=true),'0')||' active financial account(s)'
  union all select 14,'no duplicate bank fingerprints',not exists(select 1 from public.accounting_bank_transactions group by financial_account_id,fingerprint having count(*)>1),coalesce((select count(*)::text from (select 1 from public.accounting_bank_transactions group by financial_account_id,fingerprint having count(*)>1) d),'0')||' duplicate fingerprint group(s)'
  union all select 15,'closed reconciliations are balanced',not exists(select 1 from public.accounting_bank_reconciliations where status='CLOSED' and (abs(difference)>0.01 or abs(statement_control_difference)>0.01 or unmatched_statement_count<>0)),coalesce((select count(*)::text from public.accounting_bank_reconciliations where status='CLOSED' and (abs(difference)>0.01 or abs(statement_control_difference)>0.01 or unmatched_statement_count<>0)),'0')||' invalid closed reconciliation(s)'
  union all select 16,'journal-line clearing is unique',not exists(select 1 from public.accounting_bank_matches group by journal_line_id having count(*)>1),coalesce((select count(*)::text from (select 1 from public.accounting_bank_matches group by journal_line_id having count(*)>1) d),'0')||' journal line(s) cleared more than once'
  union all select 17,'source-row import identity available',exists(select 1 from information_schema.columns where table_schema='public' and table_name='accounting_bank_transactions' and column_name='source_row_number'),'source_row_number column'
  union all select 18,'reconciliation periods do not overlap',not exists(
    select 1 from public.accounting_bank_reconciliations a join public.accounting_bank_reconciliations b
      on a.financial_account_id=b.financial_account_id and a.id<b.id
     and daterange(a.period_start,a.period_end,'[]') && daterange(b.period_start,b.period_end,'[]')
  ),coalesce((select count(*)::text from (
    select 1 from public.accounting_bank_reconciliations a join public.accounting_bank_reconciliations b
      on a.financial_account_id=b.financial_account_id and a.id<b.id
     and daterange(a.period_start,a.period_end,'[]') && daterange(b.period_start,b.period_end,'[]')
  ) o),'0')||' overlapping reconciliation pair(s)'
)
select check_name,case when ok then 'PASS' else 'FAIL' end status,detail from checks order by ord;
