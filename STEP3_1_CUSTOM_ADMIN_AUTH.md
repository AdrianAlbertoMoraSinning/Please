# STEP 3.1 — Custom PLEASE Admin Authentication

This revision deliberately removes Supabase Auth from the PLEASE administrative login.

## Why

The public/provider architecture may still use Supabase Auth later, but the PLEASE administration login now uses a dedicated `admin_portal_users` table and a server-side session so that normal admin sign-in is not dependent on Supabase Auth sign-in rate limits.

## Security model

- The password is never stored in plaintext. PostgreSQL `pgcrypto` stores a bcrypt-compatible hash in `admin_portal_users.password_hash`.
- The browser never reads `admin_portal_users`, `admin_portal_sessions`, or the Supabase secret key.
- Login is handled by `/.netlify/functions/admin-login`.
- A successful login creates a random opaque session token. Only its SHA-256 hash is stored in `admin_portal_sessions`.
- The browser receives the token only in an `HttpOnly; Secure; SameSite=Strict` cookie.
- Sessions expire after 12 hours.
- Failed logins are audited but this implementation intentionally does **not** automatically lock the account after one or two mistakes.
- Administrative data/actions are served through Netlify Functions using the existing `PLEASE_SUPABASE_SECRET_KEY` on the server.
- PLEASE Admin can review, decline, and refer applications but cannot create/activate providers.

## Install order

1. In Supabase SQL Editor run `supabase/STEP3_1_CUSTOM_ADMIN_AUTH.sql`.
2. Open `supabase/STEP3_1_CREATE_INITIAL_ADMIN.sql`.
3. Replace `REPLACE_WITH_A_STRONG_PASSWORD` with the password you want for `please.serviceinfo@gmail.com` and run it.
4. Do **not** commit the edited password to GitHub. The ZIP contains only the placeholder.
5. Upload the remaining project files to GitHub and allow Netlify to deploy.
6. Netlify should deploy the existing functions plus these admin functions:
   - `admin-login`
   - `admin-session`
   - `admin-logout`
   - `admin-applications`
   - `admin-application-action`
   - `admin-document-url`
   - `admin-change-password`
7. Open `/admin-login.html` and sign in using the custom portal password, not Supabase Auth.

## Existing Supabase Auth accounts

The Auth users created in Step 1 can remain in Supabase. This admin portal simply does not use `supabase.auth.signInWithPassword()` anymore. They can remain available for future provider/developer architecture if needed.

## Password reset

Until transactional email/Resend is activated, a forgotten admin password is reset by the developer by re-running `admin_portal_upsert_user(...)` from Supabase SQL Editor. The database stores only the resulting hash.

Once Resend is active, a custom reset-token workflow can be added without reintroducing Supabase Auth.
