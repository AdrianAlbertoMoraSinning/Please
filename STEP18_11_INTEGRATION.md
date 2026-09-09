# STEP 18.11 — Integration

## Purpose
STEP 18.11 closes the event-driven accounting architecture across PLEASE Operations and CAL. It does not introduce a second ledger or direct module-to-journal writes.

## Non-negotiable invariants
1. No accounting side effect without a durable financial event.
2. No durable financial event without the committed business transaction.
3. No journal entry without an idempotent source event.
4. Compliance workflow events do not create journals.
5. Closed-period protection remains enforced at durable-event and journal boundaries.

## Canonical routes
### Financial
`Business Source → please_accounting_outbox → STEP 17 worker → accounting_external_events → accounting_journal_entries`

22 financial contracts are registered across A/R, Stripe, Provider Payments, A/P, Expenses, Inventory, Fixed Assets, Payroll and Period Close.

### Compliance
`Compliance Source → please_domain_events`

The following remain domain-only and never enter the financial outbox:
- GIFI working paper created
- Compliance obligation created
- Compliance approval recorded
- Filing/payment evidence recorded
- Accountant package created

## Contract registry
`accounting_integration_contracts` defines source table, route, producer, posting mode, dependency and worker priority. New PLEASE financial event types cannot enter the outbox unless registered.

## Coverage and exceptions
`accounting_expected_financial_events` represents financial source facts that must have an idempotent durable event key.

`accounting_integration_exceptions()` detects:
- source fact without durable event
- unregistered event type
- source-contract mismatch
- missing producer / posting rule
- dead letter
- stale queue item
- POSTED without CAL external event
- POSTED without journal
- linked journal not POSTED
- IGNORED event with a journal

`accounting_integration_health()` aggregates cross-module health and is used by CAL Integration Health.

## Recovery
The Integration Health page exposes two separate controlled actions:
- **Reconcile Missing Events** — idempotent recovery scan; it only enqueues via STEP 17 and never posts a journal directly.
- **Run Worker Once** — processes currently claimable STEP 17 events.

Dead-letter events can be explicitly requeued. Period locks and source validation are never bypassed.

## Worker ordering correction
STEP 18.11 centralizes worker priorities. `CREDIT_NOTE_ISSUED` now runs after `INVOICE_ISSUED`, and `REFUND_COMPLETED` runs after `CREDIT_NOTE_ISSUED`, avoiding the former default-priority fallback.

## Acceptance boundary
STEP 18.11 is structurally complete when SQL verification and static/runtime regression pass. Production acceptance of zero integration blockers is part of STEP 18.12.
