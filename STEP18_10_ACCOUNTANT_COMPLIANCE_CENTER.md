# STEP 18.10 — Accountant & Compliance Center

## Scope

Adds a top-level CAL **Accountant & Compliance Center** for year-end working papers, GIFI mapping, compliance calendar, review/approval workflow, immutable filing/payment evidence, and complete accountant package snapshots.

This step is **compliance/control only**. It creates **no accounting journal events** and does not transmit tax returns. STEP 18.11 remains the dedicated cross-module integration review.

## Accountant Package

Each package revision freezes a SHA-256-protected JSON snapshot containing:

- Company/fiscal-year context
- Trial Balance
- Balance Sheet working paper
- Income Statement working paper
- General Ledger detail for the fiscal year
- GIFI working paper
- Period-close evidence
- Bank reconciliation manifest
- Open A/R and A/P
- Inventory detail and Inventory-vs-GL reconciliation
- Fixed Asset register and Fixed-Asset-vs-GL reconciliation
- Payroll runs and T4 working papers
- Payroll/tax GL controls
- Compliance obligations
- Filing/payment/remittance evidence

A package can be generated before year-end close for review, but **approval is blocked** until the year is fully covered by STEP 18.9 period locks, the GIFI paper is approved, the Trial Balance is balanced, and Inventory / Fixed Assets reconcile.

## GIFI

CAL seeds the verified GIFI codes needed by the current CAL Chart of Accounts and provides editable account-to-GIFI mappings. Default mappings are working-paper defaults; accountant review remains required.

Working paper workflow:

`DRAFT → REVIEWED → APPROVED`

Approval requires:

- zero non-zero unmapped GL accounts
- Trial Balance difference <= $0.01
- complete closed-period coverage for the fiscal year

The current Fixed Asset contra account 1510 retains its natural negative balance when mapped to GIFI 1741. Gain/loss account 8210 is aggregated so a book loss is represented as a negative realized gain/loss and is not omitted from net income.

Official basis: CRA RC4088 GIFI, including T2 Schedule 100, 101, 125 and 141.
https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4088/general-index-financial-information-gifi.html

## Compliance Calendar

Supported controls:

- T2 return
- Federal corporate tax balance
- Alberta AT1 return
- Alberta corporate tax balance
- GST/HST return and payment
- Payroll source-deduction remittances
- T4 information return

GST/HST frequency defaults to `UNCONFIGURED`; CAL creates an internal reminder instead of guessing the CRA-assigned reporting frequency.

Corporate balance-due dates default to 2 months. Selecting 3 months requires a documented eligibility basis.

Payroll calendar follows the configured remitter type: Quarterly, Regular, Threshold 1, or Threshold 2. Threshold 2 uses third-working-day calculations and remains flagged for public-holiday review.

Reference sources:
- T2 filing / balance: https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4012/t2-corporation-income-tax-guide-before-you-start.html
- GST/HST reporting deadlines: https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/file-gst-hst-return/reporting-requirements-deadlines.html
- Payroll remittance due dates: https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/remitting-source-deductions/how-when-remit-due-dates.html
- T4 filing: https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/file-information-returns-slip-summaries/when-to-file.html
- Alberta corporate tax / AT1: https://www.alberta.ca/corporate-income-tax

## Filing Evidence

Obligation workflow:

`OPEN → PREPARED → REVIEWED → APPROVED → FILED / PAID`

Evidence is recorded only after the filing/payment/remittance occurs externally. Evidence rows are immutable. Corrections create a **superseding evidence row**; the prior row remains in history.

CAL does not claim electronic filing. Alberta AT1 net filing requires TRA-certified software.

## Security / Data Custody

All STEP 18.10 tables use RLS and browser roles are revoked. The existing PLEASE admin session accesses the data only through same-origin Netlify Functions using the service role. Approval and evidence rows are append-only. Accountant package financial snapshots cannot be rewritten or deleted; regeneration creates a new revision.

## Deployment

1. Run `STEP18_10_ACCOUNTANT_COMPLIANCE_CENTER.sql`.
2. Run `STEP18_10_VERIFY.sql`; expect **36 PASS** rows.
3. Upload only the files in `UPLOAD_ONLY_STEP18_10_ACCOUNTANT_COMPLIANCE_CENTER.txt`, preserving paths.
4. Wait for Netlify `Published`.
5. Open CAL → **Accountant & Compliance**.
6. Confirm Compliance Settings before generating deadlines.
7. Generate calendar / GIFI / package only after checking the company fiscal year and reporting profile.
