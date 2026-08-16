# STEP 10.3 — Convert Service Request to Job & Assign

A `READY_TO_ASSIGN` customer Service Request now exposes **CREATE JOB & ASSIGN** in PLEASE Administration. The button opens the existing Master Calendar Job drawer and preloads the customer, requested service, address, work description, customer notes and preferred schedule.

PLEASE remains responsible for selecting the Provider, final date/time, Customer Billing and Provider message. Sending the assignment creates the existing Job/Assignment and then marks the originating Service Request `ASSIGNED` with its `job_id`.

Run `supabase/STEP10_3_CONVERT_REQUEST_TO_JOB.sql` before deploying the application files.
