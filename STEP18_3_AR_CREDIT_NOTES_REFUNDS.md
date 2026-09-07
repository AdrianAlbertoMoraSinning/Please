# STEP 18.3 — Accounts Receivable + Credit Notes + Refunds

## Scope
This step extends the accepted STEP 18.2 baseline. It does not replace PLEASE operational invoices, successful payment transactions, Stripe checkout/webhook logic, Provider Payments, Purchases/A/P, or posted journal history.

## Added
- Party-linked Accounts Receivable and customer names.
- A/R Aging and customer-credit calculation.
- Formal Credit Notes linked to the original invoice.
- Credit Note workflow: DRAFT → SUBMITTED → APPROVED → POSTED.
- Full and partial credit notes, including optional sales-tax adjustment.
- Printable Credit Note containing original-invoice, customer, company/BN and tax information.
- Completed Refund records limited to actual available customer credit.
- Financial-account selection for refund cash/clearing outflow.
- STEP 17 durable events: `CREDIT_NOTE_ISSUED` and `REFUND_COMPLETED`.
- Automatic Journal postings through the existing idempotent accounting worker.

## Accounting
Credit Note:
- Dr Revenue
- Dr GST/HST/QST Payable when tax is credited
- Cr Accounts Receivable

Refund:
- Dr Accounts Receivable
- Cr selected Bank/Cash/Clearing GL account

## Important refund boundary
STEP 18.3 records a refund after the money has actually been returned. It intentionally does not call the Stripe Refund API or rewrite the original successful `payment_transactions` row. A successful original payment remains historical fact; the refund is a separate immutable financial event.

## Deployment order
1. Run `STEP18_3_AR_CREDIT_NOTES_REFUNDS.sql` in Supabase.
2. Run `STEP18_3_VERIFY.sql`; all check rows should be PASS.
3. Upload the STEP 18.3 UPLOAD_ONLY package to GitHub preserving folders.
4. Wait for Netlify Published.
5. Validate A/R customer names and balances.
6. Smoke test Credit Note → Submit → Approve → Post → Journal.
7. If the credit creates a customer credit, record Refund → Journal.
8. Confirm Accounting Engine HEALTHY / Pending 0 / Retry 0 / Dead Letter 0 after worker processing.

Only after acceptance proceed to STEP 18.4.
