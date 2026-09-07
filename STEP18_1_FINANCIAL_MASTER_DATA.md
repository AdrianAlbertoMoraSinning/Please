# STEP 18.1 — Financial Master Data

## Purpose

STEP 18.1 creates the master-data layer required for Purchases/AP, advanced expenses, bank reconciliation, inventory, fixed assets, payroll and compliance work in later STEP 18 iterations.

This step is deliberately **non-posting**: it does not create vendor bills, expenses, refunds, bank transactions, payroll, inventory movements or journal entries.

## What is added

### Business Partner Master

A single `accounting_parties` identity can carry one or more roles:

- CUSTOMER
- OPERATIONAL_PROVIDER
- SUPPLIER
- EMPLOYEE
- CONTRACTOR
- OTHER

`accounting_party_roles` stores the role assignments independently from the identity.

### PLEASE source protection

Existing PLEASE `customers` and `providers` remain the operational source of truth. STEP 18.1 creates linked CAL party records through best-effort database triggers.

The source sync trigger catches all synchronization errors and returns the original operational row, so a CAL master-data problem cannot block a valid PLEASE customer/provider transaction.

CAL may add financial roles to a source-managed party (for example, an Operational Provider may also be a Supplier), but the CAL UI/API does not edit the PLEASE-managed identity.

### Legacy CAL contacts

`accounting_contacts` remains in place for backward compatibility. It receives an optional `party_id` link to the new Business Partner Master, so existing invoice/expense foreign keys are not rewritten.

### Financial account registry

`accounting_financial_accounts` stores the identity/configuration of:

- BANK
- CASH
- CREDIT_CARD
- CLEARING
- LOAN
- OTHER

Each record maps to one General Ledger account. **Balances are not stored here**; balances remain ledger-derived.

The existing Operating Bank (`1000`) and Stripe Clearing (`1090`) are registered automatically when present.

### Chart of Accounts hardening

The current STEP 17 posting accounts are marked `system_managed`. Their code, account type and active status are protected from destructive edits. Custom accounts may be created without changing STEP 17 posting rules.

### Tax-code master

Existing Canadian seed tax codes are marked `system_managed`. New tax codes can be added for future effective periods rather than overwriting historical configuration.

### Audit trail

Master-data tables receive database-trigger audit entries. The CAL master-data API also attempts an actor-aware audit entry containing the PLEASE Admin user, IP and user agent.

## User interface

CAL gains **Financial Master Data** in the sidebar. The screen contains:

- Business Partners and role management
- Financial Accounts
- Chart of Accounts master controls
- Tax Code master controls

PLEASE-sourced Customers/Providers display as `Managed by PLEASE` and expose role management instead of identity editing.

## What STEP 18.1 explicitly does NOT do

- no Purchases / Vendor Bills
- no new Accounts Payable transactions
- no Credit Notes or Refund posting
- no advanced Expense workflow
- no Bank Reconciliation
- no Inventory transactions
- no Fixed Asset depreciation / CCA
- no Payroll
- no Period Close changes
- no new STEP 17 financial event types

Those belong to later STEP 18 iterations and must not be started until STEP 18.1 is deployed and accepted.

## Deployment order

1. Keep the current STEP 17 production baseline available as rollback reference.
2. Run `supabase/STEP18_1_FINANCIAL_MASTER_DATA.sql` in the PLEASE Supabase SQL Editor.
3. Confirm `Success. No rows returned` (warnings from optional source-row backfill should be reviewed if any appear).
4. Upload the STEP 18.1 code package to GitHub, preserving folders.
5. Wait for Netlify `Published`.
6. Smoke-test existing Home / Admin / Provider / Service Request / Payment / CAL Dashboard.
7. Open CAL → Financial Master Data and verify Customers/Operational Providers appear as PLEASE-managed parties.
8. Create one test Supplier and one non-posting Financial Account configuration, then verify the Audit Trail.
9. Only after acceptance proceed to STEP 18.2 Purchases & Accounts Payable.

## Rollback principle

STEP 18.1 is additive. Existing operational tables, existing STEP 17 event processing, journals and provider payment flows are not replaced. If the new UI is rolled back, the new master-data tables can remain dormant without affecting STEP 17 accounting automation.
