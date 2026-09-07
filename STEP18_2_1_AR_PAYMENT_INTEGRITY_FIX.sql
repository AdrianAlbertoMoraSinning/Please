-- STEP 18.2.1 — A/R Payment Integrity Fix
-- Scope: repair the CAL A/R mirror only.
-- Does NOT modify PLEASE invoices, payment_transactions, Stripe records, or journal entries.
begin;

with payment_totals as (
  select
    ai.id as invoice_id,
    coalesce(round(sum(ap.amount)::numeric,2),0::numeric) as payment_total
  from public.accounting_invoices ai
  left join public.accounting_payments ap on ap.invoice_id=ai.id
  group by ai.id
)
update public.accounting_invoices ai
set paid_total=pt.payment_total,
    updated_at=now()
from payment_totals pt
where ai.id=pt.invoice_id
  and coalesce(ai.paid_total,0) is distinct from pt.payment_total;

commit;
