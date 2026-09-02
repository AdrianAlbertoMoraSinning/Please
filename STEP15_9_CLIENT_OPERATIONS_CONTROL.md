# STEP 15.9 — Client Operations Control

Baseline: **STEP 15.8.6.3.2 — Multi-Provider Reassignment**.

This release implements the client adjustments received September 1, 2026 without removing the approved PLS-REQ/PLS-JOB separation, confirmed-only Customer Tracking Provider visibility, multi-Provider assignment/reassignment, financial separation, direct mobile camera normalization, or centralized Resend notification routing.

## Administration changes

1. **Service Requests drawer** uses approximately 50% of desktop width, keeps mobile full-width, displays the structured service address, and lets Administration edit service, preferred date/time, estimated hours, flexibility, address, drop-off, description and customer notes before creating a Job.
2. **Customers** is a new Customer Master. Service Request intake links/creates a Customer using normalized email first and phone second. Returning public intake can fill blank Master fields but cannot overwrite established Customer Master data. Administration can deliberately edit the Customer Master and review related Service Requests and Jobs.
3. Provider **CONFIRM / DECLINE** responses continue to send an Administration notification. Declines remain internal and are not disclosed to the customer.
4. **Dashboard** is the first Administration option and summarizes New Requests, Ready to Assign, Needs Assignment, pending Provider responses, pending schedule changes, applications, today operations, active Providers and the next seven days.
5. Master Calendar Provider rows no longer print the full authorized-service list under each Provider name.
6. Master Calendar supports **WEEK / MONTH**. Month view shows the number of unique services per day plus pending / confirmed / completed assignment counts. Selecting a date opens that week.
7. **Providers > View > Service Rates** lets Administration create/edit/deactivate the selected Provider's authorized service-rate records. Provider compensation remains separate from Customer pricing and historical Job snapshots.
8. Worker Type has exactly **Independent Provider** and **PLEASE Staff**. Administration writes and immediately verifies the persisted value and records technical history.
9. **PLEASE Staff** requires four ordered evidence photos: `CHECK IN` → `I'VE ARRIVED` → `COMPLETED` → `CHECK OUT`. Independent Providers retain the standard arrival/completion evidence workflow. Check In/Check Out evidence is operational/internal and is not exposed by public Customer Tracking.
10. **Service Maintenance** lets Administration search/edit/delete Service Requests and Jobs. DELETE requires explicit confirmation and a reason. The database snapshots the deleted record in `admin_service_maintenance_audit` before deletion.
11. The **Provider User Manual** is updated for Worker Type, four-photo PLEASE Staff flow, direct camera use, multi-Provider work, schedule changes, rates, documents and troubleshooting.

## Database migration

Run **`supabase/STEP15_9_CLIENT_OPERATIONS_CONTROL.sql` before uploading the application files**. The migration adds Customer Master linkage/normalization, structured Service Request fields used by the new UI, PLEASE Staff evidence/event types, the server-side four-photo lifecycle, and Service Maintenance audit/delete support.

## Deployment order

1. Supabase SQL Editor: run `supabase/STEP15_9_CLIENT_OPERATIONS_CONTROL.sql` and confirm success.
2. Upload the STEP 15.9 changed files to GitHub, preserving paths.
3. Wait for Netlify to show **Published**.
4. Hard refresh Administration (`Ctrl+F5`).
5. On Provider mobile/PWA, close/reopen or refresh so `please-provider-v15-9` replaces the previous cache.

## Production checks

- Open a Service Request and confirm the 50% desktop drawer, address and editable date/time.
- Submit a new request for a known email and confirm the Customer Master links it without overwriting established Master fields.
- Confirm and decline test assignments and verify Administration email receipt.
- Verify Dashboard counts/links.
- Toggle Master Calendar WEEK/MONTH and verify daily service counts.
- Edit a Provider Rate from Administration and confirm it appears in the Provider portal without rewriting historical Job billing snapshots.
- Change Worker Type both directions and reload to verify persistence.
- For PLEASE Staff, test all four photos in order; for Independent Provider, verify Check In/Check Out are not required.
- Confirm public Customer Tracking shows only ARRIVAL/COMPLETION evidence and confirmed/completed Providers.
- In Service Maintenance, test EDIT and a disposable DELETE record with confirmation/audit.
