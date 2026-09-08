# STEP 18.6 — Inventory Accounting

## Scope

STEP 18.6 adds a perpetual inventory subledger to CAL without enabling manufacturing.

### Included
- Inventory item master (SKU, UOM, category, reorder point, preferred supplier)
- Inventory locations (warehouse, vehicle, jobsite, other)
- Per-item/per-location moving-average valuation
- Automatic quantity/value receipts from Supplier Bills mapped to GL 1600 Inventory
- Automatic quantity/value receipts from Advanced Expense lines classified INVENTORY
- Opening inventory balances
- Inventory issues with automatic COGS recognition
- Location-to-location transfers with no GL effect
- Controlled inventory gains/losses
- Physical counts and immutable posted count adjustments
- Inventory subledger vs GL 1600 reconciliation
- STEP 17 events for opening, issues and adjustment accounting

### Deliberately not included
Manufacturing, BOM, Work in Progress, production orders and finished-goods costing remain disabled for a later step.

## Posting model

### Supplier Bill receipt
The Supplier Bill already posts Dr Inventory / Dr recoverable tax / Cr A/P. The inventory receipt therefore updates only the quantity/value subledger and never creates a second journal.

### Direct expense inventory receipt
The Advanced Expense already posts Dr Inventory / Dr recoverable tax / Cr Bank/Card/Reimbursement Payable. The inventory receipt updates only the quantity/value subledger.

### Issue
- Dr Cost of Goods Sold (6000)
- Cr Inventory (1600)

### Opening balance
- Dr Inventory (1600)
- Cr Owner Equity / Retained Earnings (3000)

### Adjustment gain
- Dr Inventory (1600)
- Cr Inventory Adjustments (6100)

### Adjustment loss
- Dr Inventory Adjustments (6100)
- Cr Inventory (1600)

### Transfer
No journal. The source moving-average cost is carried to the destination.

## Core controls
- Inventory movements are immutable.
- Negative stock is blocked.
- Opening balance can only be used before the first movement for an item/location.
- Posted physical counts are immutable.
- Supplier Bill/Expense inventory mapping is accepted only when posting to GL 1600.
- Supplier Bill and Expense receipts use unique source keys to remain idempotent.
- Manual opening/issues/adjustments and transfers carry stable operation keys so client retries do not create duplicate movements.
- Items/locations with on-hand stock cannot be deactivated; UOM cannot change after movement history exists.
- A Draft physical count freezes that location against new inventory movements until the count is posted/voided.
- Historical physical counts are blocked when later-dated movements already exist.
- Manufacturing is hard-disabled in the item master for STEP 18.6.
- Browser roles have no direct access to inventory accounting tables; Netlify service-role functions mediate access.
