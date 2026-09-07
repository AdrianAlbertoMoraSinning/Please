# STEP 18.2.1 — A/R Payment Integrity Fix

## Problem found
CAL copied `PLEASE invoices.amount_paid` into `accounting_invoices.paid_total` when mirroring an invoice, then added the same successful payment again when the `PAYMENT_RECEIVED` event mirrored it into `accounting_payments`. A fully paid $189 invoice could therefore display $378 as Paid even though there was only one real payment and one journal posting.

## Correction
- `accounting_payments` is the authoritative A/R payment mirror.
- CAL invoice display derives Paid by summing `accounting_payments` per invoice.
- `accounting_invoices.paid_total` remains a convenience cache and is recomputed from payment rows, never incremented from a previously copied operational amount.
- Invoice mirroring no longer copies PLEASE `amount_paid` into the CAL paid cache.
- A one-time idempotent SQL repair resets existing CAL `paid_total` values to the payment-history aggregate.

## Explicitly untouched
- `invoices` (PLEASE operational invoice source)
- `payment_transactions`
- Stripe webhook/payment records
- Stripe Checkout/payment intents/charges
- `accounting_journal_entries`
- `accounting_journal_lines`
- Provider payments
- Purchases/A/P supplier bills and payments

## Deployment order
1. Run `supabase/STEP18_2_1_AR_PAYMENT_INTEGRITY_FIX.sql` in Supabase.
2. Run `supabase/STEP18_2_1_VERIFY.sql` and confirm all checks PASS.
3. Deploy the STEP 18.2.1 upload-only files to GitHub/Netlify.
4. Reopen CAL → Invoices & A/R and confirm Paid equals the actual invoice payment amount.
5. Confirm STEP 17 Accounting Engine remains HEALTHY.

Do not start STEP 18.3 until this correction and the STEP 18.2 Supplier Bill smoke test are accepted.
