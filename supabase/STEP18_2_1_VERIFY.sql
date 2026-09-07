-- STEP 18.2.1 verification — all checks should return PASS.
with payment_totals as (
  select ai.id,
         ai.invoice_number,
         ai.total,
         ai.paid_total,
         coalesce(round(sum(ap.amount)::numeric,2),0::numeric) as payment_total
  from public.accounting_invoices ai
  left join public.accounting_payments ap on ap.invoice_id=ai.id
  group by ai.id,ai.invoice_number,ai.total,ai.paid_total
), checks as (
  select 'A/R mirror paid_total equals payment history'::text as check_name,
         case when count(*) filter(where paid_total is distinct from payment_total)=0 then 'PASS' else 'FAIL' end as result,
         count(*) filter(where paid_total is distinct from payment_total)::text as detail
  from payment_totals
  union all
  select 'No duplicate PLEASE payment mirror references',
         case when count(*)=0 then 'PASS' else 'FAIL' end,
         count(*)::text
  from (
    select reference
    from public.accounting_payments
    where reference like 'PLEASE-PAYMENT-%'
    group by reference
    having count(*)>1
  ) d
  union all
  select 'No negative A/R mirror payments',
         case when count(*)=0 then 'PASS' else 'FAIL' end,
         count(*)::text
  from public.accounting_payments
  where amount<=0
)
select * from checks order by check_name;

-- Diagnostic detail (informational): current invoice totals vs payment-derived Paid.
select invoice_number,total,paid_total,payment_total,(total-payment_total) as balance
from (
  select ai.invoice_number,ai.total,ai.paid_total,
         coalesce(round(sum(ap.amount)::numeric,2),0::numeric) as payment_total
  from public.accounting_invoices ai
  left join public.accounting_payments ap on ap.invoice_id=ai.id
  group by ai.id,ai.invoice_number,ai.total,ai.paid_total
) x
order by invoice_number;
