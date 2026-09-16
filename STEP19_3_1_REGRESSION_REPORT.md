# PLEASE — STEP 19.3.1 Regression Report

## Baseline

Protected baseline: `PLEASE_STEP19_3_Provider_Assignment_Removal_FULL.zip`.

## Result

- Full automated Node test suite: **124 passed / 124 total**
- Failed: **0**
- Skipped: **0**
- Changed existing baseline files before release documentation: **9**
- New functional/test files before release documentation: **2**
- Deleted baseline files: **0**
- Node syntax validation for changed production JavaScript: **PASS**
- SQL migration required: **NO**

## STEP 19.3.1 acceptance coverage

Automated tests verify:

- `DECLINED` and `CANCELLED` assignments are suppressed from Provider-facing assignment collections;
- removed/declined work no longer appears in Overview, Assignments, My Calendar or Service History;
- Provider CSV export excludes declined/cancelled assignments;
- Provider Dashboard API suppresses those assignment payloads and related schedule-change, extension and service-event payloads;
- Administration audit/history remains intact;
- STEP 19.3 removal safeguards remain unchanged;
- Provider page cache-bust advances to `19.3.1`;
- Provider service-worker cache advances to `please-provider-v21`.

## Production acceptance boundary

Local code/regression acceptance is complete. Production acceptance still requires Netlify deployment and a real Provider Portal smoke test using a declined/cancelled assignment.
