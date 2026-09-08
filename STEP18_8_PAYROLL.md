# STEP 18.8 — Payroll (Alberta Core)

STEP 18.8 adds controlled Alberta payroll to CAL without changing PLEASE operational workflows.

## Scope

- Payroll Employee Register linked to Financial Master Data `EMPLOYEE` role.
- Hourly and salary employees.
- Weekly, biweekly, semi-monthly and monthly regular periodic payroll.
- Versioned 2026 CRA T4127/T4032 Alberta parameters.
- CPP, CPP2, EI, federal tax and Alberta tax calculations for regular periodic pay.
- Employer CPP/CPP2 and EI expense.
- Pay Run workflow: `DRAFT → REVIEW → APPROVED → POSTED → PAID`.
- Payroll liabilities and STEP 17 automatic journals.
- Source-deduction remittance tracking.
- T4 working papers (Boxes 14, 16, 16A, 18, 22, 24 and 26).
- Audit trail and immutable posted payroll evidence.

## Privacy boundary

CAL does **not** store a full Social Insurance Number. Payroll profiles retain only:

- `sin_on_file`
- `sin_last4`
- secure-document reference
- federal TD1 document reference
- Alberta TD1 document reference

The employer remains responsible for secure custody of the complete employee identity records required for payroll/information-return compliance.

## 2026 parameter baseline

The migration seeds effective-dated parameter sets for the CRA T4127 January 2026 and July 2026 releases. It includes the 2026 CPP/CPP2 and EI annual limits/rates plus federal and Alberta brackets and default TD1 reference amounts.

Parameters are selected by **payment date**, so future years/releases can be added without rewriting historical payroll calculations.

## Calculation boundary

Automatic calculation is intentionally limited to **Alberta regular periodic salary/wages**. The engine supports regular hours, overtime earned in the current period, ordinary regular earnings, taxable benefits, allowable tax-deductible deductions, and after-tax deductions.

Bonuses, commissions, retroactive payments, transfers between provinces, unusual benefits, special CPP situations or other complex cases require CRA PDOC/accountant verification. CAL provides a documented income-tax override field for those cases. The override reason/reference is retained in the payroll line audit evidence.

## Accounting

### Payroll posting

- Dr `7000` Wages & Salaries Expense — gross pay
- Dr `7010` Employer CPP / CPP2 Expense
- Dr `7020` Employer EI Expense
- Cr `2030` Payroll Payable — net pay
- Cr `2040` CPP / CPP2 Payable — employee + employer shares
- Cr `2050` EI Payable — employee + employer shares
- Cr `2060` Payroll Income Tax Payable
- Cr `2070` Other Payroll Deductions Payable, when present

### Payroll payment

- Dr `2030` Payroll Payable
- Cr selected Bank/Cash/Clearing account

### CRA source-deduction remittance

- Dr `2040` CPP / CPP2 Payable
- Dr `2050` EI Payable
- Dr `2060` Payroll Income Tax Payable
- Cr selected Bank/Cash/Clearing account

`2070 Other Payroll Deductions Payable` is not included in CRA source-deduction remittances. Employer-specific benefit/garnishment/other-deduction settlement remains a separate accounting obligation.

## Remitter due-date guidance

CAL stores the CRA-assigned remitter type (`QUARTERLY`, `REGULAR`, `THRESHOLD_1`, `THRESHOLD_2`) and provides due-date guidance. The organization must confirm its CRA-assigned frequency and apply CRA weekend/public-holiday rules. The guidance is not a substitute for My Business Account/CRA notices.

## T4 working papers

CAL aggregates POSTED/PAID payroll for a tax year into working papers. It does **not** directly file T4 information returns. Complete employee identity, slip validation, distribution and electronic filing remain through the employer/accountant's CRA-compatible filing process.

## STEP 17 events

- `PAYROLL_POSTED`
- `PAYROLL_PAID`
- `PAYROLL_REMITTANCE_PAID`

They use the existing durable queue, idempotency, retry/dead-letter handling and transactional journal posting.

## Deployment order

1. Run `STEP18_8_PAYROLL.sql` in the existing PLEASE Supabase project.
2. Run `STEP18_8_VERIFY.sql` and require all controls to show `PASS`.
3. Upload the STEP 18.8 `UPLOAD_ONLY` package to GitHub preserving folders.
4. Wait for Netlify `Published`.
5. Perform a controlled payroll smoke test before using live payroll.

## Treasury integration
STEP 18.8 extends STEP 18.5 Daily Cash Position without creating a second ledger. Posted but unpaid net payroll is included by payment date. Unremitted CPP/CPP2/EI/income-tax source deductions are allocated FIFO against paid remittances and included only when their CRA remitter-type due date falls inside the Today / 7-day / 30-day horizon. This is a treasury forecast/control, not a substitute for CRA remittance account statements or accountant review.
