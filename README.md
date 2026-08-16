# PLEASE Services — Website Refresh v1

## Included
- `index.html`: full homepage with services, quote form, payment CTA and contact.
- `payment.html`: Stripe payment page with placeholder Payment Links.
- `thank-you.html`: confirmation page.
- `css/style.css`: improved PLEASE visual style.
- `js/app.js`: mobile menu, smooth scroll and lead prefill storage.
- `images/please-logo.png`: logo supplied by client.
- `modules/agenda/`: reusable booking/admin module adapted from Montecristo.

## Stripe setup
Open `payment.html` and replace:
- `STRIPE_PAYMENT_LINK_50_DEPOSIT`
- `STRIPE_PAYMENT_LINK_100_DEPOSIT`
- `STRIPE_PAYMENT_LINK_CUSTOM_INVOICE`

with the real Stripe Payment Links from the PLEASE Stripe dashboard.

## Agenda setup
The agenda is currently in demo mode. To connect it to Google Sheets, deploy `modules/agenda/apps-script-backend.gs` as a Google Apps Script Web App and paste the URL into `modules/agenda/agenda-config.js`.

## Netlify forms
The quote and contact forms are prepared for Netlify Forms. After deployment, test both forms from the live site.

## Portal development status (Aug 2026)

The repository is being migrated from the original demo agenda/Stripe placeholders to the PLEASE Supabase portal architecture. Work With Us Step 2.4 adds private provider-application uploads through Netlify Functions. See `STEP2_4_SETUP.md` for deployment instructions.

## Step 2.5.A — Transactional emails

A Resend-ready transactional email function is included at `netlify/functions/provider-application-notify.js`. It is intentionally inactive until the PLEASE sending domain is verified and the Resend environment variables are configured in Netlify. See `STEP2_5A_RESEND_EMAILS.md`.
