# PLEASE STEP 19.7 — Centralized Job Management & Dynamic Provider Teams

## Purpose
STEP 19.7 makes the active Service Job the operational source of truth and allows Administration to add Providers to an existing Job without creating a duplicate service.

## Administration > Jobs
- Jobs exposes **+ ADD PROVIDER** for eligible active Jobs.
- The existing team remains intact; the new Provider receives an independent PENDING assignment.
- Provider eligibility, availability, schedule overlap and billing/rate integrity are validated before save.
- The same PLS-JOB is preserved and required provider count, quoted subtotal and duration are recalculated.
- Provider and assignment history remain auditable.

## One editing path
- **Jobs → EDIT SERVICE** remains the canonical editor for active Job date, start/end time, total hours, service type, address, work description, internal notes, Customer Rate and Provider Cost.
- Master Calendar remains a scheduling/visibility surface. Its former duplicate schedule editor is removed and replaced by **OPEN JOB EDITOR**.
- Service Maintenance hosts the canonical editor implementation reached from Jobs and Calendar; it is no longer a competing workflow.

## Safety
Completed, cancelled and in-progress Jobs cannot receive a Provider through the normal add-provider flow. Existing Providers are not replaced or rewritten. Customer notifications are not generated merely because internal team composition changes; the newly assigned Provider receives the normal assignment notification.

## Database
No SQL migration is required. STEP 19.7 uses the existing multi-provider, billing and audit schema.
