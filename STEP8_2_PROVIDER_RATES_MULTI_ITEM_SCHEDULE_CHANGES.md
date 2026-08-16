# PLEASE Portal — STEP 8.2

## Scope

STEP 8.2 replaces the single-rate STEP 8.1 model for all new Jobs while preserving historical Jobs and invoices.

### Provider Service Rates
Each activated Provider can maintain multiple active rate items across every service assigned to that Provider. Example: a Provider whose profile includes Cleaning, Junk Removal and Labour can maintain rates under all three services.

The Provider Portal now includes **My Service Rates**. Each rate stores:
- Assigned Service
- Rate / Item Name
- Description
- Billing Unit
- Customer Rate
- Optional Provider Compensation
- Active / inactive state

Changing a Provider catalog rate affects future assignments only.

### Multi-item Customer Billing
In **PLEASE Admin → Master Calendar → New Job Assignment**, the primary Job Service still determines which Providers are eligible for the Job. After a Provider is selected, **Customer Billing** shows all active Service Rates owned by that Provider, regardless of the primary Job Service.

PLEASE can add multiple rate lines to one Job, edit quantity/rate for the specific customer agreement, and see Subtotal, GST 5% and estimated customer total.

Each selected line is copied into `job_billing_items`. These are frozen snapshots. Later catalog changes do not alter previously assigned Jobs.

When the Job becomes COMPLETED and an Invoice is created, every `job_billing_items` row is copied automatically into `invoice_items`. Existing STEP 8.1 Jobs fall back to their historical single-rate fields.

### Provider Schedule Change Requests
For PENDING or CONFIRMED assignments, the Provider can choose **PROPOSE SCHEDULE CHANGE** and enter a new date/start/end plus a message.

This creates a request only. It does not move the booking unilaterally.

PLEASE Administration sees the request from the Master Calendar and can **ACCEPT CHANGE** or **REJECT CHANGE**. On acceptance, the assignment schedule and Job duration are updated. Customer Billing lines are intentionally not modified automatically; commercial quantities remain under PLEASE control.

The proposed window cannot overlap another active PLEASE assignment for the same Provider. A Provider proposal itself is treated as an explicit declaration that the proposed time can work, even if it is outside the normal weekly availability template; PLEASE makes the final decision.

## Database
Run once before deploying the updated frontend/functions:

`supabase/STEP8_2_PROVIDER_RATES_MULTI_ITEM_SCHEDULE_CHANGES.sql`

Existing invoices are not modified. Existing STEP 8.1 Jobs with a legacy customer rate are copied into one `job_billing_items` snapshot if they do not already have detail rows.

## Test sequence
1. Provider Portal → My Service Rates: add at least two rates, preferably under different assigned Services.
2. Admin → Master Calendar → New Job Assignment: choose the Job's primary Service and Provider.
3. Confirm Customer Billing shows all active rates for that Provider, including rates from the Provider's other assigned Services.
4. Add multiple billing items and send the assignment.
5. Provider confirms or proposes a schedule change.
6. Admin accepts/rejects the proposed schedule change.
7. Complete the Job.
8. Admin → Invoices → New Invoice: select the completed Job and verify all frozen Job billing lines are prefilled automatically.
