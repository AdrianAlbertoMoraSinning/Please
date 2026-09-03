# PLEASE STEP 15.9.2 — Unified Job Editing & Billing Confirmation

STEP 15.9.2 clarifies the operational difference between a Customer Service Request (`PLS-REQ-...`) and its Service Job (`PLS-JOB-...`) and gives PLEASE Administration one definitive place to change an active service after a Job exists.

## Operational rule

- The REQUEST remains the customer's original intake / tracking record.
- Once a REQUEST has been converted to a JOB, operational schedule and financial adjustments are made on the JOB.
- The linked REQUEST remains visibly related for audit and Customer Tracking.
- Editing a converted REQUEST cannot silently push stale requested time/hours back into the active JOB.

## Service Maintenance — Job editor

The active Job editor now exposes:

- Service Date
- Start Time
- End Time
- Total Hours
- Customer Rate by Job billing item
- Provider Cost / Rate by Job billing item
- Live Customer subtotal preview
- Live Provider cost preview
- Live PLEASE gross-margin preview
- Work Address, Work Description and Internal Notes

Start Time, End Time and Total Hours are validated together. Hourly billing quantities follow Total Hours when `Adjust hourly billing quantities` is enabled.

## Save confirmation

A successful save updates the active Provider schedule, linked REQUEST schedule, Job duration, hourly quantities and Job billing snapshot. The API returns the persisted Customer subtotal, Provider cost and PLEASE gross margin so Administration receives a financial confirmation rather than having to infer whether recalculation happened.

## Financial separation

Customer Rate and Provider Cost remain separate Job-level financial values. Updating a Provider Cost / Rate here changes the Job billing snapshot only; it does not overwrite the Provider's future master service-rate catalog.

## Database

No new SQL migration is required for STEP 15.9.2. It uses the existing STEP 15.9 / STEP 15.9.1 schema. Production databases still require the separate `providers.worker_type` schema repair if that column was missing.
