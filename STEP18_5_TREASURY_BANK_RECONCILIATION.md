# STEP 18.5 — Treasury & Bank Reconciliation

This step replaces CAL's staged banking placeholder with a ledger-driven treasury and reconciliation workspace.

## Scope
- Daily Cash Position from POSTED journal lines.
- Active Bank, Cash, Credit Card, Clearing and Loan financial accounts from STEP 18.1.
- CSV / OFX / QFX statement import without storing bank credentials.
- SHA-256 source-file fingerprint and idempotent statement re-import. CSV rows preserve legitimate same-date/same-amount duplicates through stable source-row identity; OFX/QFX prefers FITID.
- Statement transaction matching to POSTED financial-account journal lines.
- Conservative exact Auto Match (single unique candidate within ±3 days).
- Manual multi-line matching for aggregate deposits/payouts.
- Outstanding book-item carry-forward between reconciliations.
- Reconciliation controls: statement roll-forward, book ending, adjusted statement, difference.
- CLOSED reconciliations and match evidence are immutable; evidence cannot be inserted, moved, updated or deleted after close.
- Reconciliation periods for the same financial account cannot overlap, including already CLOSED periods.
- Evidence-changing operations serialize against Close to prevent concurrency races.
- Operating Bank value in Reports becomes ledger-derived instead of payment-reconstructed, using the exact SQL ledger-balance RPC rather than REST-row summation.
- Daily Cash Position uses exact ledger balances for Bank/Cash/Clearing/Card/Loan accounts, plus A/P, reimbursement, Provider and A/R commitments.

## Close rules
A reconciliation can close only when:
1. Opening statement balance + imported activity = statement ending balance within $0.01.
2. Every statement transaction is matched to posted ledger evidence.
3. Adjusted statement balance (ending statement + outstanding book effect) equals the GL book ending balance within $0.01.

Outstanding book items are allowed and carry forward. Unexplained statement transactions are not allowed: record the missing accounting transaction through the appropriate CAL module or General Journal, then match it.

## No automatic accounting side effects
STEP 18.5 does **not** create journal entries and does not use the STEP 17 posting queue. Reconciliation is evidence/control over the existing General Ledger.

## Sign convention
`signed_amount` is normalized to the financial account's normal balance:
- Bank / Cash / Clearing assets: positive increases cash; negative decreases cash.
- Credit Card / Loan liabilities: positive increases amount owed; negative decreases it.

The import UI can use file signs as-is or invert them. AUTO defaults to sign inversion for credit-card/loan statement files.


## First reconciliation / opening position
For the first reconciliation of an account, choose a period whose opening statement balance can be supported by the existing book opening balance. Historical items that predate CAL reconciliation history should be resolved or documented before closing the first controlled period. Subsequent CLOSED reconciliations carry outstanding book items forward automatically.

## Stripe Clearing
STEP 18.5 can reconcile a financial account of type `CLEARING`, including Stripe Clearing. A customer payment posted to Stripe Clearing is not automatically an Operating Bank deposit. A real Stripe payout needs its own accounting transfer/evidence (`Dr Bank / Cr Stripe Clearing`) before the bank statement can match it. STEP 18.5 intentionally does not invent payout journals.

## Deployment order
1. Run the STEP 18.5 Supabase migration.
2. Run `STEP18_5_VERIFY.sql`; every check must be `PASS`.
3. Upload the UPLOAD_ONLY files to GitHub preserving paths.
4. Wait for Netlify `Published`.
5. Validate Daily Cash Position, start one reconciliation, import a real CSV/OFX/QFX statement, match, and close only when both controls are zero.
