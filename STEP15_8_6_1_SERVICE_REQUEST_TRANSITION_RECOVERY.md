# STEP 15.8.6.1 — Service Request Transition Recovery

## Problem reproduced
Administration could open a newly created `PLS-REQ` request, but changing it from NEW to REVIEWING / READY TO ASSIGN could surface a generic `Request failed` or HTTP 502. The public Book Your Service request itself was already stored correctly; the failure occurred in the protected Administration transition layer.

## Recovery implemented
- `START_REVIEW`, `READY_TO_ASSIGN`, and `CANCEL` no longer depend on the legacy `please_service_request_action` Supabase RPC.
- The authenticated Netlify function now enforces the same state machine directly with service-role REST updates.
- Transitions use an optimistic current-status guard so two administrators cannot silently overwrite each other.
- Duplicate clicks/retries remain idempotent.
- Status-history insertion remains best-effort audited; a history-write warning is logged without presenting a successful state change as failed.
- Resend remains non-blocking for the underlying business transition.
- `SAVE_NOTES` is handled as an internal-only update and no longer sends a customer email.
- Service Request drawer history/service-catalog queries are auxiliary and can degrade gracefully instead of collapsing the whole drawer.
- Browser errors now include the HTTP status (for example `HTTP 502`) instead of only `Request failed.`.
- If the state transition succeeds but the subsequent screen refresh fails, Administration is told that the request was updated successfully rather than being shown a false transaction failure.

## Database
No SQL migration is required. Existing `service_requests` and `service_request_status_history` tables are used unchanged.

## Deployment
Deploy the STEP 15.8.6.1 hotfix files and allow Netlify to publish the updated functions before retesting the existing request. Do not recreate a request solely because a prior administrative transition failed.
