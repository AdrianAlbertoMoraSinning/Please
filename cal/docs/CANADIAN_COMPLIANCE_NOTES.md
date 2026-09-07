# Canadian compliance design notes — CAL 1.5

This is a software design baseline, not tax/legal advice.

## Records
CRA guidance generally requires businesses to maintain adequate books and records and retain many business/tax records for at least six years. Electronic records must remain electronically readable. The platform therefore uses a minimum retention setting of six years, exportability, source-document storage, and an audit-trail architecture.

## Location / custody
The deployment model intentionally keeps each customer's records inside that customer's designated infrastructure. When choosing cloud region and contractual terms, verify current CRA and privacy requirements applicable to that client and data category.

## Sales tax
Tax codes are effective-dated and accountant-editable. Never assume the business charges tax solely from its home province: place-of-supply, registration, zero-rated/exempt supplies, ITC eligibility and special provincial rules can change the result.

## Filing
CAL 1.5 prepares accounting/tax working totals only. It does not represent that a return has been filed, accepted or assessed by CRA or Revenu Québec.

## Banking
Do not store online banking usernames/passwords. Future bank-feed integrations must use an appropriate authorized provider/OAuth-like flow and should store only the minimum tokens/identifiers required.

## Payroll
Payroll calculations/remittances, T4/T4A/ROE workflows and statutory deductions are outside the CAL 1.5 live filing scope.
