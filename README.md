# PLEASE Services — Web Portal Development

Current build includes:

- Public PLEASE website and Free Quote flow.
- Work With Us / Professional Network application workflow.
- Private Certification / Insurance / Portfolio uploads.
- Resend-ready transactional notification backend.
- PLEASE Administration portal for Professional Applications.
- **Custom administrator authentication independent of Supabase Auth.**

## Admin login architecture

`admin-login.html` calls a Netlify Function. Credentials are verified server-side against `admin_portal_users`, where only a password hash is stored. Successful login creates an HttpOnly secure session cookie backed by `admin_portal_sessions`.

The admin browser does not receive the Supabase secret key and does not call Supabase Auth.

See `STEP3_1_CUSTOM_ADMIN_AUTH.md` for installation steps.

## Legacy agenda

The original `modules/agenda/` Google Apps Script prototype remains in the repository only as legacy source material. It is not the target architecture for the new multi-provider PLEASE portal and will be replaced as development proceeds.
