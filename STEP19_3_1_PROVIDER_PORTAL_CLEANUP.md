# PLEASE — STEP 19.3.1 Provider Portal Cleanup

## Purpose

Client clarification: a Provider assignment that is `DECLINED` or `CANCELLED` must not continue to appear anywhere in that Provider's portal. Administration must still retain the complete audit trail.

## Final behavior

Provider Portal shows only assignments that remain operationally relevant to the Provider:

- `PENDING` / `CONFIRMED` → Assignments / Overview / Calendar as applicable;
- `COMPLETED` → Service History;
- `DECLINED` / `CANCELLED` → not shown anywhere in Provider Portal.

The cleanup also applies to the Provider CSV export.

The Provider Dashboard API suppresses declined/cancelled assignment payloads and their related schedule-change, extension and service-event payloads before returning data to the Provider browser.

## Administration / audit

Nothing is deleted from the database. Administration continues to show the assignment with its final status and retains assignment status history and Provider technical history. STEP 19.3 removal safeguards remain unchanged.

## Cache

Provider JavaScript cache-bust is `19.3.1` and the Provider service-worker cache advances to `please-provider-v21` so phones/PWA clients pick up the correction.

## Database

No SQL migration is required.

## Production smoke

1. Use a Provider that has a declined or safely removed/cancelled assignment.
2. Refresh/reopen the Provider PWA.
3. Confirm the Job is absent from Overview, Assignments, My Calendar and Service History.
4. Export Provider CSV and confirm the Job is absent.
5. Open Administration → Jobs and confirm the cancelled/declined assignment and audit history remain visible.
