# STEP 10.6 — Initial Tracking Email

When a customer successfully submits a public Service Request, the same server-side function that creates the request now sends a transactional confirmation email through Resend.

The email includes:

- Customer first name
- `PLS-REQ-...` Request Reference
- Requested service
- Preferred date/time when supplied
- A secure `TRACK YOUR REQUEST` button using the request's tracking token
- Instructions explaining that the customer can recover tracking later with Request Reference + Email
- PLEASE contact information

## Important behavior

The Service Request is authoritative. An email-delivery failure never deletes or rolls back a successfully created request. The confirmation screen still gives the customer the Request Reference and secure tracking link.

The initial tracking token is also inserted into `service_request_tracking_tokens` when STEP 10.4.3 is installed. The legacy `service_requests.tracking_token_hash` remains available as a compatibility fallback.

## Netlify environment variables

Required to send email:

- `RESEND_API_KEY` — Resend API key restricted to sending access
- `PLEASE_EMAIL_FROM` — example: `PLEASE Services <notifications@mail.pleaseservice.ca>`

Recommended:

- `PLEASE_EMAIL_REPLY_TO` — `info@pleaseservice.ca`
- `PLEASE_PUBLIC_SITE_URL` — canonical production site URL, e.g. `https://pleaseservice.ca` once the domain is connected. If omitted, the request origin is used.

The API key must never be committed to GitHub, HTML, frontend JavaScript or `supabase-config.js`.

## Resend domain

The sender domain must be verified in Resend before production sending. Configure the DNS records Resend supplies for the PLEASE-owned sending domain. A subdomain such as `mail.pleaseservice.ca` is recommended for transactional sending.

## Test

1. Confirm Resend domain verification.
2. Add the environment variables to Netlify Functions/Runtime.
3. Trigger a production deploy.
4. Submit a brand-new Service Request using an inbox you can access.
5. Confirm the website shows `REQUEST RECEIVED` and an email-sent confirmation.
6. Confirm the email subject contains the new `PLS-REQ-...` reference.
7. Click `TRACK YOUR REQUEST` from the email.
8. Confirm the secure tracking page opens the same request.
