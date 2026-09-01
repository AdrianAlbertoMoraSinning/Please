# STEP 15.8.6.2 — Gateway Timeout / Runtime Recovery

## Problem reproduced
Administration could show `Request failed (HTTP 502)` while:
- transitioning a valid Service Request,
- opening the Master Calendar assignment workflow, or
- creating/sending Provider assignments.

The 502 is a gateway/runtime symptom, not a customer-request validation error. The request record can already exist successfully while a later Netlify Function spends too long waiting on sequential Supabase/Resend calls or a post-transaction refresh.

## Changes
- Added bounded Supabase network calls in `_admin-lib.js` so stalled REST calls return a controlled timeout instead of running until the Netlify gateway terminates the function.
- Added a bounded Resend call in `_notify-lib.js` so email delivery cannot hold a business transaction indefinitely.
- Reworked `admin-calendar-data.js` so independent reads run in one parallel wave and optional failures return warnings instead of collapsing the whole calendar.
- Added `admin-assignment-form-data.js`, a lightweight independent catalog endpoint used by the Service Request assignment drawer.
- The assignment drawer can continue even when the background Master Calendar refresh fails.
- A Job that was successfully created is no longer reported as failed merely because the subsequent calendar refresh fails.
- Service Request audit-history writing and customer notification run in parallel after a successful state change.
- Multi-provider billing validation and post-create notification/audit work are parallelized.
- Request-to-Job linking no longer waits on the legacy link RPC before trying the supported direct relationship update.

## Database
No SQL migration is required.

## Verification
Run:

`node tests/step15_8_6_2_gateway_timeout_recovery.test.js`

and all prior STEP 15 tests.
