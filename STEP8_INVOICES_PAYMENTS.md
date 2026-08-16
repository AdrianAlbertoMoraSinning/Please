# STEP 8 — Invoices + Payments

This step adds the billing layer without changing the tested Jobs / Assignment workflow.

## What is included

- `admin-invoices.html`: PLEASE billing dashboard.
- Draft invoice creation from a completed Job or as a standalone invoice.
- Invoice item editor (description, quantity, unit, rate).
- GST calculation, default 5%.
- Invoice lifecycle: `DRAFT → ISSUED → SENT → PAID`, plus `VOID` / `OVERDUE` support.
- Manual payment recording for e-transfer, cash or other offline methods.
- Public customer invoice URL using the existing cryptographically random `public_token`.
- Public `invoice.html` with invoice totals, GST and payment status.
- Stripe Checkout integration, enabled only when Stripe environment variables exist.
- Verified Stripe webhook before an invoice is marked paid.
- Payment transaction ledger and invoice status history.

## Database installation

Run:

`supabase/STEP8_INVOICES_PAYMENTS.sql`

Expected result: `Success. No rows returned`.

The script preserves the STEP 1 `invoices` and `invoice_items` tables and extends them. Existing Jobs are not modified.

## Stripe activation

The invoice system works before Stripe is activated: PLEASE can create, issue and share invoices, and can record e-transfer/cash/manual payments.

For online card payment, configure these Netlify environment variables:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Create a Stripe webhook destination pointing to:

`https://pleasewebportal.netlify.app/.netlify/functions/stripe-webhook`

Events used by this build:

- `checkout.session.completed`
- `checkout.session.expired`

The card payment page is Stripe-hosted Checkout. The application does not accept card numbers directly.

## Operational workflow

1. Complete a Job in Jobs Management.
2. Open Invoices → New Invoice.
3. Select the completed Job.
4. Enter service pricing / invoice items.
5. Save; GST and total are calculated server-side.
6. Issue Invoice.
7. Copy the Customer Invoice Link and send it to the customer.
8. Customer opens `invoice.html?token=...`.
9. With Stripe enabled, customer selects Pay securely online and is redirected to Stripe Checkout.
10. The invoice is marked `PAID` only after the verified Stripe webhook is received.

For e-transfer/cash, use `RECORD PAYMENT` in Admin instead.

## Security

- Admin billing endpoints require the existing PLEASE custom HttpOnly admin session.
- Public invoice lookup uses the cryptographically random invoice public token.
- The browser cannot mark an invoice paid.
- Stripe payment success is accepted only through webhook signature verification.
- Stripe secret keys remain server-side in Netlify environment variables.
