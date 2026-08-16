# PLEASE Portal — STEP 8.3

## Financial separation

STEP 8.3 separates three financial layers that must never be mixed:

1. **Customer Revenue** — what PLEASE charges the customer. Invoices use only this value.
2. **Provider Cost** — what the Provider charges PLEASE for completed work.
3. **PLEASE Gross Profit** — Customer Revenue before GST minus Provider Cost.

`job_billing_items` freezes both the customer and provider values at assignment time so later rate changes cannot rewrite historical Jobs.

## Provider Service Rates

The Provider Portal now manages **the Provider's charge to PLEASE**, not the customer selling price.

Provider compensation can be:

- `FIXED_CAD` — fixed CAD amount per billing unit.
- `PERCENT` — percentage of the customer unit price that PLEASE sets when creating the Job.

PLEASE Administration sets the **Customer Rate** separately on each Customer Billing line.

## Provider Payments

A new Administration option, **Provider Payments**, tracks outbound obligations after completed Jobs.

A Provider Payment is created automatically when a Job reaches `COMPLETED` and contains:

- Provider
- Job / work order
- Provider-cost line items
- Total owed to Provider
- `PENDING` or `PAID` status
- Manual payment method/reference/note

The page **does not send money**. It only records whether PLEASE has paid the Provider.

Provider Payments can be exported to CSV or XLSX.

## Financial reports

Administration Reports now includes:

- Customer Revenue
- Provider Charges
- PLEASE Profitability
- Gross Margin

GST is displayed on customer invoices but excluded from gross-profit calculations.

## Existing historical data

Existing invoices are not changed. Existing Job billing items keep their customer values. STEP 8.3 attempts to backfill Provider Cost from the linked Provider Service Rate when enough information exists. Historical items without a determinable Provider Cost are flagged for rate review in Provider Payments.
