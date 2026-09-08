# STEP 18.6.1 — Inventory UI Guardrails

Small non-destructive UI hotfix on top of STEP 18.6.

- Replaces the ambiguous native `confirm()` used to choose Adjustment Gain vs Loss with an explicit CAL modal.
- Uses the browser-local calendar date for Inventory forms instead of UTC ISO date rollover.
- Requires at least two active locations before opening Transfer.
- Excludes the selected origin from the destination list and validates origin != destination before submit.
- Database protections and accounting behavior remain unchanged.
- No Supabase migration is required.
