# STEP 18.9.1 — Period Boundary Guardrails

Hotfix on top of STEP 18.9 Advanced Period Close.

## Purpose
Prevent accidental partial-period closes and ambiguous/overlapping fiscal periods before the first production close is prepared.

## Controls
- **Standard Monthly Close** defaults to the last fully completed calendar month.
- Start/end dates are read-only in standard mode and must represent a complete calendar month.
- **Custom Fiscal Period** remains available for intentional stub periods, migration boundaries, fiscal-year transitions or other documented exceptions.
- Custom/partial periods require an explicit confirmation and a reason of at least 10 characters.
- PostgreSQL rejects overlapping fiscal-period records regardless of OPEN/CLOSED state.
- Preparation also rejects ranges overlapping an existing accounting period lock.
- The legacy three-argument `accounting_prepare_period_close` RPC remains available for compatibility, but it can prepare complete calendar months only.
- Boundary classification/evidence is stored on `accounting_fiscal_periods` as `CALENDAR_MONTH` or `CUSTOM`.

## Data safety
No journal, financial event, invoice, payment, payroll, inventory, fixed-asset or reconciliation data is rewritten by this hotfix.

## Deployment order
1. Run `STEP18_9_1_PERIOD_BOUNDARY_GUARDRAILS.sql` in Supabase SQL Editor.
2. Run `STEP18_9_1_VERIFY.sql`; expect 14 PASS rows.
3. Upload the UPLOAD_ONLY package to GitHub preserving directories.
4. Wait for Netlify Published.
5. Open CAL → Period Close → + Prepare Period.
6. Standard mode should default to the last fully completed calendar month.
7. Verify Custom Fiscal Period requires reason + confirmation.
