# PLEASE Services — Web Portal Development

Current build includes:
- Public PLEASE website and Free Quote flow.
- Work With Us / Professional Network application workflow.
- Private Certification / Insurance / Portfolio uploads.
- Resend-ready transactional notification backend.
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
