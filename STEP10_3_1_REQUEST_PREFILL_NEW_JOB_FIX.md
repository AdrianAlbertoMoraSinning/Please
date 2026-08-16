# STEP 10.3.1 — Service Request Prefill + New Job Button Fix

Patch for the STEP 10.3 conversion workflow.

- Persists the selected READY_TO_ASSIGN request in sessionStorage before navigation.
- Rehydrates and prefills the Master Calendar Job drawer after navigation.
- Falls back from service_id to service_name when needed.
- Prefills a two-hour end time from the customer preferred start time.
- NEW JOB ASSIGNMENT now clears request context and always opens a clean manual Job form.
- Adds asset version query strings so Netlify/browser caches do not keep stale JavaScript.

No SQL changes are required.
