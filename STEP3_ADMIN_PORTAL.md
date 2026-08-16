# STEP 3 — PLEASE Administration Portal

This step introduces the first secure PLEASE-only portal screen: **Professional Applications**.

## Included

- `admin-login.html` — email/password login through Supabase Auth.
- `admin-reset-password.html` — password recovery completion page.
- `admin.html` — PLEASE Admin dashboard for Work With Us applications.
- `js/admin-login.js`
- `js/admin-reset-password.js`
- `js/admin-applications.js`
- `supabase/STEP3_ADMIN_PORTAL.sql` — hardens application updates and adds the notes RPC.

## Security model

The browser uses only the Supabase publishable key. Supabase Auth establishes the user session. The dashboard then checks the authenticated user's `user_roles` record and only accepts `PLEASE_ADMIN`.

RLS remains authoritative for all database reads. Private application documents are opened with short-lived signed URLs and require the existing Storage SELECT policy for `PLEASE_ADMIN`.

`STEP3_ADMIN_PORTAL.sql` removes arbitrary browser UPDATE access on `provider_applications`. Authenticated clients can no longer directly change workflow fields such as `status` or `activated_provider_id`; workflow changes remain behind the Step 2.2.D SECURITY DEFINER RPC functions.

## Before deploying

1. Run `supabase/STEP3_ADMIN_PORTAL.sql` in the PLEASE Supabase SQL Editor.
2. Confirm the existing admin user is still:
   - `please.serviceinfo@gmail.com`
   - role: `PLEASE_ADMIN`
   - active: `true`
3. In Supabase **Authentication → URL Configuration** set:
   - Site URL: `https://pleasewebportal.netlify.app`
   - Redirect URL: `https://pleasewebportal.netlify.app/admin-reset-password.html`
4. Upload/commit this package to GitHub `main`; Netlify will redeploy automatically.

## Initial test

Open:

`https://pleasewebportal.netlify.app/admin-login.html`

Sign in with the PLEASE admin account. The dashboard should list existing applications, including the live Work With Us test applications already stored in Supabase.

Test these actions using a NEW application:

1. **START REVIEW** → status becomes `UNDER_REVIEW`.
2. Save **Internal Notes**.
3. **REFER TO DEVELOPER** → status becomes `REFERRED_TO_DEVELOPER`.
4. Open uploaded supporting documents; each link is temporary and the Storage bucket remains private.

Do not use `developer_*` RPCs from this portal. Developer onboarding will be a separate protected application in the next development block.

## Future Resend integration

When Resend is activated, set Netlify:

`PLEASE_ADMIN_APPLICATION_BASE_URL=https://pleasewebportal.netlify.app/admin.html`

The internal new-application email will then show a **VIEW APPLICATION** button that opens the requested application directly in this dashboard.
