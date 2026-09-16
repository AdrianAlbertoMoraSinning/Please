# PLEASE — STEP 19.4 Regression Report

## Baseline

Protected baseline: `PLEASE_STEP19_3_1_Provider_Portal_Cleanup_FULL.zip`.

## Result

- Full automated Node test suite: **129 passed / 129 total**
- Failed: **0**
- Skipped: **0**
- Changed existing baseline files before release documentation: **4**
- New functional/test files before release documentation: **2**
- Deleted baseline files: **0**
- Node syntax validation for changed production JavaScript: **PASS**
- SQL migration required: **NO**

## STEP 19.4 acceptance coverage

Automated tests verify:

- Dashboard queries existing `DRAFT` invoices and counts them as an ACTION REQUIRED priority;
- Dashboard exposes **Invoices Ready to Issue** and links to `admin-invoices.html?status=DRAFT&action_required=1`;
- Invoice Center reads the deep-link status and action-required context;
- action queue opens filtered to DRAFT invoices;
- queue shows current DRAFT count and oldest invoices first;
- Invoice list exposes Job / Service while the existing invoice editor preserves full customer, lines, tax, totals and delivery controls;
- leaving DRAFT removes an invoice from the action queue on refresh/reload;
- Dashboard and Invoice Center entry points are cache-busted to STEP 19.4.

## Protected boundaries

STEP 19.4 does not change invoice creation, Operational Finance, customer invoice delivery, Stripe Checkout/webhook, payment accounting, Provider compensation, CAL, customer-notification rules, Provider assignment removal or Provider Portal cleanup.

## Production acceptance boundary

Local code/regression acceptance is complete. Production acceptance still requires Netlify deployment and a smoke test with at least one DRAFT invoice: verify Dashboard count, deep-link queue, invoice review, SEND INVOICE and counter decrement.
