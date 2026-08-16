# STEP 8.1 — Job Billing Data → Automatic Invoice Prefill

This patch closes the billing-data gap found during STEP 8 testing.

## New Job workflow
PLEASE Admin now captures the customer billing model when creating the Job:
- Billing Type: Hourly or Flat Rate
- Customer Rate (CAD)
- Billable Quantity (automatically derived from the selected schedule for hourly work; 1 service for flat-rate work)
- Estimated customer subtotal before GST

These values belong to the customer-facing Job and are intentionally separate from a provider response or requested provider rate.

## Invoice workflow
When a completed Job is selected for invoicing, the draft invoice now prefills:
- service description
- quantity
- unit
- customer rate
- subtotal
- GST 5%
- total
- invoice/due date

The draft remains editable before ISSUE INVOICE. Historical Jobs without billing data continue to work and can be priced manually. Existing invoices are not changed.

## Additional protections
- Prevents creating a second non-void invoice for the same Job on the backend.
- Billing data is stored server-side on the Job after secure Admin creation.
- Provider responses never overwrite customer billing.
