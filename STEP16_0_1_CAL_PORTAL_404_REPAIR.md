# STEP 16.0.1 — CAL Portal 404 Repair

## Issue
The PLEASE Admin sidebar correctly shows `CAL Accounting`, but the production URL:

`https://pleaseservice.ca/cal/dashboard.html`

returns Netlify 404.

## Root cause
The STEP 16.0 package already contains the CAL portal under the root `cal/` directory, but the deployed GitHub repository is missing the `cal/` directory. The Admin navigation file was deployed, so the link appears, but the destination static files are not present in production.

## Repair
Upload the full root-level `cal/` folder to the GitHub repository and redeploy Netlify.

This repair package also includes `netlify.toml` to keep friendly routes:

- `/cal` → `/cal/dashboard.html`
- `/accounting` → `/cal/dashboard.html`

## SQL
No new SQL is required for this 404 repair. The previously delivered STEP 16.0 SQL remains the required accounting bridge schema.

## Verification after deploy
Open:

- `https://pleaseservice.ca/cal/dashboard.html`
- `https://pleaseservice.ca/cal`
- `https://pleaseservice.ca/accounting`

Expected result: CAL 1.5 Financial Dashboard loads instead of Netlify 404.
