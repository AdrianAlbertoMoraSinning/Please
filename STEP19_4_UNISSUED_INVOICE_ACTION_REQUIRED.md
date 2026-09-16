# PLEASE — STEP 19.4 · Unissued Invoice Action Required

## Objective

Make every unissued customer invoice visible as an Administration priority so a completed service cannot quietly remain in DRAFT without commercial follow-up.

## Dashboard

`Administration → Dashboard → ACTION REQUIRED` now includes:

**Invoices Ready to Issue**

The counter is the number of invoices whose status is `DRAFT`. A DRAFT invoice is the operational state used by PLEASE while Administration reviews the final customer amount before issue/delivery.

The card links directly to:

`admin-invoices.html?status=DRAFT&action_required=1`

The count falls automatically after an invoice is issued/sent because it no longer has DRAFT status.

## Action-required Invoice queue

The existing Invoice Center remains the source of truth. STEP 19.4 does not create a second billing module.

When entered from the Dashboard, the Invoice Center:

- opens with `DRAFT` selected;
- displays the **ACTION REQUIRED · Invoices Ready to Issue** context panel;
- shows the current number of DRAFT invoices;
- lists the oldest DRAFT invoices first;
- shows Invoice, Customer, Job / Service, Date, Total, Payment and Status;
- allows Administration to open the full invoice editor for Customer, contact details, dates, GST, invoice items, rates, notes and totals;
- retains `SAVE DRAFT`, `ISSUE ONLY` and `SEND INVOICE` actions.

If all DRAFT invoices are resolved, the queue reports that no draft invoices are waiting to be issued.

## Scope boundaries

STEP 19.4 does not change:

- invoice creation rules;
- STEP 19 Operational Finance automation;
- invoice accounting/posting;
- Stripe Checkout or webhook processing;
- e-Transfer confirmation;
- Provider compensation;
- CAL / STEP 17 / STEP 18 accounting;
- customer notification rules from STEP 19.2;
- Provider Assignment Removal / Provider Portal Cleanup from STEP 19.3 / 19.3.1.

## Database

No SQL migration is required. The Dashboard reads the existing `invoices` table using `status = DRAFT`.

## Production smoke test

1. Confirm at least one DRAFT invoice exists.
2. Open Administration Dashboard and verify **Invoices Ready to Issue** equals the DRAFT count in Invoices.
3. Click the priority card and verify the Invoice Center opens filtered to DRAFT with the ACTION REQUIRED panel.
4. Open a DRAFT invoice and confirm Job/Service, customer information, invoice lines and total are available.
5. Issue or SEND INVOICE.
6. Return to Dashboard / Refresh and verify the counter decreases by one.
7. Confirm issued/sent invoice is no longer shown in the DRAFT action queue.
