# CAL 1.5 — Canadian Accounting by Lottus

Canadian accounting platform designed to connect to existing client portals while keeping each customer's accounting data in infrastructure owned or controlled by that customer.

## Custody rule — non-negotiable

This repository contains application technology, not a shared customer accounting database. Every production customer gets:

1. Their own Supabase project/account or approved customer-controlled database environment.
2. Their own private Storage and backup policy.
3. Their own production credentials and environment variables.
4. A customer-isolated deployment/integration of CAL.

Do **not** point unrelated customers at one shared production accounting database.

## CAL 1.5 modules

- Financial dashboard
- Customer invoices / Accounts Receivable
- Expenses / Accounts Payable foundation
- Banking and reconciliation workspace
- General Journal / double-entry controls
- GST/HST/QST working-paper module
- Financial reports and exports
- Canadian starter Chart of Accounts
- Private accounting document-vault architecture
- Audit trail
- Company / province / fiscal-year / custody setup
- Disclaimer & Data Custody agreement
- Mandatory per-user legal acceptance gate
- Electronic-signature / physical-copy-on-file workflow
- Client-owned Supabase production schema
- Netlify server-function foundation

## Disclaimer & legal acceptance

Current agreement version: `CAL-LEGAL-1.0-2026-09-05`  
Effective: September 5, 2026

`disclaimer.html` is shown in the sidebar immediately before Sign Out. A user who has not accepted the current agreement version is redirected to the Disclaimer before accounting modules are accessible.

Demo mode stores acceptance evidence in browser localStorage. Production is designed to store evidence in the customer's own `accounting_legal_acceptances` table through an authenticated server-side function.

See:

- `docs/SIGNATURE_AND_DISCLAIMER_PROCEDURE.md`
- `docs/DISCLAIMER_AGREEMENT_README.md`
- `supabase/V1_5_LEGAL_ACCEPTANCE.sql`

## Security baseline

- No service-role/server secret committed to GitHub.
- Sensitive database tables use RLS and browser roles have no direct access.
- Server-side functions reference `CLIENT_SUPABASE_SECRET_KEY` only from Netlify environment variables.
- Accounting export now requires a valid server-side CAL session before customer data can be exported.
- Legal acceptance production writes also require a valid server-side CAL session.
- Private documents are intended for customer-owned private Storage and signed URLs.
- Posted accounting events are designed for reversal/adjustment rather than silent deletion.
- Per-client isolation is architectural, not merely a row-level `tenant_id` filter.

## Demo / production boundary

The downloadable UI can operate in demo-local mode. Demo data is stored in browser localStorage and must not be used as production accounting storage.

For live accounting use:

1. Create the CUSTOMER'S OWN Supabase project.
2. Run `supabase/V1_0_ACCOUNTING_CORE.sql` for a fresh installation. It now includes the legal acceptance table.
3. Existing CAL databases can run `supabase/V1_5_LEGAL_ACCEPTANCE.sql` instead.
4. Configure client-specific Netlify environment variables from `.env.example`.
5. Activate authenticated production adapters before entering real accounting information.

CAL 1.5 intentionally does **not** transmit tax returns to CRA/Revenu Québec, store online-banking passwords, store full payment-card data, or run statutory payroll remittances.

## Quick GitHub / Netlify deploy

Upload the repository contents to the GitHub repository root. Netlify detects `netlify.toml`; no build command is required.

## Version

CAL 1.5.0 — 2026-08-30  
Legal agreement effective — 2026-09-05
