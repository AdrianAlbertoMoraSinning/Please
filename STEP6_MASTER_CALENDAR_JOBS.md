# STEP 6 — Master Calendar + Job Assignment

This build connects PLEASE Administration to provider availability and the Provider Portal assignment workflow.

## What is included

- `admin-calendar.html` — PLEASE Master Calendar and Needs Assignment queue.
- `js/admin-calendar.js` — weekly calendar, filters, create/reassign workflow, assignment detail/cancellation.
- `netlify/functions/admin-calendar-data.js` — secure calendar data endpoint.
- `netlify/functions/admin-job-action.js` — secure job/assignment action endpoint.
- `netlify/functions/provider-assignment-notify.js` — Resend-ready provider assignment notification. It safely skips delivery until Resend is configured.
- `supabase/STEP6_MASTER_CALENDAR_JOBS.sql` — custom-admin attribution, availability validation and controlled job assignment functions.

## Workflow

1. PLEASE Admin opens Master Calendar.
2. Active providers are shown against their recurring availability, date exceptions and current assignments.
3. PLEASE creates a job and selects an eligible provider/time.
4. Database validates provider/service eligibility and availability.
5. A `PENDING` assignment is created and immediately reserves the provider window using the existing exclusion constraint.
6. The Provider Portal displays the pending assignment.
7. Provider confirms → assignment `CONFIRMED`, job `CONFIRMED`.
8. Provider declines → assignment `DECLINED`, job `NEEDS_ASSIGNMENT`.
9. `NEEDS_ASSIGNMENT` jobs appear in the Admin queue and can be reassigned without creating a duplicate job.

## Security

- Master Calendar requires the custom `PLEASE_ADMIN` HttpOnly session.
- Browser never receives the Supabase secret key.
- Job mutations pass through a Netlify Function and `please_portal_job_action`.
- The provider must be `ACTIVE` and assigned to the selected service.
- Provider availability is checked in `America/Edmonton` time.
- The database exclusion constraint remains the final protection against overlapping PENDING/CONFIRMED assignments.
- Custom admin attribution is recorded independently from Supabase Auth.

## Installation

1. Run `supabase/STEP6_MASTER_CALENDAR_JOBS.sql` in the PLEASE Supabase SQL Editor.
2. Upload the complete build to the GitHub `Please` repository and commit to `main`.
3. Allow Netlify to deploy the new commit.
4. Open `/admin-calendar.html` while signed in as PLEASE Admin.
5. Create a test assignment to an active provider.
6. Sign in to that provider's `/provider-login.html` account and confirm/decline the assignment.
7. Refresh Master Calendar to verify the new state.

## Email

`provider-assignment-notify` is ready for Resend. Until `RESEND_API_KEY` and `PLEASE_EMAIL_FROM` are configured, assignment creation still succeeds and email delivery is skipped without breaking the operational workflow.
