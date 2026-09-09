# STEP 19 — Regression & Release Report

Baseline: **STEP 18.12.1 — Regression & Acceptance**

## Release result

- Full retained + STEP 19 Node regression suite: **97 / 97 PASS**
- JavaScript syntax checks on changed/new operational modules: **PASS**
- Baseline files: **643**
- Byte-identical baseline files retained: **601**
- Existing files intentionally evolved: **42** (includes regression tests adapted to authorized STEP 19 behavior)
- New files before release-report packaging: **16**
- Baseline files deleted: **0**
- Database live verification: **PENDING DEPLOYMENT** — run `supabase/STEP19_VERIFY.sql` after the migration and require **20 PASS / 0 FAIL**.
- Manual production smoke: **PENDING DEPLOYMENT** — required after Netlify publishes.

## Authorized STEP 19 changes covered by tests

1. One Daily Check In / Daily Check Out per Edmonton workday for PLEASE Staff; per-service Arrive/Start/Complete retained.
2. Independent Provider workflow remains separate.
3. Photo preparation below gateway limits, compact retry for HTTP 413, timeout/retry and single-flight UI protection.
4. Completion refresh recovery so a successful server completion is not repeated because of a stale screen.
5. Editable Service Type / classification in Service Maintenance with linked Request/Job synchronization and inactive-history protection.
6. Obsolete free-form Pay Now no longer launches Outlook; tracked Stripe/invoice payment path remains protected.
7. Admin Finance provides Sales & Collections, Expenses, Purchases & Payables, Payments, Bank & Cash, Exceptions and Automation Status without daily GL/debit-credit input.
8. Completed Job durable/idempotent queue creates at most one DRAFT invoice from frozen billing; safe defaults keep Auto-Issue and Auto-Email OFF.
9. Cash variance becomes a Finance Exception rather than an invented journal.
10. STEP 17/18 accounting engine, CAL, public Home, Booking, Tracking, Stripe and protected operations remain regression-gated.

## Final local acceptance

`node --test tests/*.test.js`

**97 tests · 97 pass · 0 fail · 0 skipped**

This local acceptance validates source/runtime-unit contracts available in the release package. It does not substitute for the Supabase verification query or the post-deployment mobile/Stripe smoke checks that require production services.
