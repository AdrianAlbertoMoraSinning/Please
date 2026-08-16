# PLEASE Portal — STEP 4 Developer Portal / Provider Onboarding

## Purpose
This restricted portal is for the web developers, not PLEASE staff. It consumes applications after PLEASE marks them `REFERRED_TO_DEVELOPER` and provisions the provider as a reusable portal entity.

## Workflow
`REFERRED_TO_DEVELOPER → ONBOARDING → APPROVED → ACTIVATED`

During onboarding the developer can:
- Create/update the provider draft linked to the original application.
- Assign one or more PLEASE services.
- Configure the provider's initial weekly availability.
- Create/reset the provider's custom portal credential (bcrypt hash only; no Supabase Auth dependency).
- Approve only after profile + service + availability + credential exist.
- Activate the provider and optionally publish the public landing profile.

PLEASE Admin cannot access these developer functions because the server requires a custom portal user with role `DEVELOPER_ADMIN`.

## Install
1. Run `supabase/STEP4_DEVELOPER_PORTAL.sql` in Supabase SQL Editor.
2. Create the developer portal user using `supabase/STEP4_CREATE_DEVELOPER.sql` after replacing the placeholder password. Never commit a real password.
3. Upload this package to GitHub `main`; Netlify deploys automatically.
4. No new Netlify secret is required: the Developer Portal reuses `PLEASE_ADMIN_SESSION_SECRET`, `PLEASE_SUPABASE_URL`, and `PLEASE_SUPABASE_SECRET_KEY` server-side.
5. Open `/developer-login.html`.

## Admin loading correction
`Checking secure session…` is now a full-screen temporary overlay and is removed from the DOM immediately after a valid session is confirmed. It no longer leaves blank space above the admin portal.

## Public provider landing
If `Publish landing on activation` is selected, the provider can be viewed at:
`/professional.html?provider=<provider-slug>`

The public endpoint never exposes provider email, phone, login credentials, or internal notes. Customer contact remains through PLEASE.
