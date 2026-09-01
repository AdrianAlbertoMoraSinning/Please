# STEP 15.8.6.3 — Editable Billing on Reassignment

## Purpose
When a Provider declines or PLEASE cancels an assignment, the Job returns to `NEEDS_ASSIGNMENT`. Administration can now correct the replacement assignment before sending it again without creating a second Job.

## Administration workflow
1. Provider declines/cancels the assignment.
2. The existing `PLS-JOB` appears under **Needs Assignment**.
3. **Assign** opens **Correct & Reassign** for that same Job.
4. Customer identity, service and work scope remain read-only to protect the original Job record.
5. Administration may edit the replacement Provider, date, start/end time, billing Rate Item, quantity, PLEASE Customer Rate and Provider Rate. The Provider Rate starts from the selected Provider's current catalog value, while quantity/customer price start from the Job snapshot.
6. Financial totals recalculate before sending: Customer Quote, Provider Cost, PLEASE Gross Profit, GST and customer total.
7. **SEND ASSIGNMENTS** creates a new pending assignment on the same Job and replaces only the frozen billing rows belonging to the declined/cancelled assignment.

## Provider Rate persistence
If Administration changes the Provider Rate/percentage, the new value is saved only to the selected Provider's `provider_service_rates` Rate Item. The change is recorded in Provider technical history and the Provider receives the existing rate-change notification.

## Audit/integrity behavior
- The `PLS-JOB` reference is preserved.
- The linked customer `PLS-REQ` reference is preserved.
- Confirmed/completed assignments belonging to other team members are not edited.
- The replacement assignment inherits the replaced assignment's sequence and Primary flag.
- Old billing rows for the declined/cancelled assignment are removed only after the corrected replacement billing rows are successfully inserted.
- The Job `quoted_subtotal` and estimated duration are recalculated after the correction.
- The server attempts compensation/rollback if billing persistence fails after the replacement assignment is created.

## Database
No SQL migration is required. STEP 15.8.6.3 uses the existing STEP 15.2 / STEP 8.3 fields on `job_assignments`, `job_billing_items`, `jobs`, and `provider_service_rates`.
