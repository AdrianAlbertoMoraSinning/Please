# Deployment — One Customer = One Data Environment

## A. Code
Create a GitHub repository for the customer's accounting deployment or deploy from a controlled reusable source repository.

## B. Data custody
Create a NEW Supabase project owned by / dedicated to the customer. Select a Canadian region when available and contractually appropriate. Run:

`supabase/V1_0_ACCOUNTING_CORE.sql`

Create a private Storage bucket named `accounting-documents`.

## C. Netlify
Create a Netlify site and add:

- `CLIENT_SUPABASE_URL`
- `CLIENT_SUPABASE_SECRET_KEY`
- `ACCOUNTING_SESSION_SECRET`
- `ACCOUNTING_COMPANY_SLUG`
- `ACCOUNTING_ALLOWED_ORIGIN`

Never put these values in `js/supabase-config.js` or GitHub.

## D. Demo vs production
The shipped frontend uses `DEMO_LOCAL` by design. It proves the navigation, workflows, calculations and data model without any external custody. Before real client records are entered, switch the UI adapter to the server API/functions and complete acceptance tests against the customer's database.

## E. Required production acceptance tests

1. Client database belongs to the intended customer and is not shared.
2. RLS enabled and `anon/authenticated` cannot read accounting tables directly.
3. Server secret exists only in Netlify environment.
4. Owner/Admin/Bookkeeper/Accountant permissions verified.
5. Invoice totals and taxes recalculated server-side.
6. Journal entry cannot post unless total debit = total credit.
7. Closed/locked fiscal periods block ordinary posting.
8. Posted records cannot be silently edited/deleted.
9. Document bucket is private; access uses short-lived signed URLs.
10. Export produces a complete portable client copy.
11. Restore-from-backup test completed.
12. Client accountant signs off on chart of accounts, tax codes and opening balances.
