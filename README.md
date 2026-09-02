# PLEASE Services — Web Portal Development

Current build includes:
- Public PLEASE website and Free Quote flow.
- Work With Us / Professional Network application workflow.
- Private Certification / Insurance / Portfolio uploads.
- Production Resend transactional notification backend with centralized Customer / Provider / Administration / Developer routing.
- PLEASE favicon / app icon package applied across all public and restricted HTML pages.
- PLEASE Admin Portal with custom authentication independent of Supabase Auth.
- Developer-only Provider Onboarding / Provisioning Portal.
- Provider draft, service assignment, weekly availability, custom provider credentials and activation workflow.
- Provider service-rate catalog with explicit Fixed CAD / Percentage compensation methods and live PLEASE margin calculations.
- PLEASE Master Calendar with provider availability, conflict protection, job creation, assignment and reassignment queue.
- Optional public professional landing pages while keeping all customer contact through PLEASE.
- Provider response draft protection and decline/reassignment workflow.


- Provider Portal with custom authentication, availability management, assignment confirmation/decline and service history.

## Restricted portals
- `admin-login.html` — PLEASE staff (`PLEASE_ADMIN`).
- `developer-login.html` — developer provisioning (`DEVELOPER_ADMIN`).

Both use the custom portal authentication/session architecture; neither login depends on Supabase Auth.

See `STEP3_1_CUSTOM_ADMIN_AUTH.md` and `STEP4_DEVELOPER_PORTAL.md`.

## Provider access

- `provider-login.html` — activated service providers.
- Provider access uses custom hashed credentials and separate secure sessions; it does not use Supabase Auth.

See `STEP5_PROVIDER_PORTAL.md`.

## STEP 7 — Jobs Management + Service History + Reports

STEP 7 adds `admin-jobs.html`, `admin-reports.html`, complete job lifecycle history, admin completion/cancellation controls, provider/service operational metrics, and CSV/XLSX exports. Run `supabase/STEP7_JOBS_HISTORY_REPORTS.sql` before deploying the STEP 7 package.

## STEP 7.3
Reporting accuracy and lifecycle visual cleanup are documented in `STEP7_3_REPORTING_ACCURACY_LIFECYCLE_CLEANUP.md`.

## STEP 8 — Invoices + Payments

STEP 8 activates the existing billing foundation with `admin-invoices.html`, customer invoice pages, GST calculations, manual payment tracking and Stripe-ready hosted Checkout. Run `supabase/STEP8_INVOICES_PAYMENTS.sql` before testing. Online card payments remain disabled until `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are configured in Netlify.


## STEP 8.1
Customer billing is now captured at Job creation and automatically prefills completed-Job invoices. See `STEP8_1_JOB_BILLING_INVOICE_PREFILL.md`.

## STEP 8.2 — Provider Rates + Multi-Item Billing + Schedule Change Requests

STEP 8.2 replaces the one-rate-per-Job model for new Jobs. Providers maintain multiple Service Rates across all services assigned to their profile; PLEASE can combine any of that Provider's active rates into one Job Customer Billing detail and one final invoice. Providers can also propose date/time changes for pending or confirmed assignments; PLEASE Administration must accept the change before the calendar is updated. Historical STEP 8.1 Jobs and invoices remain intact.

Run `supabase/STEP8_2_PROVIDER_RATES_MULTI_ITEM_SCHEDULE_CHANGES.sql` before deploying the STEP 8.2 application files. See `STEP8_2_PROVIDER_RATES_MULTI_ITEM_SCHEDULE_CHANGES.md` and `UPLOAD_ONLY_STEP8_2.txt`.

## STEP 8.3 — Financial Separation + Provider Payments

The portal now keeps Customer Revenue, Provider Cost and PLEASE Gross Profit as separate financial values. Customer invoices use only PLEASE customer pricing. Completed Jobs automatically create a manual Provider Payment obligation that Administration can mark Paid after PLEASE pays the Provider externally. Provider Payments and financial reports support CSV/XLSX reporting.


## STEP 8.3.1 testing patch

- Customer Billing rate fields support normal direct keyboard entry without losing focus.
- Reports always leave the secure-session loading screen and degrade gracefully if an optional dataset fails.

## STEP 9 — Portal UI consolidation

The current build includes a visual-only consolidation pass across Admin, Developer and Provider portals: consistent cards/forms/tables/drawers, improved schedule-change presentation, responsive portal navigation and mobile layouts, loading-overlay cleanup, accessibility focus states and financial-module visual consistency. No database or workflow changes are introduced by STEP 9.

## STEP 10 — Customer Service Request Flow

STEP 10.1/10.2 adds the public `service-request.html` customer intake and the protected `admin-service-requests.html` PLEASE queue. Customer requests remain separate from Jobs until PLEASE reviews them; STEP 10.3 will convert a READY TO ASSIGN request into the existing Job Assignment workflow.


## STEP 10.3 — Convert Request to Job & Assign

READY TO ASSIGN customer Service Requests can now be converted directly into the existing Master Calendar Job/Provider assignment workflow with customer and preference prefill. The originating request is linked one-to-one to the created Job and transitions to ASSIGNED only after the Job has been created.

## STEP 10.4 — Customer Tracking

Customers now receive a secure tracking link after submitting a Service Request. The public tracking page follows the request through PLEASE review, scheduling/provider confirmation, service completion and invoice/payment availability without exposing internal notes, Provider compensation or PLEASE profitability. No new SQL migration is required because STEP 10.1 already stores only the SHA-256 tracking-token hash.

## STEP 10.4.3 — Tracking recovery

Customer Tracking now supports both secure-link access and recovery through Request Reference + Email. PLEASE Administration can generate additional customer-safe tracking links without invalidating prior links. Run `supabase/STEP10_4_3_TRACKING_RECOVERY.sql` before deploying the STEP 10.4.3 files.

## STEP 10.6 — Initial Tracking Email

A newly submitted Customer Service Request now triggers a best-effort server-side Resend confirmation email containing the `PLS-REQ-...` reference and secure tracking link. Email credentials remain in Netlify environment variables only. Request creation never depends on email delivery success.

## STEP 15.8.3 — Provider team status in Administration Jobs

Administration > Jobs now shows the complete Provider team directly in the **Provider** column. Each assigned Provider is listed by name with the current individual assignment status, while the Primary Provider remains identified. Public Customer Tracking is unchanged and continues to expose only confirmed/completed Providers. See `STEP15_8_3_PROVIDER_TEAM_STATUS_COLUMN.md`. No SQL migration is required.

## STEP 15.8.4 — Public booking runtime recovery

The Book Your Service flow now uses the fresh `public-booking` Netlify endpoint. Public service catalog loading no longer depends on notification/security helper module initialization; POST security is loaded only when required, and admin notification is non-blocking after the request is saved. No database migration is required.


## STEP 15.8.5 — Direct Mobile Camera & Photo Normalization
Provider camera photos for live evidence, service portfolio and profile are now normalized client-side to optimized JPEG before upload, removing the normal need to save a camera photo to the phone gallery and re-select it. No database migration is required.

## STEP 15.8.6 — Booking, Tracking Relationship, Calendar Recovery & Provider Rate Editing
Book Your Service is now more compact and no longer requests Moving-specific bedrooms/square-footage/inventory. Administration can locate a service using either the customer's `PLS-REQ` tracking reference or the internal `PLS-JOB` reference. Master Calendar data loading has compatibility fallbacks to prevent optional query/schema differences from producing a generic 502. During Job creation, PLEASE Administration may edit the Provider Rate for a selected Rate Item; after a successful assignment that value is saved to the corresponding Provider profile while the Job keeps its own frozen financial snapshot. No new SQL migration is required. See `STEP15_8_6_CLIENT_ADJUSTMENTS_BOOKING_TRACKING_RATES.md`.

## STEP 15.8.6.1 — Service Request Transition Recovery
Administration Service Request state changes (`START REVIEW`, `READY TO ASSIGN`, `CANCEL`) now execute directly through the authenticated Netlify backend instead of depending on the legacy transition RPC. Duplicate/retried actions are idempotent, concurrent admin updates are guarded, auxiliary drawer queries degrade gracefully, and a successful state change is no longer reported as failed merely because a subsequent screen refresh or email delivery has a problem. Internal note saves do not email the customer. No SQL migration is required. See `STEP15_8_6_1_SERVICE_REQUEST_TRANSITION_RECOVERY.md`.

## STEP 15.8.6.2 — Administration 502 runtime recovery
This release bounds Supabase/Resend network waits, parallelizes Master Calendar and multi-provider reads, gives the assignment drawer its own lightweight catalog endpoint, and separates successful Job creation from a later calendar-refresh failure. No SQL migration is required. See `STEP15_8_6_2_GATEWAY_TIMEOUT_RUNTIME_RECOVERY.md`.

## STEP 15.8.6.3 — Editable Billing on Reassignment
Jobs in NEEDS_ASSIGNMENT can now be corrected and reassigned without creating a duplicate Job. Administration can edit Provider, schedule, quantity, PLEASE Customer Rate and Provider Rate; the corrected billing snapshot replaces only the declined/cancelled assignment rows, while Provider Rate overrides continue to persist to that Provider Rate Item with audit history. No SQL migration is required.

## STEP 15.8.6.3.1 — Unified Reassignment UI
The NEEDS_ASSIGNMENT correction drawer now reuses the same **Service Team & Provider Billing** card used when a Job is created for the first time. The rejected/cancelled Provider slot, schedule and billing snapshot are prefilled in that single card; Administration can change Provider, Rate Item, Qty, PLEASE Customer Rate, Provider Rate and schedule without a second legacy Provider/Billing section. The replacement still updates the same PLS-JOB and preserves the original team position/Primary flag. Linked PLS-REQ information is shown again when available. No SQL migration is required.

## STEP 15.8.6.3.2 — Multi-Provider Reassignment
`Correct & Reassign` now has the same multi-Provider team builder used by original Job creation. Administration can correct the declined/cancelled Provider slot and use **+ ADD ANOTHER PROVIDER** to add one or more additional Providers without creating a second `PLS-JOB`. The replacement keeps the failed slot's Primary/team position; additional Providers receive their own schedule, Rate Item, Qty, PLEASE Customer Rate, Provider Rate, billing snapshot and independent PENDING assignment. Existing confirmed/completed team members are preserved. The Job's `required_provider_count`, subtotal and duration are synchronized to the resulting active team. Duplicate Providers, unavailable schedules and overlapping active assignments are rejected server-side. No SQL migration is required. See `STEP15_8_6_3_2_MULTI_PROVIDER_REASSIGNMENT.md`.

## STEP 15.9 — Client Operations Control
Administration now includes a prioritized Dashboard, Customer Master, Service Maintenance, editable Service Request qualification/schedule/location, Administration-managed Provider Service Rates, verified Worker Type changes, and a WEEK/MONTH Master Calendar with daily service counts. Provider rows are visually compact. **PLEASE Staff** uses a mandatory four-photo lifecycle (`CHECK IN` → `I'VE ARRIVED` → `COMPLETED` → `CHECK OUT`), while **Independent Provider** retains the standard arrival/completion evidence flow. Public Customer Tracking continues to expose only confirmed/completed Providers and ARRIVAL/COMPLETION evidence. Run `supabase/STEP15_9_CLIENT_OPERATIONS_CONTROL.sql` before deploying the STEP 15.9 application files. See `STEP15_9_CLIENT_OPERATIONS_CONTROL.md`.


## STEP 15.9.1 — Active Job Hours + Provider Photo Recovery
Administration can now change an active Job's date, start time and service hours after the `PLS-JOB` has been created, from Master Calendar, linked Service Requests or Service Maintenance. The controlled mutation synchronizes active Provider schedules, Job duration, linked request schedule and optional hourly billing quantities/totals while preserving Customer Rate and Provider Rate values. Provider evidence now performs a server-side lifecycle readiness check before camera/gallery selection and returns explicit timing/status/schema/storage recovery messages. Safe JPG/PNG/WEBP evidence can upload directly; larger compatible phone images are optimized for the gateway. **No new SQL migration is required** beyond the already-required STEP 15.9 migration. See `STEP15_9_1_ACTIVE_JOB_HOURS_PHOTO_RECOVERY.md`.
