# PASO 7 — Jobs Management + Service History + Reports

## New admin pages

- `admin-jobs.html` — complete operational Jobs list and lifecycle management.
- `admin-reports.html` — operational reporting by date, provider, service and status.

## Jobs Management

The admin can now:

- search all jobs by reference, customer, service or address;
- filter by job status, provider and service;
- open a full job record;
- review customer/work information;
- review every assignment attempt (including reassignments);
- review provider response notes;
- review job and assignment lifecycle history;
- mark a confirmed/active job as `COMPLETED`;
- cancel a non-terminal job with a reason.

When a job is completed, any active assignment is also changed to `COMPLETED`, so the provider sees it in Service History.

## History

`job_status_history` is added for job-level lifecycle audit. Existing jobs receive a baseline history entry when STEP 7 SQL is installed. Existing `assignment_status_history` continues to hold assignment-level events.

## Reports

Reports include:

- total jobs;
- completed jobs;
- cancelled jobs;
- estimated service hours;
- provider assignment / confirmation / decline / completion activity;
- service volume and hours.

Filters:

- From / To date;
- Provider;
- Service;
- Job status.

Exports:

- CSV
- native `.xlsx` generated server-side without third-party browser libraries.

Exports use the currently selected report filters.

## Installation

1. Run `supabase/STEP7_JOBS_HISTORY_REPORTS.sql` in Supabase SQL Editor.
2. Upload the full package to the GitHub `Please` repository.
3. Wait for Netlify deployment.
4. Sign into PLEASE Admin.
5. Test Jobs and Reports.

## Recommended first test

Use the already confirmed test job:

1. Open `Jobs`.
2. Open the confirmed job.
3. Verify assignment/provider history and provider response.
4. Click `Mark Completed`.
5. Open the provider portal and verify the assignment moved to `Service History` as `COMPLETED`.
6. Open `Reports` and verify the completed count increases.
7. Export both CSV and XLSX.
