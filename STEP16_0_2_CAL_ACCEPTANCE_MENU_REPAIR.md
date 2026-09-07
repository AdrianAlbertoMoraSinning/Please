# STEP 16.0.2 — CAL Acceptance Backend & Admin Menu Repair

This repair completes the production deployment path for the CAL 1.5 portal inside PLEASE.

## Fixes

1. **CAL legal acceptance backend deployment**
   - Ensures the Netlify Functions required by CAL are included in the hotfix package.
   - Prevents the browser from showing raw Netlify `Page not found` HTML inside an alert if a backend function is missing.
   - Shows a clear operational message instead.

2. **Admin sidebar consistency**
   - Ensures `CAL Accounting` appears in every root-level PLEASE Administration operations page sidebar, including Service Maintenance.
   - Keeps CAL as an independent portal at `/cal/dashboard.html`.

## Important

This repair does not change accounting posting rules or Canadian accounting policy.

If legal acceptance returns a structured database error after this hotfix is deployed, run:

```
supabase/STEP16_0_CAL_PLEASE_ACCOUNTING_BRIDGE.sql
```

Do not paste CAL, Stripe, Supabase, or webhook secrets into chat or GitHub.
