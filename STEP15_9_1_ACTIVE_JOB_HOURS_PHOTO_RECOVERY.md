# STEP 15.9.1 — Active Job Hours + Provider Photo Recovery

Production follow-up to STEP 15.9. This release addresses two client-reported operational gaps without reversing the STEP 15.9 controls.

## 1. Customer reduces or changes service hours after a Job exists

A Service Request that has already been converted to a `PLS-JOB` can no longer be treated as a detached intake record. Administration can now edit the active schedule/duration from three operational surfaces:

- **Master Calendar** → open a PENDING/CONFIRMED Provider assignment → **EDIT SERVICE SCHEDULE & HOURS**.
- **Service Requests** → for an ASSIGNED request, Date / Time / Estimated Hours / Address / Work Description synchronize the related Job when saved.
- **Service Maintenance** → edit the Service Request or the Job directly. A request that already has a Job clearly states that the related Job will be synchronized.

The controlled backend mutation updates the selected active Provider or all active Providers on the same Job, recalculates the Job duration, and can synchronize hourly billing quantities. Customer rates and Provider rates are not replaced; only the quantity and calculated line totals are changed for hourly items. The Job subtotal is recalculated.

If service work has already STARTED, Administration may adjust the end time / remaining duration but cannot move that Provider's recorded start time. COMPLETED/CANCELLED Jobs are protected from rescheduling.

Provider schedule-update emails are sent to affected Providers. The customer receives one generic schedule update that does not expose pending Provider identities. The linked `PLS-REQ` schedule is kept synchronized for Customer Tracking/audit purposes.

## 2. Provider photo upload recovery

The official evidence flow now performs a server-side readiness check **before** opening the camera or gallery. The Provider therefore receives an actionable reason instead of taking a photo and discovering afterwards that the lifecycle step is not allowed.

Examples include:

- `TOO_EARLY` — shows the time Check In / I've Arrived becomes available.
- `ASSIGNMENT_NOT_CONFIRMED` — assignment must be confirmed first.
- `TEAM_NOT_READY` — the complete service team is not yet ready.
- `CHECK_IN_REQUIRED` — PLEASE Staff must Check In before I've Arrived.
- `START_REQUIRED` — START SERVICE must occur before Completion evidence.
- `EVIDENCE_SCHEMA_NOT_READY` / `LIVE_SERVICE_SCHEMA_NOT_READY` — the STEP 15.9 database migration is not active in production.
- `STORAGE_NOT_READY` — secure photo storage is unavailable.

For supported JPG/PNG/WEBP images already within the safe upload size, the Provider Portal uploads the original file directly and avoids unnecessary browser canvas decoding. Larger compatible phone images are converted/optimized below the gateway limit. HEIC/HEIF still receives a clear fallback if that device/browser cannot decode it.

The four-photo rule remains unchanged:

**PLEASE Staff:** CHECK IN + photo → I'VE ARRIVED + photo → START → COMPLETED + photo → CHECK OUT + photo.

**Independent Provider:** I'VE ARRIVED + photo → START → COMPLETED + photo.

CHECK IN / CHECK OUT remain internal operational evidence and are not exposed on public Customer Tracking.

## Database deployment

**No new SQL migration is required for STEP 15.9.1.**

STEP 15.9.1 assumes `supabase/STEP15_9_CLIENT_OPERATIONS_CONTROL.sql` was already applied when STEP 15.9 was deployed. If the Provider Portal reports `EVIDENCE_SCHEMA_NOT_READY` or `LIVE_SERVICE_SCHEMA_NOT_READY`, re-run that existing STEP 15.9 migration in Supabase before repeating the photo test.

## Recommended production verification

1. Open an existing active Job with an hourly item and change 4.00 hours to 2.00 hours from Master Calendar or the linked Service Request.
2. Verify every selected active Provider's end time moves to the new end time.
3. Verify hourly billing Qty changes to 2.00 while the Customer Rate and Provider Rate remain unchanged.
4. Verify the linked `PLS-REQ` reflects the new date/time/hours.
5. On a CONFIRMED PLEASE Staff assignment within two hours of start, choose CHECK IN. The readiness check should pass before the camera/gallery opens.
6. Test TAKE PHOTO and CHOOSE FROM DEVICE with a normal phone JPG/PNG/WEBP.
7. Continue I'VE ARRIVED → START → COMPLETED → CHECK OUT and verify all four staff evidence steps are recorded.
