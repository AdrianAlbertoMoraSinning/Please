# STEP 18.7.1 — Fixed Asset Party Role Guardrails

This non-SQL hotfix narrows Fixed Asset party selectors and validates assignments server-side.

- Responsible person: active EMPLOYEE, CONTRACTOR or OPERATIONAL_PROVIDER role.
- Supplier: active SUPPLIER role only.
- Existing responsible assignments remain viewable/editable even if a later role change makes them ineligible for new assignment.
- No accounting entries, fixed-asset balances, CCA working papers, inventory, A/R, A/P, Stripe or Provider Payments are changed.
- No Supabase migration is required.
