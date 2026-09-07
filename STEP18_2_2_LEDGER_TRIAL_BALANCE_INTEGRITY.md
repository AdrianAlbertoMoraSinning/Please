# STEP 18.2.2 — Ledger & Trial Balance Integrity Fix

Scope is intentionally limited to CAL financial reporting.

## Fix
- Trial Balance is calculated from `accounting_journal_lines` already returned by the connected CAL backend.
- Only `POSTED` journal entries contribute.
- Debit and credit totals are shown explicitly.
- A BALANCED / OUT OF BALANCE control is displayed.
- No journal, Stripe payment, operational invoice, Provider payment or Supplier Bill is modified.

## Deployment
No database migration is required for this fix. Upload the runtime files and redeploy Netlify.
