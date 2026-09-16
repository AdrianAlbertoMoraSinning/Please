# PLEASE — STEP 19.3 Provider Assignment Removal & Replacement Control

## Purpose

STEP 19.3 closes an operational gap identified in production: a Provider who already confirmed a Job could remain visible in that Provider's portal even when PLEASE replaced that person and another Provider actually performed the service.

The release adds a controlled Administration action to remove one Provider assignment without cancelling the Job, deleting history, or notifying the customer that the whole service was cancelled.

## Administration workflow

Path:

`Administration → Jobs → open Job → Assignment History`

For an assignment whose status is `PENDING` or `CONFIRMED`, Administration now sees:

`REMOVE FROM SERVICE`

The Administrator must enter a reason and confirm the action.

The action:

- changes only the selected assignment to `CANCELLED`;
- preserves the Job and all other Provider assignments;
- records `assignment_status_history`;
- records a Provider technical-history event;
- recalculates an active Job's team status when appropriate;
- never sends a customer cancellation email;
- sends the removed Provider a short notice that no action is required.

## Safety guardrails

Normal removal is deliberately blocked when the selected Provider has already begun operational work.

Administration cannot use this button when the assignment has:

- ARRIVED / STARTED / COMPLETED / CHECKED_OUT service activity;
- active extension activity;
- committed ARRIVAL / COMPLETION / CHECK_OUT evidence; or
- an attached Provider Payment.

Those cases require a controlled operational / financial correction rather than pretending the Provider never participated.

A Daily Check In by itself is not treated as proof that this specific service was performed; the service-level evidence and events remain the decisive guardrails.

## Completed Job behavior

When a non-attending `CONFIRMED` Provider is removed from a Job that is already `COMPLETED`, the Job remains `COMPLETED`.

Example:

- Original team: Maria + Fabian
- Maria confirmed, but did not attend
- Actual team: Jorge + Fabian
- Job completed

Administration can remove Maria from the service. The Job remains completed and Jorge/Fabian remain unchanged.

## Active Job behavior

For active scheduling states, the remaining team is recalculated against `required_provider_count`:

- too few active Providers → `NEEDS_ASSIGNMENT`;
- enough Providers but someone is still pending → `PENDING_PROVIDER`;
- required team fully confirmed → `CONFIRMED`.

`IN_PROGRESS`, `COMPLETED`, and `CANCELLED` Jobs are never reopened by this correction.

## Provider Portal behavior

After removal:

- the assignment disappears from **Assignments**;
- it disappears from **Next assignments**;
- it no longer blocks **Availability**;
- it no longer appears in **My Calendar**;
- it remains in **Service History** as `CANCELLED` for audit and transparency.

The Provider receives an email titled approximately:

`PLEASE — Removed from Service (PLS-JOB-...)`

The customer receives no email for this internal team correction.

## Data and financial integrity

STEP 19.3 does not delete assignment history or Provider billing snapshots. It does not alter an issued customer invoice and does not create or reverse accounting entries.

If a Provider Payment already exists for the assignment, normal removal is blocked so Administration cannot silently invalidate a financial record.

## Database / migration

**No new SQL migration is required.**

The implementation uses the current assignment, history, event, evidence, Provider Payment, Job, and Provider technical-history structures already present in PLEASE.

## Deployment

1. Deploy the STEP 19.3 `UPLOAD_ONLY` package to the current repository, preserving folders.
2. Wait for Netlify to report `Published`.
3. On Provider phones, reopen / refresh the Provider PWA so the new cache version is activated.
4. Perform the production smoke test below.

## Production smoke test

Use a completed Job with a confirmed Provider who did not attend and has no service evidence/payment:

1. Open `Administration → Jobs`.
2. Open the Job.
3. Under `Assignment History`, locate the non-attending Provider.
4. Click `REMOVE FROM SERVICE`.
5. Enter a clear reason and confirm.
6. Verify that the selected Provider becomes `CANCELLED` while the Job remains `COMPLETED`.
7. Verify that the other Providers are unchanged.
8. Verify that the customer does **not** receive an email.
9. Verify that the removed Provider receives the removal notice.
10. Open the removed Provider's portal: the Job must no longer appear in Assignments or My Calendar, but must remain in Service History.

Production acceptance should be declared only after this smoke test passes.
