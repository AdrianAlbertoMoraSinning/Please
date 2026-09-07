# STEP 18.2 — Purchases & Accounts Payable

## Purpose

STEP 18.2 adds the purchase-supplier Accounts Payable cycle on top of STEP 17 Native Accounting Engine and STEP 18.1 Financial Master Data.

This module is deliberately separate from PLEASE operational `provider_payments`. A service Provider may also receive the SUPPLIER role, but workforce/provider compensation continues to use the existing operational flow.

## Workflow

Supplier Bill lifecycle:

`DRAFT → SUBMITTED → APPROVED → POSTED → PARTIAL / PAID`

- `DRAFT`: editable and non-posting.
- `SUBMITTED`: awaiting approval; no General Ledger effect.
- `APPROVED`: approved but still no General Ledger effect.
- `POSTED`: Accounts Payable is recognized and a durable STEP 17 event is queued.
- `PARTIAL`: one or more supplier payments exist and a balance remains.
- `PAID`: outstanding balance is zero.
- `VOID`: available only before posting.

Posted supplier bills and paid supplier payments are financially immutable. Future corrections to posted purchase documents must use a vendor-credit/reversal workflow rather than silent editing.

## Accounting events

### VENDOR_BILL_POSTED

For each line:

- Debit Expense or Asset for line subtotal plus non-recoverable tax.
- Debit GST/HST Recoverable (`1200`) for recoverable GST/HST.
- Debit QST Recoverable (`1210`) for recoverable QST.
- Credit Accounts Payable (`2000`) for the full bill total.

Example Alberta supplier bill:

```text
Dr Repairs & Maintenance       1,000.00
Dr GST/HST Recoverable            50.00
Cr Accounts Payable             1,050.00
```

### SUPPLIER_PAYMENT_PAID

```text
Dr Accounts Payable
Cr mapped Bank / Cash / Credit Card GL account
```

The payment event depends on the bill-posting event and retries without consuming an error attempt while the bill event is still pending.

## Transactional safety

- Supplier bill drafts are saved atomically through PostgreSQL RPC.
- Posting status transition and durable accounting outbox event happen in the same database transaction.
- Supplier payment insert, AP balance/status update and durable accounting event happen in one database transaction.
- Overpayments are rejected.
- Payment account currency must match the supplier-bill currency in STEP 18.2.
- Browser roles cannot access accounting purchase tables directly; CAL server functions require a valid PLEASE Admin session.

## What is added

- `accounting_supplier_bills`
- `accounting_supplier_bill_lines`
- `accounting_supplier_payments`
- Supplier bill and payment sequences
- Atomic save / workflow / payment RPCs
- `VENDOR_BILL_POSTED` and `SUPPLIER_PAYMENT_PAID` posting rules
- STEP 17 worker handlers for purchase/AP events
- CAL `Purchases & A/P` screen
- A/P aging and open-payables dashboard within the module

## Explicitly not changed

- PLEASE public Home
- Customer Service Request flow
- Provider Portal
- Operational `provider_payments`
- Existing customer invoice/payment flow
- Stripe checkout/webhook behavior
- STEP 17 invoice/provider accounting logic
- Existing journal history

## Deployment order

1. Keep the accepted STEP 18.1 baseline available.
2. Run `supabase/STEP18_2_PURCHASES_AP.sql` in Supabase SQL Editor.
3. Confirm `Success. No rows returned`.
4. Run `supabase/STEP18_2_VERIFY.sql` and confirm all rows are `PASS`.
5. Upload STEP 18.2 code package to GitHub preserving folders.
6. Wait for Netlify `Published`.
7. Smoke-test Home, Admin, Provider, Service Request, Payment and CAL Dashboard.
8. Open CAL → Purchases & A/P.
9. Create a test Supplier Bill → Submit → Approve → Post.
10. Confirm STEP 17 Accounting Engine posts the AP journal and queue returns to zero pending.
11. Record a partial supplier payment and confirm the AP reduction journal.
12. Pay the remaining balance and verify bill status becomes `PAID`.
13. Only after acceptance proceed to STEP 18.3 AR + Credit Notes + Refunds.

## Rollback principle

STEP 18.2 is additive. If the new UI/API is rolled back, existing PLEASE operations and STEP 17 customer/provider accounting remain intact. Posted STEP 18.2 accounting records must not be deleted as a rollback mechanism; they require controlled accounting reversal if production transactions were created.
