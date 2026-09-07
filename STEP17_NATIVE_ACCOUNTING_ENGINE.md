# PLEASE STEP 17 — Native Event-Driven Accounting Engine

## Decision

STEP 17 replaces the STEP 16 manual synchronization bridge with a native event-driven accounting engine while preserving the existing PLEASE operational workflows.

The design rule is:

> **No accounting side effect without a durable event. No journal entry without an idempotent source event.**

PLEASE Admin, Provider Portal, Stripe and the public Home continue performing their existing operational responsibilities. They no longer call CAL posting functions directly.

## Architecture

```text
Customer / Admin / Provider / Stripe
                 |
                 v
          PLEASE Operations
                 |
                 v
      PostgreSQL source transaction
                 |
          +------+------+
          |             |
          v             v
 Operational row   Durable financial event
                        |
                        v
                 Accounting Queue
                        |
                        v
                Accounting Worker
                        |
                        v
                Posting Rules Engine
                        |
                        v
                 CAL Accounting Engine
                        |
             +----------+----------+
             |          |          |
             v          v          v
           Journal    Ledger     GST/Tax
                                    |
                                    v
                           Financial Statements
```

The operational row and the durable event are produced by PostgreSQL in the same database transaction. Netlify is **not** the durability layer; if the worker is temporarily unavailable, the event remains in Supabase until it can be processed.

## Required deployment migration

Run, in order:

1. `supabase/STEP16_0_CAL_PLEASE_ACCOUNTING_BRIDGE.sql` if STEP 16 has not already been installed.
2. `supabase/STEP17_NATIVE_ACCOUNTING_ENGINE.sql`.

STEP 17 is additive and idempotent. It upgrades the existing `please_accounting_outbox` rather than replacing accounting history.

## STEP 17 components

### 17.1 Domain Event Ledger

`please_domain_events` is an immutable operational event ledger. It records important business milestones such as customer creation, request creation, job creation, provider assignment and job status changes.

Domain events and accounting events are intentionally separate. A customer or request event may matter operationally without creating a financial journal entry.

### 17.2 Transactional Accounting Outbox

Financial source-table triggers enqueue durable events into `please_accounting_outbox` for:

- `INVOICE_ISSUED`
- `INVOICE_VOIDED`
- `PAYMENT_RECEIVED`
- `STRIPE_FEE_RECORDED`
- `PROVIDER_PAYABLE_CREATED`
- `PROVIDER_PAYMENT_PAID`

The event is created inside the same PostgreSQL transaction that changes the source record.

### 17.3 Durable Queue States

The queue uses explicit lifecycle states:

```text
PENDING
PROCESSING
POSTED
RETRY
IGNORED
DEAD_LETTER
```

`ERROR` is accepted only as a temporary STEP 16 compatibility state during rollout and is claimed by the STEP 17 worker exactly like `RETRY`. New STEP 17 processing never creates `ERROR` outbox rows. A boolean `processed` flag is deliberately not used as the workflow model.

### 17.4 Concurrency-Safe Worker

`cal-accounting-worker` is scheduled by Netlify every minute. It calls the PostgreSQL claim function `accounting_claim_outbox`, which uses `FOR UPDATE SKIP LOCKED` so concurrent workers cannot claim the same event.

The durable event remains in Supabase even if Netlify is unavailable. Stale worker claims are automatically returned to `RETRY`. Claimed events are processed in causal priority (invoice/payable before their payment/reversal/fee children). The scheduled batch defaults to 10 events so it remains conservative within Netlify scheduled-function execution limits.

### 17.5 Automatic Retry and Dead Letter Queue

Failed events use exponential retry. Default maximum attempts: **5** (`CAL_ACCOUNTING_MAX_ATTEMPTS`). Dependency-wait retries do not consume the failure budget, so a child event cannot reach Dead Letter merely because its parent event is still processing.

After the maximum is reached, the event becomes `DEAD_LETTER` and appears on the CAL dashboard as requiring developer review.

A developer recovery RPC exists to requeue a repaired Dead Letter event. This is not exposed as a daily Sync button.

### 17.6 Idempotency and Versioning

Each financial event has a stable event key:

```text
PLEASE:<EVENT_TYPE>:<SOURCE_RECORD_ID>
```

Controls include:

- unique `event_key` in the outbox;
- unique `(source_system, source_event_id)` in `accounting_external_events`;
- unique source reference on the journal entry;
- SHA-256 payload hash;
- `event_version`;
- correlation and causation identifiers.

Duplicate Stripe webhook activity or repeated source updates therefore cannot create duplicate journals.

### 17.7 Posting Rules Engine

`accounting_posting_rules` is now read by the worker. Posting configuration remains centralized instead of being distributed across Admin/Stripe action handlers.

Current automatic rules preserve the STEP 16 accounting treatment:

#### Invoice issued

```text
Dr Accounts Receivable
   Cr Service Revenue
   Cr GST/HST Payable
```

#### Stripe customer payment

```text
Dr Stripe Clearing
   Cr Accounts Receivable
```

#### Stripe fee

```text
Dr Merchant / Bank Fees
   Cr Stripe Clearing
```

#### Manual payment

```text
Dr Operating Bank
   Cr Accounts Receivable
```

#### Provider payable — Independent Provider

```text
Dr Subcontractors Expense
   Cr Provider Payable
```

#### Provider payment

```text
Dr Provider Payable
   Cr Operating Bank
   Cr Provider Advances (when applied)
```

PLEASE Staff costs remain intentionally outside subcontractor accounting and are marked `IGNORED` with an audit reason pending a payroll/accountant workflow.

## Refunds and credit notes

STEP 17 does **not** invent accounting treatment for a workflow that PLEASE does not yet have.

If a legacy `payment_transactions` row changes to `REFUNDED`, STEP 17 records an immutable domain event named `PAYMENT_REFUNDED_REQUIRES_ACCOUNTING_REVIEW`, but does not automatically reverse revenue, GST or receivables without a dedicated refund/credit-note source document and allocation model.

This is intentional accounting safety. A future Refund/Credit Note module can emit versioned financial events without redesigning the engine.

## Journal immutability and reversals

Posted journals and their lines are immutable. Corrections use a separate reversal journal. Journal header creation, line insertion, balance validation, POSTED transition and external-event linkage are committed by `accounting_post_event_journal(...)` in one PostgreSQL transaction, eliminating partial-DRAFT crash windows.

`accounting_reverse_journal_entry(...)` creates a new posted entry with opposite debits/credits and links it through `reversal_of`. The original journal remains unchanged.

## CAL Dashboard

The manual **Sync PLEASE Accounting** button is removed. Issued invoices are also financially locked in PLEASE Admin; corrections use void/reissue (and a future credit-note workflow) instead of silently changing amounts already posted to CAL.

The dashboard now reports:

- Engine status
- Processed today
- Pending
- Retrying
- Dead Letter
- Average processing time
- Oldest pending event
- Last accounting event

The health state becomes `DEGRADED` if retries exist or the oldest unprocessed event has waited more than five minutes, and `ACTION_REQUIRED` when any event reaches Dead Letter.

Normal operation requires no accounting action from the administrator.

## Recovery

`cal-accounting-recovery` and the old `cal-accounting-sync` URL are retained only as protected server-side recovery tools. The old Sync endpoint is a compatibility shim and is not linked from CAL.

Recovery scans source records and recreates **missing queue events only**. It does not bypass event idempotency or post journals directly.

## Environment variables

Existing CAL/Supabase variables remain in use.

Optional STEP 17 variables:

- `CAL_INTEGRATION_ENABLED=true|false` — default `true`
- `CAL_ACCOUNTING_WORKER_LIMIT=10` — events claimed per scheduled worker run, max 100
- `CAL_ACCOUNTING_MAX_ATTEMPTS=5` — retry attempts before Dead Letter, max 20
- `CAL_ACCOUNTING_STALE_MINUTES=10` — stale PROCESSING claim timeout

## Deployment order

To avoid any interval in which synchronous STEP 16 hooks have already been removed but STEP 17 database triggers are not yet installed, use this order:

1. While the currently working STEP 16 site remains online, run `supabase/STEP17_NATIVE_ACCOUNTING_ENGINE.sql` in the existing PLEASE Supabase project. The migration is additive and the old STEP 16 code remains compatible during this short overlap.
2. Upload/deploy the complete STEP 17 repository to GitHub/Netlify.
3. Confirm the PLEASE Home, Admin and Provider portals remain healthy.
4. Confirm Netlify lists `cal-accounting-worker` as Scheduled.
5. Wait for the scheduled worker to run (or use Netlify **Run now** for this scheduled function during deployment verification).
6. Open `/cal/dashboard.html`.
7. Confirm `Accounting Engine = HEALTHY` and `Dead Letter = 0`.
8. Test one new invoice issue and confirm one `INVOICE_ISSUED` queue event and exactly one journal entry.
9. Test one manual or Stripe payment and confirm one payment journal per source event.
10. Confirm no Sync button appears anywhere in CAL.

## Rollback principle

STEP 17 intentionally leaves STEP 16 accounting tables/history intact. If the worker is disabled with `CAL_INTEGRATION_ENABLED=false`, PLEASE operations continue and no synchronous accounting call blocks the customer/admin workflow.

Do not delete the outbox or external-event ledger during rollback. They are recovery/audit evidence.

## Scope boundary

STEP 17 establishes the accounting core needed for future modules. It does not claim that PLEASE is already a complete ERP or that CAL files tax returns. Inventory, payroll, fixed assets, advanced AP, bank feeds, credit notes/refunds and statutory filings remain separate future modules.
