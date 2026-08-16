# STEP 5 — Provider Portal

This step adds the provider-facing portal for activated PLEASE professionals.

## Included
- `provider-login.html` — custom provider authentication (no Supabase Auth).
- `provider.html` — provider dashboard.
- `provider-password.html` — controlled password change.
- `netlify/functions/provider-*` — secure server-side provider API.
- `supabase/STEP5_PROVIDER_PORTAL.sql` — sessions, login audit, password verification, availability actions and assignment confirmation/decline.

## Provider capabilities
- View assigned services and profile.
- Maintain recurring weekly availability.
- Add/remove date-specific availability exceptions.
- View pending and confirmed work assignments.
- Confirm or decline a pending assignment.
- View completed/past service history.
- Export assignment/service history to CSV.
- Change provider portal password.

## Security model
Provider credentials are stored only as bcrypt hashes in `provider_portal_users`. Provider sessions use a separate HttpOnly/Secure/SameSite cookie and do not depend on Supabase Auth. Browser clients never receive the Supabase secret key. Every provider data request is scoped server-side to the provider linked to the authenticated portal user.

## Installation
1. Run `supabase/STEP5_PROVIDER_PORTAL.sql` in Supabase SQL Editor.
2. Upload this package to the GitHub `Please` repository and commit to `main`.
3. Wait for Netlify production deploy.
4. Open `/provider-login.html`.
5. Sign in with a credential created during Developer Onboarding.

## Test case
The activated provider created in STEP 4 can sign in with the email/password configured during onboarding. Confirm that the portal loads their provider profile, service assignment and weekly availability. No other provider data should be visible.
