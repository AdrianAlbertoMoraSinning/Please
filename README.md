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
