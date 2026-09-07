# STEP 18.4.1 — Expense UI & Posting Guardrails

Purpose: correct the Advanced Expenses KPI layout and tighten posting selections without changing accounting history or operational PLEASE flows.

## Fixes
- KPI cards now use CAL's standard label/value/note structure, eliminating inline overlap.
- KPI cards wrap safely on desktop/tablet/mobile.
- Vendor selector is limited to Business Partners with the SUPPLIER role; receipt-only merchants remain available through "Not in master / receipt only".
- Company-paid/reimbursement financial accounts are limited to BANK, CASH and CREDIT_CARD. Stripe Clearing, loans and other non-payment identities are not offered.
- EXPENSE lines may use Expense GL accounts only.
- PREPAID lines may use the Prepaid Expenses account only.
- FIXED_ASSET lines may use the Fixed Asset account only.
- INVENTORY is visibly deferred to STEP 18.6 Inventory Accounting and is rejected server-side in STEP 18.4.
- Server-side validation mirrors the UI restrictions so a crafted request cannot bypass the controls.

## No data migration
No Supabase SQL is required. No existing expense, payment, journal, invoice, supplier bill, provider payment or Stripe record is changed.

## Validation
- 36/36 test files PASS.
- 226/226 JavaScript files pass syntax validation.
- 135/135 internal Netlify require() dependencies resolve.
- 15 CAL HTML pages / 352 local references validated; 0 missing references and 0 duplicate IDs.
- 9 KPI grids audited; 0 malformed KPI cards remain.
- Protected PLEASE and CAL modules remain byte-identical to STEP 18.4 baseline.
