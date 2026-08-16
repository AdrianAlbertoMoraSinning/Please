# P.L.E.A.S.E. Portal — Step 2.3 Setup

## What this package adds

- New public `work-with-us.html` page following the approved Professional Network direction.
- Work With Us application form connected to the Supabase RPC `submit_provider_application(...)`.
- Dynamic service list from `public.services` using the public active-services RLS policy.
- Support for `Other / More` services.
- Licensing/certification and insurance status options matching the Step 2 data model.
- Required consent acknowledgements.
- On-screen success state showing the generated `PLS-APP-...` reference.
- No provider account is created by this form.
- Existing homepage `Join Our Team` navigation and section now link to the new application page.

## Required configuration before testing submissions

Edit `supabase-config.js` and replace:

```js
window.PLEASE_SUPABASE_URL = 'PASTE_SUPABASE_PROJECT_URL_HERE';
window.PLEASE_SUPABASE_ANON_KEY = 'PASTE_SUPABASE_ANON_KEY_HERE';
```

Use the P.L.E.A.S.E. Supabase **Project URL** and **publishable/anon key**.

Never place the `service_role` key in this file or any browser code.

## Expected test

1. Open `work-with-us.html` through the deployed site or a local web server.
2. Confirm the Service / Trade dropdown loads the active Supabase services.
3. Complete all required fields.
4. Submit.
5. The success panel should show an application reference such as `PLS-APP-20260816-ABC123`.
6. In Supabase, `provider_applications` should contain the new row with status `NEW`.
7. `provider_application_status_history` should have its initial `NEW` history entry.
8. `providers` must remain unchanged.

## Intentionally deferred

Step 2.4 will add private document uploads for certification, insurance and portfolio files.
Step 2.5 will add transactional email notifications to the applicant and P.L.E.A.S.E.
