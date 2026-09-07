# STEP 18.4 — Advanced Expense Workflow

This iteration adds controlled direct expense and reimbursement processing on top of STEP 17/18.1–18.3.

## Scope
- Direct company-paid expenses (bank / cash / credit card / other configured financial account).
- Employee / contractor reimbursement expenses.
- DRAFT → SUBMITTED → APPROVED → POSTED / PAID workflow.
- Supporting receipt/invoice attachment or documented receipt waiver before submission.
- Line-level Expense / Prepaid / Fixed Asset / Inventory classification.
- Effective-dated Canadian tax codes with FULL / PARTIAL / NONE / MANUAL ITC eligibility.
- Non-recoverable tax capitalized/expensed to the selected line account.
- STEP 17 durable events `EXPENSE_POSTED` and `EXPENSE_REIMBURSEMENT_PAID`.
- Read-only continuity for existing Operational Provider expense mirrors.

## Boundaries
Supplier invoices on credit remain in **Purchases & A/P (STEP 18.2)**. Operational service Provider payments remain in PLEASE Provider Payments. Inventory subledger and Fixed Asset register are not created here; those classifications prepare the GL treatment for STEP 18.6/18.7.

## Posting
Company paid:
- Dr selected expense/asset account (subtotal + non-recoverable tax)
- Dr GST/HST/QST Recoverable (recoverable tax)
- Cr mapped bank/cash/card account

Reimbursement expense posting:
- Dr selected expense/asset account
- Dr recoverable tax
- Cr 2020 Employee / Contractor Reimbursements Payable

Reimbursement payment:
- Dr 2020 Employee / Contractor Reimbursements Payable
- Cr mapped financial account

## Deployment order
1. Run `supabase/STEP18_4_ADVANCED_EXPENSE_WORKFLOW.sql`.
2. Run `supabase/STEP18_4_VERIFY.sql` and require every row to be PASS.
3. Upload STEP 18.4 runtime files to GitHub / Netlify.
4. Smoke-test a small company-paid expense and one reimbursement workflow.
5. Confirm Accounting Engine HEALTHY and Trial Balance BALANCED.

Do not proceed to STEP 18.5 until STEP 18.4 acceptance is complete.
