# PLEASE — STEP 19.2 Customer Journey Simplification & Final Billing Sync

## Objective

Reduce routine customer email volume while preserving all operational statuses, audit history, provider workflow and payment controls.

STEP 19.2 separates **internal operational state** from **customer notification milestones**.

## Final customer journey

Normal customer emails are reduced to these milestones:

1. **Request Received** — sent when the customer submits a Service Request.
2. **Service Confirmed** — sent once, only when every active Provider assignment required for the Job is confirmed.
3. **Service Complete + Invoice / Pay Now** — sent only after the Job is completed, Administration reviews the Draft invoice and selects SEND INVOICE.
4. **Payment Confirmation** — sent when an online or manually confirmed payment is recorded.
5. **Review Request** — manually selected by PLEASE after payment.

The following remain valid operational states but no longer create routine customer emails:

- REVIEWING
- READY_TO_ASSIGN
- Job coordination / assignment creation
- Individual Provider confirmation before the complete required team is confirmed
- Provider ARRIVE
- Service START
- Service COMPLETE

Exceptional customer-impacting messages remain available, including cancellation, approved schedule changes and additional-time/extension requests.

## Service Confirmed rule

Provider acceptance continues to notify PLEASE Administration.

The customer is notified only when all active `PENDING/CONFIRMED` assignments on the Job have become `CONFIRMED`. The customer email is idempotent at the Job level so a retry or a second Provider confirmation cannot create duplicate Service Confirmed messages.

## Invoice email simplification

The invoice email now uses:

- Subject: `PLEASE — Your service is complete · Invoice <invoice number>`
- Title: `Your service is complete — Invoice <invoice number>`
- Greeting based on the customer's first name only
- Card/Debit copy: `Click PAY NOW to securely pay online.`
- e-Transfer copy: payment email + invoice number as the payment reference

Customer-facing invoice copy no longer mentions Stripe. Stripe remains the secure payment processor underneath the existing payment workflow.

## Public invoice simplification

The public invoice:

- preserves logo, Bill To, invoice items, GST, totals and PAY button;
- suppresses the internal automation note beginning `Automatically prepared from completed Job...`;
- removes customer-facing Stripe terminology from payment status and checkout copy.

Internal notes/history remain available to PLEASE Administration.

## Final invoice to Job synchronization

When Administration edits and saves a **DRAFT** invoice tied to a completed Job:

- the final invoice subtotal synchronizes to `jobs.quoted_subtotal`;
- for a one-line invoice, the Job legacy customer rate/quantity/unit are refreshed;
- when the invoice and frozen Job billing have the same line structure, customer-side Job billing rates are synchronized;
- Provider unit rates and Provider amounts are never overwritten by invoice editing;
- if the invoice structure differs from the frozen Job billing structure, only the final Job customer subtotal is synchronized, preserving Provider economics.

This allows the final customer amount to be reflected without corrupting the frozen Provider compensation snapshot.

## Administration visibility

### Service Requests

A linked request continues to preserve the original request facts. The drawer now also shows:

- related Job reference;
- current Job customer subtotal;
- final Invoice number/status;
- final invoiced total.

### Jobs

The Job detail now separates:

- **Final Customer Billing** from the Invoice; and
- **Provider / Job Billing Snapshot** used for provider economics and margin history.

### Master Calendar

Assignment details now show the final customer invoice values when a non-void invoice exists, while preserving the frozen Job/provider billing snapshot separately.

## Database impact

**No SQL migration is required for STEP 19.2.**

STEP 19.2 uses the existing Service Request, Job, Job Billing, Invoice, Invoice Item and assignment tables from the current production schema.

## Deployment order

1. Deploy the STEP 19.2 changed files.
2. Wait for Netlify status **Published**.
3. Hard-refresh Administration pages.
4. Open a fresh Provider Portal session/PWA.
5. Perform the production smoke test below.

## Production smoke test

1. Submit one customer request and confirm only **Request Received** is emailed during NEW → REVIEWING → READY_TO_ASSIGN.
2. Create a two-Provider Job. Confirm Provider 1 and verify no customer email. Confirm Provider 2 and verify exactly one **Service Confirmed** email.
3. Run ARRIVE → START → COMPLETE and verify Operations/Tracking update without routine customer emails.
4. Review the generated Draft invoice, change a final customer rate, save and verify Job / Service Request / Calendar show the final invoice amount.
5. SEND INVOICE and verify the customer receives the combined completion + invoice email with first-name greeting, PAY NOW and e-Transfer instructions.
6. Open the public invoice and verify the internal automation note and Stripe wording are absent.
7. Complete an online payment or manually confirm e-Transfer and verify Payment Confirmation.
8. Send the Review Request manually when desired.

