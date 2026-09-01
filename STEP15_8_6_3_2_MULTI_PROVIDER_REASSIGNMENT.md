# STEP 15.8.6.3.2 — Multi-Provider Reassignment

## Objective
Make **Correct & Reassign** behave like original Job creation when a Job has returned to `NEEDS_ASSIGNMENT`.

The administrator can now do either of these inside the same existing `PLS-JOB`:

- correct/re-send the rejected or cancelled Provider assignment; or
- correct/replace that assignment **and add one or more additional Providers** in the same submission.

No duplicate Job is created and the linked `PLS-REQ` remains attached to the same `PLS-JOB`.

## Administration workflow
1. Open **Master Calendar → Needs Assignment → Assign**.
2. The rejected/cancelled Provider slot is prefilled in the normal **Service Team & Provider Billing** card.
3. Correct Provider, date/time, Rate Item, Qty, PLEASE Customer Rate and Provider Rate as required.
4. To expand the team, click **+ ADD ANOTHER PROVIDER**.
5. Complete the additional Provider's independent schedule and billing card.
6. Repeat if more Providers are required.
7. Click **SEND ASSIGNMENTS →** once.

The first card is the replacement slot. Additional cards are new team members and may be removed before sending.

## Same-Job lifecycle rules
- The existing Job ID/reference is retained.
- The failed assignment remains historical as `DECLINED`/`CANCELLED`.
- The replacement assignment preserves the failed slot's `sequence_no` and `is_primary` flag.
- Additional Providers receive new sequence positions and are not marked Primary.
- Existing active/confirmed/completed team members are not changed.
- Every newly sent Provider assignment begins as `PENDING` and must confirm independently.
- `required_provider_count` becomes the resulting active team size so aggregate Job status continues to work correctly.

## Financial rules
Every new/replacement Provider keeps an independent frozen Job billing snapshot:

- Qty
- PLEASE Customer Rate
- Provider Rate / Provider compensation
- Customer line total
- Provider line total
- PLEASE Gross Profit

A Provider Rate override still updates only that selected Provider Rate Item for future Jobs. Historical completed/confirmed Job snapshots are not rewritten.

The replaced failed assignment's billing snapshot is removed only after the corrected/new billing rows are successfully created.

## Server safeguards
The Netlify backend independently checks:

- valid active Provider;
- Provider enabled for the Job service;
- 15-minute schedule increments;
- published Provider availability;
- overlap with active `PENDING`/`CONFIRMED` work;
- duplicate Provider selections in the same request;
- duplicate selection of an already-active Provider on the same Job;
- active Provider Rate Items and financial margin acknowledgement.

Partial creation failures attempt to roll back newly created assignments/billing and Provider Rate changes before returning an error.

## Example: Jacqueline
For `PLS-JOB-20260901-FEFF94`, after Sebastian declines, Administration may now:

- keep Sebastian as the corrected Primary Provider; and
- click **+ ADD ANOTHER PROVIDER** and add Fabian;

then send both assignments in one operation while retaining `PLS-JOB-20260901-FEFF94` and its relationship to `PLS-REQ-20260831-A24F18`.

## Database
No SQL migration is required for STEP 15.8.6.3.2.
