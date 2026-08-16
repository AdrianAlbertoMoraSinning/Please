# PLEASE Services — Web Portal Development

Current build includes:
- Public PLEASE website and Free Quote flow.
- Work With Us / Professional Network application workflow.
- Private Certification / Insurance / Portfolio uploads.
- Resend-ready transactional notification backend.
- PLEASE Admin Portal with custom authentication independent of Supabase Auth.
- Developer-only Provider Onboarding / Provisioning Portal.
- Provider draft, service assignment, weekly availability, custom provider credentials and activation workflow.
- Optional public professional landing pages while keeping all customer contact through PLEASE.

## Restricted portals
- `admin-login.html` — PLEASE staff (`PLEASE_ADMIN`).
- `developer-login.html` — developer provisioning (`DEVELOPER_ADMIN`).

Both use the custom portal authentication/session architecture; neither login depends on Supabase Auth.

See `STEP3_1_CUSTOM_ADMIN_AUTH.md` and `STEP4_DEVELOPER_PORTAL.md`.
