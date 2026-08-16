# STEP 8.2.1 — Service Rate UI + Compensation Model

This release refines the Provider Portal **My Service Rates** workflow without changing the existing Job assignment, multi-item Customer Billing, invoice, or schedule-change flows.

## Compensation model

Each provider service rate now explicitly defines one of three compensation methods:

- `NONE` — compensation has not been configured.
- `FIXED_CAD` — fixed provider compensation per billing unit.
- `PERCENT` — provider compensation as a percentage of the customer rate.

Examples:

- Customer rate `$60/hour`, fixed provider compensation `$40/hour` → PLEASE gross margin `$20/hour` (`33.3%`).
- Customer rate `$60/hour`, provider compensation `70%` → provider receives `$42/hour`; PLEASE gross margin `$18/hour` (`30%`).

The Provider Portal calculates this summary live while the rate is edited.

## Existing STEP 8.2 data

Existing non-null `provider_compensation` values are preserved and classified as `FIXED_CAD`. The migration deliberately does **not** guess whether an old value such as `0.05` was intended to mean 5%, 0.05%, or CAD 0.05. Edit any ambiguous test records after deployment and select the intended compensation method explicitly.

## Validation

The backend and database both enforce:

- percentage compensation between 0 and 100;
- fixed compensation not greater than the customer rate;
- `NONE` requires no compensation value;
- existing Job billing items remain frozen and are not recalculated when a catalog rate changes.

## UI improvements

The Service Rate editor is reorganized into:

1. Rate Information
2. Customer Pricing
3. Provider Compensation
4. Live Rate Summary
5. Description

Active & Historical Rates now display Customer price, Provider compensation, and PLEASE gross margin in separate visual metrics.
