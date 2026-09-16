# PLEASE — STEP 19.5 Regression Report

## Baseline

Protected baseline: `PLEASE_STEP19_4_Unissued_Invoice_Action_Required_FULL.zip`.

## Result

- Full automated Node test suite: **136 passed / 136 total**
- Failed: **0**
- Skipped: **0**
- Changed existing baseline files before release manifest/list: **21**
- New functional/test/documentation files before release manifest/list: **5**
- Deleted baseline files: **0**
- Node syntax validation for changed production JavaScript: **PASS**
- SQL migration required: **NO**
- Production deployment performed by this build: **NO**

## STEP 19.5 acceptance coverage

Automated regression verifies:

- Administrator User Manual is available from the Administration sidebar and documents lifecycle editing boundaries;
- Provider manual explains replacement and DECLINED/CANCELLED visibility behavior;
- Customer Master can launch a new service with customer/address data prefilled, avoiding customer re-entry;
- Jobs can launch Service Maintenance directly and start a follow-up service for the same customer;
- PENDING/CONFIRMED Provider assignments expose CHANGE PROVIDER and use the existing guarded removal + same-Job Correct & Reassign flow;
- Master Calendar supports `reassign_job` and `new_customer_service` deep links;
- unassigned READY TO ASSIGN Requests can jump from Service Maintenance into assignment;
- active Job Service Type changes validate every active Provider is authorized for the target service;
- completed/cancelled Jobs are treated as historical in Service Maintenance and final customer rate review is routed to Invoices;
- all prior STEP 15–19.4 tests remain passing.

## Protected boundaries

STEP 19.5 does not replace Stripe Checkout/webhook, Operational Finance, CAL, invoice delivery, Provider evidence lifecycle, Provider Payment accounting, or the STEP 19.3 removal safeguards. Completed execution history remains protected.

## Production acceptance boundary

Local code/regression acceptance is complete. Production acceptance still requires Netlify deployment and smoke tests for:

1. Customer → `+ NEW SERVICE FOR THIS CUSTOMER` → prefilled Master Calendar;
2. active Job → `EDIT SERVICE` → Service Maintenance save;
3. active Provider → `CHANGE PROVIDER` → Correct & Reassign same Job;
4. completed Job → historical review → Invoice rate review;
5. Administrator and Provider manuals on desktop/mobile.
