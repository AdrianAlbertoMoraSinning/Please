# STEP 18.7 — Fixed Assets

## Scope
Adds a controlled Fixed Asset subledger to CAL without changing PLEASE operational workflows.

### Included
- Fixed Asset Register with immutable source cost.
- Automatic Pending Setup intake from posted Supplier Bills / Advanced Expenses using GL 1500.
- Opening/migration assets with opening accumulated depreciation.
- Straight-line book depreciation using a full-month convention.
- Posted depreciation runs routed through STEP 17.
- Controlled disposals with book gain/loss.
- Gross asset / accumulated depreciation subledger-to-GL controls.
- CRA CCA class reference master and annual UCC working papers.
- CCA claim remains separate from book depreciation and requires accountant review.

### Not included
- Tax filing to CRA.
- Automatic determination of special first-year CCA deductions, passenger-vehicle prescribed limits, recapture, terminal loss, or elections.
- Payroll (STEP 18.8).
- Period Close (STEP 18.9).
- Accountant & Compliance Center (STEP 18.10).

## Book accounting
Source-backed acquisitions are already posted by Purchases/A/P or Advanced Expenses and therefore do **not** create a second acquisition journal.

Opening/migration asset:
- Dr 1500 Equipment & Vehicles — gross cost
- Cr 1510 Accumulated Depreciation — opening accumulated depreciation
- Cr 3000 Owner Equity / Retained Earnings — opening NBV

Book depreciation:
- Dr 6200 Depreciation Expense
- Cr 1510 Accumulated Depreciation

Disposal:
- Dr Bank/Cash/Clearing — proceeds, if any
- Dr 1510 Accumulated Depreciation — clear accumulated depreciation
- Dr 6300 Loss on Disposal — if NBV exceeds proceeds
- Cr 1500 Equipment & Vehicles — remove historical cost
- Cr 4050 Gain on Disposal — if proceeds exceed NBV

## CCA / tax treatment
Book depreciation and Tax CCA are intentionally separate.

CAL stores CCA class, tax capital cost, UCC continuity, additions, disposition reductions and the accountant-entered CCA claim. The displayed prescribed-rate reference is not an automatic filing amount. Special first-year measures, zero-emission rules, passenger-vehicle limits, recapture and terminal loss remain flagged for professional review.

## Controls
- Source lines are unique/idempotent.
- Source-backed asset cost cannot be rewritten by CAL setup.
- Depreciation policy cannot be changed after posted depreciation exists.
- Posted depreciation is immutable.
- Disposal is one-time and becomes immutable through asset status + audit trail.
- Gross 1500 and accumulated 1510 are reconciled to the Fixed Asset subledger.
- Browser roles have no direct table access; Netlify service-role functions mediate writes.
