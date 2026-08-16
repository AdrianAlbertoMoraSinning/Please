# STEP 8.3.1 — Customer Rate Input + Reports Recovery

This patch fixes two issues found during STEP 8.3 testing.

## 1. PLEASE Customer Rate direct typing

The Master Calendar Customer Billing row no longer rebuilds itself on every keystroke. Direct keyboard entry (for example `95`, `120.50`, etc.) now keeps focus and the caret in the rate field. Financial preview values update in place while typing.

## 2. Reports loading recovery

Reports can no longer remain permanently behind `Checking secure session…` because one report dataset fails. The page always exits the loading state and shows a visible warning/error when necessary.

`admin-reports-data` also loads provider payments without nested PostgREST relationship embeds and hydrates provider/job information from the already loaded core datasets. This is more resilient after database migrations.

No SQL migration is required for this patch.
