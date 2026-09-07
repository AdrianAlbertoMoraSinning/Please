-- PLEASE / CAL — STEP 18.4 verification
with checks as (
  select 'expense_claims_table'::text check_name, (to_regclass('public.accounting_expense_claims') is not null) ok
  union all select 'expense_lines_table', to_regclass('public.accounting_expense_claim_lines') is not null
  union all select 'expense_reimbursements_table', to_regclass('public.accounting_expense_reimbursements') is not null
  union all select 'save_expense_rpc', to_regprocedure('public.accounting_save_expense_claim(uuid,date,date,uuid,uuid,text,uuid,text,text,text,text,text,text,text,jsonb,text)') is not null
  union all select 'expense_action_rpc', to_regprocedure('public.accounting_expense_claim_action(uuid,text,text,text)') is not null
  union all select 'reimbursement_rpc', to_regprocedure('public.accounting_record_expense_reimbursement(uuid,uuid,date,numeric,text,text,text,text)') is not null
  union all select 'expense_post_rule', exists(select 1 from public.accounting_posting_rules where source_system='PLEASE' and event_type='EXPENSE_POSTED' and enabled)
  union all select 'expense_reimbursement_rule', exists(select 1 from public.accounting_posting_rules where source_system='PLEASE' and event_type='EXPENSE_REIMBURSEMENT_PAID' and enabled)
  union all select 'reimbursement_payable_account', exists(select 1 from public.accounting_accounts where code='2020' and account_type='LIABILITY' and active)
  union all select 'fuel_expense_account', exists(select 1 from public.accounting_accounts where code='5100' and account_type='EXPENSE' and active)
  union all select 'private_accounting_documents_bucket', coalesce((select not public from storage.buckets where id='accounting-documents'),false)
  union all select 'no_unbalanced_posted_expense_events', not exists(
    select 1 from public.accounting_external_events e
    join public.accounting_journal_entries j on j.id=e.journal_entry_id
    left join lateral (
      select round(coalesce(sum(l.debit),0),2) debits,round(coalesce(sum(l.credit),0),2) credits
      from public.accounting_journal_lines l where l.journal_entry_id=j.id
    ) x on true
    where e.source_system='PLEASE' and e.event_type in ('EXPENSE_POSTED','EXPENSE_REIMBURSEMENT_PAID') and e.posting_status='POSTED' and x.debits<>x.credits
  )
)
select check_name,case when ok then 'PASS' else 'FAIL' end status from checks order by check_name;
