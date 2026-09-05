# PLEASE Portal — STEP 15.9.3
## Stripe Payment Return Recovery + Billing Production Finish

This release fixes the customer-facing invoice/payment return flow discovered during the first live Stripe test.

## Problem corrected

A customer could complete or cancel Stripe Checkout and then be returned to a PLEASE page showing:

> Invoice unavailable — Invalid invoice link.

That message was not acceptable for a production billing flow because the invoice token, Stripe Checkout Session and webhook state need to recover gracefully even when a customer cancels, returns with a pending webhook, or reopens the invoice after payment.

## What changed

### Customer invoice link

- `invoice.html` now handles `payment=cancelled`, `payment=success`, and `session_id` context without showing a false invalid-link error.
- Paid invoices remain visible from the same customer invoice link.
- The PAY button is hidden when the invoice is paid.
- A paid invoice shows payment confirmation details and the Stripe confirmation reference when available.
- A cancelled checkout shows a friendly message and allows the customer to pay again.

### Stripe Checkout creation

- `invoice-checkout.js` now sends customers to a dedicated `payment-success.html` after Stripe approval.
- Cancelled checkout now goes to `payment-cancelled.html` instead of dropping the customer back into a generic invoice state.
- New payment attempts are allowed for still-unpaid invoices, even when an earlier Checkout session was abandoned.
- Checkout creation writes an audit history entry.

### Payment success page

- `payment-success.html` now confirms the invoice by public token and/or Stripe Checkout Session ID.
- It polls briefly while waiting for Stripe's verified webhook to post back.
- When paid, it displays:
  - Payment successful
  - Invoice number
  - Amount paid
  - Paid status
  - Paid date
  - Stripe confirmation/reference
  - View paid invoice button

### Payment cancelled page

- New `payment-cancelled.html` page.
- It confirms the invoice is still outstanding.
- It displays amount due and a clean Pay Again path.
- It never shows a false invalid-link message unless the link truly cannot be resolved.

### Public payment result endpoint

- New `netlify/functions/public-payment-result.js` endpoint.
- Resolves invoices by:
  - public invoice token
  - Stripe Checkout Session ID
  - invoice ID when used internally
- Returns safe, customer-facing invoice/payment state only.

### Stripe webhook hardening

- `stripe-webhook.js` now resolves invoices by invoice ID or Checkout Session ID.
- It accepts a valid paid session for an unpaid invoice even if a newer session was created after an abandoned attempt.
- Duplicate webhook deliveries after payment are acknowledged safely.
- Expired sessions revert a pending invoice back to unpaid only when the expired session is the active session.
- Payment transaction notes now include available Stripe details such as:
  - webhook event ID
  - Checkout Session ID
  - Payment Intent
  - Charge ID when available
  - receipt URL when available
  - Stripe fee and net amount when Stripe returns balance transaction data

### Administration billing details

- Admin Invoices now displays a Stripe Payment Details panel when Stripe data exists.
- The panel includes Payment Intent, Checkout Session, Charge ID, amount, Stripe fees, net deposit, webhook event and receipt link when available.
- Customer-facing invoice values remain separate from provider compensation.

## Database / SQL

No new Supabase SQL migration is required for this release.

The release uses the existing invoice, invoice item, invoice status history and payment transaction tables. Additional Stripe details are stored in the existing `payment_transactions.note` field when available, avoiding a production schema dependency during live launch.

## Files changed

- `README.md`
- `STEP15_9_3_STRIPE_PAYMENT_RETURN_RECOVERY.md`
- `admin-invoices.html`
- `invoice.html`
- `payment-success.html`
- `payment-cancelled.html`
- `css/style.css`
- `js/invoice.js`
- `js/admin-invoices.js`
- `netlify/functions/_stripe-payment-lib.js`
- `netlify/functions/public-invoice.js`
- `netlify/functions/public-payment-result.js`
- `netlify/functions/invoice-checkout.js`
- `netlify/functions/stripe-webhook.js`
- `tests/step15_9_3_stripe_payment_return_recovery.test.js`
- `tests/step15_9_3_stripe_webhook_runtime.test.js`

## Deployment checklist

1. Upload the full ZIP to GitHub, or upload the hotfix ZIP files only.
2. Wait for Netlify Production deploy to complete.
3. Confirm Netlify Production environment variables contain the live `STRIPE_SECRET_KEY` and live `STRIPE_WEBHOOK_SECRET`.
4. Create a new small live invoice.
5. Open the public invoice link.
6. Press PAY and confirm Stripe Checkout does not show Sandbox/Test.
7. Pay with a real card.
8. Confirm `payment-success.html` shows Payment Successful once the webhook posts back.
9. Reopen the invoice link and confirm it shows PAID and hides PAY.
10. In Admin Invoices, confirm Payment History and Stripe Payment Details are visible.
11. In Stripe Workbench, confirm the `checkout.session.completed` delivery returned HTTP 2xx.
