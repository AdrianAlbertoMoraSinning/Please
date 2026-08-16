# PLEASE Services — Web Portal Development

Current build includes:
- Public PLEASE website and Free Quote flow.
- Work With Us / Professional Network application workflow.
- Private Certification / Insurance / Portfolio uploads.
- Resend-ready transactional notification backend.
- PLEASE Admin Portal with custom authentication independent of Supabase Auth.
- Developer-only Provider Onboarding / Provisioning Portal.
- Provider draft, service assignment, weekly availability, custom provider credentials and activation workflow.
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
