# STEP 19 — PLEASE Operational Finance Automation

Baseline: **STEP 18.12.1 — Regression & Acceptance**.

STEP 19 adds an operational finance layer to PLEASE Administration without replacing STEP 17/18 accounting. The normal operator records business facts; PLEASE maps and posts accounting through the existing controlled engines. Technical accounting remains under Advanced Accounting / CAL.

## Authorized operational changes

1. **PLEASE Staff daily shift** — one Daily Check In on the first confirmed service of the local Edmonton workday and one Daily Check Out after the final scheduled service. `ARRIVE → START → COMPLETE` remains per service. A one-service day contains both Daily Check In and Daily Check Out. Independent Provider workflow is unchanged.
2. **Photo reliability** — smaller gateway-safe preparation, compact retry after HTTP 413, explicit preparing/uploading phases, single-flight action locking, network timeout/retry and clearer lifecycle/storage errors.
3. **Completion refresh recovery** — a successful server completion is treated as authoritative even if the subsequent dashboard refresh is delayed; the UI refreshes/reloads instead of inviting an unsafe second completion.
4. **Service Maintenance classification** — Administration can edit Service Type. Linked Request/Job classification is synchronized transactionally. Existing inactive historical classifications may remain but cannot be newly selected.
5. **Legacy Pay Now** — the obsolete free-form `mailto:`/Outlook behavior is removed. Payments remain tied to tracked PLEASE work/invoices and the existing Stripe/customer payment controls.

## Operational Finance in Administration

The new **Finance** module provides daily surfaces for:

- Sales & Collections
- Expenses
- Purchases & Payables
- Payments
- Bank & Cash
- Finance Exceptions
- Automation Status
- Advanced Accounting / CAL

The daily Admin interface does not ask an operator for GL accounts, debit/credit direction, posting rules, GIFI mappings or manual journals.

### Expenses

The operator selects a business category, date, description, amount, payment source and receipt. Business categories are mapped internally. Ambiguous `Other / Needs Review` facts become a Finance Exception rather than a guessed journal.

### Purchases & Payables

Supplier invoices/receipts are captured as business documents, then finalized through the existing controlled Purchase/A/P engine. Evidence is required before the finance action is finalized.

### Sales automation

`Job COMPLETED → operational_finance_queue → Invoice DRAFT → existing STEP 17 accounting when issued`.

The queue uses a unique event key and existing invoice-by-job detection to make retries idempotent. Deployment does not backfill historical invoices automatically.

Safe defaults:

- Auto-create invoice DRAFT: **ON**
- Auto-issue invoice: **OFF**
- Auto-email invoice: **OFF**

Issue/send remains a commercial decision unless Administration deliberately enables those options later.

### Bank & Cash

PLEASE exposes operational bank/reconciliation status from the existing treasury subsystem. A physical Cash Count can be recorded for a configured CASH financial account. A variance creates a Finance Exception; STEP 19 does **not** invent an adjustment journal.

## Accounting boundary

STEP 19 does not replace CAL/STEP 17/18. It sits above them:

`Real business fact → Operational Finance Layer → existing controlled subledger/event engine → STEP 17 Journal → Ledger → Reports / Compliance`.

The following remain legitimate human controls rather than artificial “zero-touch” automation: approving/issuing invoices where policy requires review, confirming external money movement, resolving bank exceptions, payroll approvals/remittances, tax filing/sign-off and period close.

## Deployment

1. Confirm current production is the accepted STEP 18.12.1 baseline.
2. In Supabase SQL Editor run `supabase/STEP19_OPERATIONAL_FINANCE_AUTOMATION.sql` once.
3. Run `supabase/STEP19_VERIFY.sql`; require **20 PASS / 0 FAIL** and `STEP 19 DATABASE READY`.
4. Upload the STEP 19 application files or deploy the FULL release.
5. Wait for Netlify **Published**.
6. Hard-refresh Administration.
7. On Provider mobile/PWA, close/reopen or refresh so the STEP 19 service-worker cache replaces the older cache.
8. Perform the manual production smoke checks below.

## Manual production smoke checks

- PLEASE Staff with 2+ same-day services: Check In appears only at first service; middle services use Arrive/Start/Complete; Check Out appears only after final service completion.
- PLEASE Staff with one service: Check In → Arrive → Start → Complete → Check Out.
- Independent Provider: no staff Daily Check In/Out requirement.
- Upload a normal phone photo and a deliberately large phone photo; confirm no 413 terminal failure and no duplicate action from repeated taps.
- Complete a disposable Job and confirm the portal does not remain incorrectly actionable as `Proceed` after the server has completed it.
- Edit Service Type in Service Maintenance and confirm linked Request/Job consistency.
- Confirm `payment.html` no longer opens Outlook and that tracked Stripe/invoice payment remains unchanged.
- Open Finance → Expenses and record a disposable draft/recovery test with receipt; confirm no GL/debit-credit fields are exposed.
- Complete a disposable billable Job and confirm exactly one operational finance queue item and at most one non-void invoice for that Job.
- Confirm the automatic invoice remains `DRAFT` unless Auto-Issue was explicitly enabled.

## Regression gate

The STEP 19 release package passed the full Node regression suite including all retained historical gates and new STEP 19 gates. See `STEP19_REGRESSION_REPORT.md` and `STEP19_SHA256_MANIFEST.txt`.
