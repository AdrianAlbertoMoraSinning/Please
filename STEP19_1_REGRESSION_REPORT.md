# STEP 19.1 — Regression Report

Baseline: **STEP 19 — Operational Finance Automation**  
GitHub production baseline commit: `bf9b54ef801005b74af785d359ff112b88a0fcf1`

## Scope

STEP 19.1 adds only the customer-facing invoice-delivery workflow and selective Google review requests requested during production testing.

Authorized application changes:

- `admin-invoices.html`
- `admin-jobs.html`
- `js/admin-invoices.js`
- `js/admin-jobs.js`
- new `netlify/functions/admin-invoice-delivery-action.js`

No existing baseline file was deleted.

## Protected systems

The following core STEP 19 files remain byte-identical to the accepted baseline and continue to be protected by SHA-256 regression tests:

- public Home and Service Request surfaces
- Customer Tracking
- `invoice.html`
- `js/invoice.js`
- `netlify/functions/invoice-checkout.js`
- `stripe-webhook.js`
- `netlify/functions/admin-invoice-action.js`
- Provider Payment action
- CAL Purchases, Expenses and Banking engines

This intentionally means STEP 19.1 does **not** rewrite the working Stripe checkout/webhook or the existing invoice financial engine.

## STEP 19.1 controls

- DRAFT invoice remains editable until PLEASE approves the final customer amount.
- One `SEND INVOICE` action saves the final DRAFT values, issues the invoice, then sends the customer email.
- If email delivery fails after issue, the invoice remains `ISSUED`; it is never falsely recorded as `SENT`.
- Customer email links directly to the existing tokenized invoice and existing Stripe checkout; no Request Reference/email re-entry is required.
- e-Transfer instructions use the confirmed PLEASE receiving address `info@pleaseservice.ca` by default; `PLEASE_ETRANSFER_EMAIL` remains available as an override.
- Google review request is available only after payment.
- Review delivery uses the confirmed PLEASE Google Business Profile CID deep-link by default; `PLEASE_GOOGLE_REVIEW_URL` remains available as an override and a marker is recorded in invoice history after successful delivery.
- Duplicate review requests for the same invoice are blocked.
- Completed Jobs expose a direct `REVIEW & SEND INVOICE` path into Invoice Administration.

## Automated regression

Command: `node --test tests/*.test.js`

Result: **106 PASS / 0 FAIL / 0 skipped**.

This consists of the retained STEP 15–19 regression suite plus 9 dedicated STEP 19.1 checks, including runtime tests for successful invoice delivery, email-failure recovery, paid-only review delivery and duplicate-review protection.

JavaScript syntax validation also passed for:

- `netlify/functions/admin-invoice-delivery-action.js`
- `js/admin-invoices.js`
- `js/admin-jobs.js`

## Database

**No SQL migration is required for STEP 19.1.** Existing invoice status history is reused for traceability.

## Production destinations confirmed

No new Netlify environment value is required for the initial STEP 19.1 deployment:

- e-Transfer destination: `info@pleaseservice.ca`.
- Google Business Profile CID: `11821370300392660033` / `0xa40df1a7e941dc41`.
- Review CTA default: Google Search review deep-link for the PLEASE Services listing.

`PLEASE_ETRANSFER_EMAIL` and `PLEASE_GOOGLE_REVIEW_URL` are still supported as Netlify overrides so PLEASE can change either destination without another code release.

## Manual production smoke checks

1. Complete a disposable/real Job and wait for STEP 19 to create its DRAFT invoice.
2. From Jobs select **REVIEW & SEND INVOICE**.
3. Change the customer price on the DRAFT invoice and verify GST/total recalculation.
4. Press **SEND INVOICE** and confirm the customer receives one email with the final total and PAY NOW.
5. Confirm PAY NOW opens the existing invoice and Stripe checkout without asking for Request Reference/email again.
6. Confirm the email includes the configured e-Transfer destination and invoice reference instructions.
7. Simulate/observe an email delivery failure only in a controlled environment and confirm invoice stays `ISSUED`, not `SENT`.
8. Record/receive payment and confirm the invoice becomes PAID through the existing payment workflow.
9. Press **SEND REVIEW REQUEST** on a selected paid invoice and verify the Google review CTA.
10. Confirm the same invoice cannot send a duplicate review request.

Status: **CODE READY — production destinations confirmed; pending deployment + production smoke test.**
