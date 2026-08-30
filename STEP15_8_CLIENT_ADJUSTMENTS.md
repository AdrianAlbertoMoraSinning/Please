# STEP 15.8 — Client Adjustments (2026-08-30)

Implemented on top of STEP 15.7 without changing the database schema.

## Provider assignment email
- Assignment emails contain an **OPEN PROVIDER PORTAL** button.
- The secure login preserves `next=assignments`, so after login the Provider lands directly on Assignments.
- The legacy fallback notifier uses the same direct link.
- No password is ever sent by email.

## Administration — exact pending Provider
- `PENDING PROVIDER` remains the internal Job status.
- The Jobs table adds `Waiting: <Provider name>` from real PENDING assignment rows.
- The Job drawer also lists every Provider still waiting for confirmation.

## Customer tracking privacy
- Public tracking exposes only assignments with status `CONFIRMED` or `COMPLETED`.
- PENDING / DECLINED / CANCELLED Provider identities are never returned to the customer tracking UI.
- If one Pleaser is confirmed and another is pending, only the confirmed Pleaser is shown.
- If none are confirmed, no Pleaser is shown.
- Internal `PENDING_PROVIDER` is translated to the generic customer status `Scheduling service`.
- Customer timeline language does not disclose `Provider assignment created`.
- Provider declines notify Administration only; customer identity/state is not exposed.

## PLS-REQ vs PLS-JOB clarity
- Public tracking labels `PLS-REQ` as **Customer Tracking Reference**.
- `PLS-JOB` is labeled **Service Job Reference**.
- Jobs Administration shows the linked Customer Tracking Reference and can open secure customer tracking directly.

## BOOK YOUR SERVICE
- Home hero adds **BOOK YOUR SERVICE** next to CALL US.
- Uses the existing `service_requests` workflow; no parallel database/table.
- Form captures service, first/last name, email, phone, work description, service/pick-up address, optional drop-off, date, time, estimated hours, flexibility, and Moving details when applicable.
- Drop-off and estimated hours are stored as structured customer notes to avoid a database migration.
- Administration displays those values explicitly.
- When converting the Request to a Job, estimated hours set the initial end-time default and drop-off is carried into the Job description.

## No database migration
STEP 15.8 uses the existing schema and can be deployed through GitHub/Netlify without running new SQL.
