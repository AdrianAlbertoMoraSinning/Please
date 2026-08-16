# PLEASE Portal — Step 2.5.A Transactional Email System (Prepared for Resend)

## What this step adds

- New Netlify Function: `provider-application-notify`
- Applicant confirmation email after a successful Work With Us application
- Internal notification email to PLEASE after a successful application
- Emails are sent only from the server; the Resend API key is never exposed to browser code or GitHub
- The function re-validates application ID + reference + applicant email against Supabase before sending
- Supporting-document count is read server-side after uploads finish
- Resend idempotency keys are used to reduce duplicate sends if the notification call is retried within Resend's idempotency window
- Email failure never rolls back or hides a successfully submitted application
- Frontend upload copy and validation corrected from 5 MB to the actual 4 MB backend limit

## Netlify environment variables

Add these later when the PLEASE sending domain is verified in Resend:

- `RESEND_API_KEY` = Resend sending-access API key (`re_...`)
- `PLEASE_EMAIL_FROM` = `PLEASE Services <notifications@mail.pleaseservice.ca>`
- `PLEASE_EMAIL_REPLY_TO` = `info@pleaseservice.ca`
- `PLEASE_APPLICATION_NOTIFY_EMAIL` = `info@pleaseservice.ca`

Already configured from Step 2.4:

- `PLEASE_SUPABASE_URL`
- `PLEASE_SUPABASE_SECRET_KEY`

Optional future variable:

- `PLEASE_ADMIN_APPLICATION_BASE_URL`

Example after the admin portal exists:

`https://pleasewebportal.netlify.app/admin/provider-application.html`

When defined, the internal PLEASE email automatically includes a `VIEW APPLICATION →` button with the application UUID in the query string.

## Current behavior before Resend activation

The website calls `/.netlify/functions/provider-application-notify` after the application and optional file uploads finish.

If `RESEND_API_KEY` or `PLEASE_EMAIL_FROM` is not configured yet, the function returns HTTP 503 with:

`EMAIL_NOT_CONFIGURED`

The applicant still sees `APPLICATION RECEIVED` because email delivery is intentionally best-effort and does not determine whether the application was saved.

## After domain access is received

1. Create/verify the PLEASE sending domain in Resend (recommended: `mail.pleaseservice.ca`).
2. Add the DNS records supplied by Resend at the DNS provider for `pleaseservice.ca`.
3. Create a Resend API key with sending access.
4. Add the four email variables above to Netlify with Functions/Runtime scope.
5. Trigger a new production deploy.
6. Submit a new Work With Us application and verify both emails in Resend and the recipient inboxes.

## Function endpoint

`/.netlify/functions/provider-application-notify`

GET should return `Method not allowed`; POST is called automatically by the application page.

## Email subjects

Applicant:

`PLEASE Professional Network — Application Received (PLS-APP-...)`

PLEASE internal notification:

`New Professional Application — PLS-APP-...`

## Security

- Never put `RESEND_API_KEY` in `supabase-config.js`, frontend JS, HTML, or GitHub.
- Use a Resend key restricted to sending access.
- The function uses the Supabase server secret only from Netlify environment variables.
- The browser sends only application ID, reference and the applicant's own email to request notification; the server reloads authoritative application details from Supabase.
