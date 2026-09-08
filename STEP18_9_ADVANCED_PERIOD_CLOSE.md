# STEP 18.9 — Advanced Period Close

## Objective
CAL 1.5 now has a controlled accounting-period close workflow rather than relying only on informal month-end review. The close is additive to STEP 17 and the STEP 18 subledgers.

## Core invariants
- A closed period creates an exact `accounting_period_locks` date-range lock.
- New financial source events whose effective accounting date is inside a locked period are rejected at the durable-event boundary.
- Existing POSTED/IGNORED events remain idempotent and are not reopened by recovery.
- The final PostgreSQL journal trigger remains a second line of defence.
- Posted journals remain immutable.
- Close snapshots and close/reopen actions are immutable evidence.
- Hard controls cannot be overridden.
- Review controls require a documented sign-off reason.
- Reopening requires a documented reason and must happen in reverse chronological order.
- Adjusting entries are not direct journal mutations: they are durable STEP 17 source events.
- Reversals are new next-period source events; the original adjustment is never rewritten.

## Checklist controls
### HARD
1. Accounting Engine Queue — no PENDING / PROCESSING / RETRY / ERROR / DEAD_LETTER event.
2. Trial Balance Integrity — period debits equal period credits.
3. Inventory Reconciliation — period-end Inventory subledger equals GL 1600.
4. Fixed Assets Reconciliation — period-end gross/accumulated subledger equals GL 1500/1510.

### REVIEW
5. Bank / Cash / Clearing Reconciliation.
6. Open Source Workflows through period end.
7. Payroll Cutoff.
8. Book Depreciation through period end.
9. GST / HST / QST Review.
10. Missing Expense Evidence.
11. Period Journal Activity / zero-activity confirmation.

A REVIEW item can be signed off with evidence/reason. A HARD blocker cannot.

## Period lifecycle
`DRAFT → IN_REVIEW → READY → CLOSED`

A closed period may be reopened:
`CLOSED → REOPENED → IN_REVIEW → READY → CLOSED (new close version)`

Every close creates an immutable snapshot identified by `period_id + close_version`.

## Durable event cutoff
STEP 18.9 replaces `accounting_enqueue_event(...)` with a backward-compatible hardened version. Before inserting/retrying an unposted financial event it determines the event's effective accounting date and executes `accounting_assert_period_open(...)`.

This prevents the unsafe state:
`business transaction committed → accounting event queued → journal permanently rejected because period was already closed`.

Already-accounted POSTED/IGNORED events return idempotently without being rejected by a later lock.

## Adjusting entries
Period Close provides a native multi-line adjusting-entry workflow. The source row is stored in `accounting_period_adjustments`, then enqueued as:

`PERIOD_CLOSE_ADJUSTMENT_POSTED`

STEP 17 posts the balanced Journal asynchronously. Account codes must be active and allow manual posting.

## Reversals
A posted period adjustment can have at most one controlled reversal. The reversal:
- uses a new open accounting date;
- reverses debit/credit lines;
- creates a new immutable adjustment source row;
- creates a new STEP 17 event;
- never edits or deletes the original Journal.

## Historical subledger controls
STEP 18.9 adds as-of-period-end values for:
- Inventory subledger;
- Fixed Asset gross cost;
- Fixed Asset accumulated depreciation.

This avoids comparing an August close against September's current subledger balances.

## UI
New CAL menu item: **Period Close**.

The workspace contains:
- period selector and close state;
- blocker/review counters;
- automated checklist;
- documented sign-off modal;
- native period adjustments;
- controlled reversals;
- close confirmation (`CLOSE`);
- reopen confirmation (`REOPEN`);
- immutable close/reopen action history and snapshot count.

## Security / custody
New period-close evidence tables are RLS-enabled and accessed by the admin-gated Netlify function using the client-custodied Supabase service role. No bank credentials, tax credentials, SINs, or other new secrets are introduced.

## Scope boundary
STEP 18.9 is the accounting-control close engine. It does not replace STEP 18.10 Accountant & Compliance Center, which will organize accountant packages, GIFI/compliance working papers, filing calendar and broader compliance review.
