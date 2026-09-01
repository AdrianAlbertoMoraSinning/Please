# STEP 15.8.6.3.1 — Unified Reassignment UI

## Problem corrected
STEP 15.8.6.3 made billing editable during NEEDS_ASSIGNMENT, but the drawer exposed two different assignment interfaces at the same time: the normal **Service Team & Provider Billing** card and a separate legacy **Provider / Schedule / Customer & Provider Billing** section. This was confusing and could make Administration select the Provider in one area while expecting the Rate Item to react in the other.

## Production behavior
When a Provider declines or an assignment is cancelled and the Job enters `NEEDS_ASSIGNMENT`:

- Administration selects **Assign** from Master Calendar > Needs Assignment.
- The drawer uses the same **Service Team & Provider Billing** card used by the original Create Job flow.
- The declined/cancelled Provider, original schedule, assignment message and billing snapshot are prefilled in that card.
- Administration can change Provider, date, start/end, Provider Service Rate Item, Qty, PLEASE Customer Rate and Provider Rate in one place.
- Changing Provider clears incompatible billing lines, exactly as in the original Job creation flow, and Administration selects the new Provider's Rate Item.
- The corrected assignment replaces only the declined/cancelled slot. The same `PLS-JOB` remains in use and the original team position / Primary flag is preserved.
- If the Job came from a Customer Service Request, the linked `PLS-REQ` reference and customer scheduling preference are shown when available.
- The extra legacy reassignment form remains hidden and is not used for submission.

## Financial integrity
Customer pricing and Provider compensation remain separate. Provider Rate overrides are still persisted only to the selected Provider Rate Item after a successful reassignment, while the Job keeps its own billing snapshot.

## Database
No SQL or Supabase schema migration is required.
