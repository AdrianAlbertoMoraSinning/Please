# PLEASE STEP 16.0 — CAL 1.5 Accounting Bridge

## Purpose

This step connects CAL 1.5 to the PLEASE portal as an independent accounting portal while keeping the operational portal and the accounting ledger separated by design.

The accounting rule is:

> PLEASE generates validated financial events. CAL receives those events, applies idempotency controls, and posts balanced accounting entries.

CAL does not replace professional accountant review, payroll compliance, GST/HST filing, or CRA submissions. It creates structured accounting records and audit evidence for review/export.

## User-facing result

A new portal entry is available in the PLEASE Admin sidebar:

- `CAL Accounting`

The CAL portal is served under:

- `/cal/dashboard.html`
- `/cal/invoices.html`
- `/cal/expenses.html`
- `/cal/journal.html`
- `/cal/taxes.html`
- `/cal/reports.html`
- `/cal/accounts.html`
- `/cal/audit.html`
- `/cal/disclaimer.html`

The portal is independent visually and functionally from Admin, Provider and Developer. It is not embedded as an iframe.

## Security model

- CAL pages contain no database secrets.
- CAL data APIs require the existing secure PLEASE Admin session.
- Sensitive accounting tables are denied to browser roles through RLS/revokes.
- Accounting events are created server-side only.
- If the accounting schema is not installed yet, PLEASE operational actions continue; the accounting sync reports a schema-missing condition instead of breaking the customer workflow.
- Posted journal entries are not edited silently. Corrections must be handled by reversal/adjustment workflow.

## Required SQL

Run this migration in Supabase SQL editor before relying on automatic accounting:

- `supabase/STEP16_0_CAL_PLEASE_ACCOUNTING_BRIDGE.sql`

This creates or updates:

- `accounting_company`
- `accounting_accounts`
- `accounting_tax_codes`
- `accounting_invoices`
- `accounting_invoice_lines`
- `accounting_payments`
- `accounting_expenses`
- `accounting_journal_entries`
- `accounting_journal_lines`
- `accounting_period_locks`
- `accounting_legal_acceptances`
- `accounting_external_events`
- `please_accounting_outbox`
- `accounting_posting_rules`

It also adds optional Stripe reconciliation fields to `payment_transactions`:

- `stripe_charge_id`
- `stripe_receipt_url`
- `stripe_balance_transaction_id`
- `stripe_fee_amount`
- `stripe_net_amount`

## Environment variables

No new variable is strictly required for the initial PLEASE-owned accounting deployment because the bridge uses the existing PLEASE Supabase server credentials from the current Netlify Functions environment.

Optional variables:

- `CAL_INTEGRATION_ENABLED=true|false` — default is enabled.
- `CAL_LEGAL_COPY_EMAIL` — default copy email is configured for Lottus.

## Automatic postings implemented

### Invoice issued

When a PLEASE invoice is issued:

```text
Dr 1100 Accounts Receivable      invoice total
    Cr 4000 Service Revenue      subtotal
    Cr 2100 GST/HST Payable      GST/HST amount
```

### Payment received — Stripe

When Stripe webhook confirms a payment:

```text
Dr 1090 Stripe Clearing / Undeposited Funds      payment total
    Cr 1100 Accounts Receivable                  payment total
```

If Stripe fee data is available:

```text
Dr 5700 Merchant / Bank Fees      Stripe fee
    Cr 1090 Stripe Clearing       Stripe fee
```

### Payment received — manual

When Admin records a manual payment:

```text
Dr 1000 Operating Bank            payment total
    Cr 1100 Accounts Receivable   payment total
```

### Invoice voided

When an unpaid issued invoice is voided:

```text
Dr 4000 Service Revenue           subtotal
Dr 2100 GST/HST Payable           GST/HST amount
    Cr 1100 Accounts Receivable   invoice total
```

### Provider payable created

When a provider payable exists for completed work and the worker classification is `Independent Provider`:

```text
Dr 5000 Subcontractors Expense    provider amount
    Cr 2010 Provider Payable      provider amount
```

### Provider payment paid

When Admin marks an Independent Provider payment as paid:

```text
Dr 2010 Provider Payable          provider amount
    Cr 1000 Operating Bank        cash paid
    Cr 1300 Provider Advances     advance applied, if any
```

## Idempotency controls

Each source event receives a stable event key:

```text
PLEASE:<EVENT_TYPE>:<SOURCE_RECORD_ID>
```

The bridge records the event in:

- `please_accounting_outbox`
- `accounting_external_events`

A duplicate Stripe webhook, repeated Admin save, or manual sync run cannot post the same journal entry twice because `accounting_external_events` and `accounting_journal_entries` enforce source uniqueness.

## PLEASE Staff accounting hold

If a payment record belongs to a `PLEASE Staff` worker, STEP 16.0 records a held/ignored accounting event rather than posting it as subcontractor expense. Payroll, statutory deductions and remittances are outside this bridge and must be handled by a proper payroll/accountant workflow.

## Manual sync / recovery

The CAL dashboard includes:

- `Sync PLEASE Accounting`

This calls:

- `/.netlify/functions/cal-accounting-sync`

The sync scans existing operational records and posts any missing accounting entries for:

- issued/sent/overdue/paid/void invoices;
- succeeded payment transactions;
- provider payables;
- paid provider payments.

## Legal acceptance

CAL keeps the Disclaimer & Data Custody screen under `/cal/disclaimer.html`.

In connected mode, acceptance is stored server-side in `accounting_legal_acceptances` and a copy notification is sent to Lottus through the existing PLEASE email infrastructure.

## Canadian accounting boundaries

This implementation posts accounting entries for operational events. It does not automatically submit GST/HST returns, payroll remittances, ROE, T4, T4A, corporate tax returns, bank-feed credentials, or CRA filings.

Before production reliance, a CPA/bookkeeper should confirm:

- chart of accounts mapping;
- GST/HST registration number and filing period;
- province/place-of-supply assumptions;
- opening balances;
- provider classification treatment;
- period-close workflow;
- payout reconciliation workflow.

## Deployment checklist

1. Upload the ZIP to GitHub.
2. Wait for Netlify deploy.
3. Run `supabase/STEP16_0_CAL_PLEASE_ACCOUNTING_BRIDGE.sql` in Supabase.
4. Confirm Netlify has current production variables.
5. Open PLEASE Admin.
6. Click `CAL Accounting`.
7. Accept CAL Disclaimer if prompted.
8. Click `Sync PLEASE Accounting`.
9. Review CAL Journal and Audit Trail.
10. Test a small invoice issue + Stripe/manual payment and confirm exactly one journal entry per event.
