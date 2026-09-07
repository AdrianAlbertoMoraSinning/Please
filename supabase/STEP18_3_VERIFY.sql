-- PLEASE / CAL — STEP 18.3 verification
-- Read-only checks. Expected result: every row = PASS.

with checks as (
  select '18.3 tables installed' as check_name,
         case when to_regclass('public.accounting_credit_notes') is not null
                and to_regclass('public.accounting_credit_note_lines') is not null
                and to_regclass('public.accounting_customer_refunds') is not null then 'PASS' else 'FAIL' end as result
  union all
  select '18.3 RPCs installed',
         case when to_regprocedure('public.accounting_save_credit_note(uuid,uuid,date,text,text,boolean,text,jsonb,text)') is not null
                and to_regprocedure('public.accounting_credit_note_action(uuid,text,text)') is not null
                and to_regprocedure('public.accounting_customer_credit_available(uuid)') is not null
                and to_regprocedure('public.accounting_record_customer_refund(uuid,uuid,uuid,date,numeric,text,text,text,text)') is not null then 'PASS' else 'FAIL' end
  union all
  select 'A/R invoices linked to source invoice',
         case when not exists(
           select 1 from public.accounting_invoices ai
           join public.invoices i on i.invoice_number=ai.invoice_number
           where ai.source_invoice_id is null and ai.status<>'DRAFT'
         ) then 'PASS' else 'FAIL' end
  union all
  select 'A/R invoices linked to customer party',
         case when not exists(
           select 1 from public.accounting_invoices ai
           join public.invoices i on i.invoice_number=ai.invoice_number
           where ai.party_id is null and ai.status not in ('DRAFT','VOID')
         ) then 'PASS' else 'FAIL' end
  union all
  select 'Posted credit notes do not exceed invoice total',
         case when not exists(
           select 1 from public.accounting_invoices i
           join (select invoice_id,sum(total) total from public.accounting_credit_notes where status='POSTED' group by invoice_id) c on c.invoice_id=i.id
           where c.total>i.total+0.01
         ) then 'PASS' else 'FAIL' end
  union all
  select 'Posted credit-note tax does not exceed invoice tax',
         case when not exists(
           select 1 from public.accounting_invoices i
           join (select invoice_id,sum(tax_reduction) tax from public.accounting_credit_notes where status='POSTED' group by invoice_id) c on c.invoice_id=i.id
           where c.tax>i.tax_total+0.01
         ) then 'PASS' else 'FAIL' end
  union all
  select 'Refunds reference valid customer credit context',
         case when not exists(
           select 1 from public.accounting_customer_refunds r
           left join public.accounting_parties p on p.id=r.customer_party_id
           where r.status='COMPLETED' and p.id is null
         ) then 'PASS' else 'FAIL' end
  union all
  select 'Credit-note posting rule enabled',
         case when exists(select 1 from public.accounting_posting_rules where source_system='PLEASE' and event_type='CREDIT_NOTE_ISSUED' and enabled=true) then 'PASS' else 'FAIL' end
  union all
  select 'Refund posting rule enabled',
         case when exists(select 1 from public.accounting_posting_rules where source_system='PLEASE' and event_type='REFUND_COMPLETED' and enabled=true) then 'PASS' else 'FAIL' end
  union all
  select 'No unqueued posted Credit Notes',
         case when not exists(
           select 1 from public.accounting_credit_notes n
           where n.status='POSTED' and not exists(select 1 from public.please_accounting_outbox o where o.event_key='PLEASE:CREDIT_NOTE_ISSUED:'||n.id::text)
         ) then 'PASS' else 'FAIL' end
  union all
  select 'No unqueued completed Refunds',
         case when not exists(
           select 1 from public.accounting_customer_refunds r
           where r.status='COMPLETED' and not exists(select 1 from public.please_accounting_outbox o where o.event_key='PLEASE:REFUND_COMPLETED:'||r.id::text)
         ) then 'PASS' else 'FAIL' end
)
select * from checks order by check_name;

-- Informational A/R snapshot (no PASS/FAIL implication).
select i.invoice_number,
       p.party_number,
       coalesce(p.display_name,p.legal_name) as customer,
       i.total,
       coalesce(pay.paid,0) as paid,
       coalesce(cn.credited,0) as credited,
       greatest(0,round(i.total-coalesce(pay.paid,0)-coalesce(cn.credited,0),2)) as balance_due
from public.accounting_invoices i
left join public.accounting_parties p on p.id=i.party_id
left join (select invoice_id,sum(amount) paid from public.accounting_payments group by invoice_id) pay on pay.invoice_id=i.id
left join (select invoice_id,sum(total) credited from public.accounting_credit_notes where status='POSTED' group by invoice_id) cn on cn.invoice_id=i.id
order by i.invoice_date desc,i.invoice_number;
