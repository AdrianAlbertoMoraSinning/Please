'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
function pass(name,ok){if(!ok){console.error('FAIL',name);process.exitCode=1}else console.log('PASS',name)}
const sql=read('STEP18_6_INVENTORY_ACCOUNTING.sql'),verify=read('STEP18_6_VERIFY.sql'),doc=read('STEP18_6_INVENTORY_ACCOUNTING.md');
const api=read('netlify/functions/cal-inventory.js'),mirror=read('cal-inventory.js'),worker=read('netlify/functions/_cal-accounting-lib.js');
const html=read('cal/inventory.html'),js=read('cal/js/inventory.js'),pApi=read('netlify/functions/cal-purchases.js'),pJs=read('cal/js/purchases.js'),eApi=read('netlify/functions/cal-expenses.js'),eJs=read('cal/js/expenses.js');
pass('STEP 18.6 is additive and creates the inventory subledger tables',['accounting_inventory_items','accounting_inventory_locations','accounting_inventory_balances','accounting_inventory_movements','accounting_inventory_counts','accounting_inventory_count_lines'].every(t=>sql.includes(`create table if not exists public.${t}`))&&!/\b(drop table|truncate table)\b/i.test(sql));
pass('Moving-average is the only enabled valuation method',sql.includes("valuation_method text not null default 'MOVING_AVERAGE'")&&sql.includes("check(valuation_method in ('MOVING_AVERAGE'))")&&doc.includes('moving-average'));
pass('Manufacturing remains hard-disabled',sql.includes('manufacturing_enabled boolean not null default false check(manufacturing_enabled=false)')&&html.includes('Manufacturing/BOM/WIP remains disabled'));
pass('Inventory movements are immutable and negative inventory is blocked',sql.includes('Inventory movements are immutable')&&sql.includes('Insufficient inventory. Available'));
pass('Stock cannot be stranded by deactivating non-empty items/locations or changing UOM after movements',sql.includes('Inventory item cannot be deactivated while on-hand quantity exists')&&sql.includes('Inventory location cannot be deactivated while on-hand quantity exists')&&sql.includes('Unit of measure cannot be changed after inventory movements exist'));
pass('Open physical counts freeze location movements and block unsafe historical counts',sql.includes('Inventory location has an open physical count')&&sql.includes('Historical physical count cannot be started after later-dated inventory movements exist'));
pass('Inventory adjustments require a documented reason at database level',sql.includes('Inventory adjustments require a documented reason'));
pass('Inventory movement engine supports receipts, opening, issues, transfers and adjustments',sql.includes('accounting_inventory_apply_movement')&&['PURCHASE_RECEIPT','DIRECT_EXPENSE_RECEIPT','OPENING','ISSUE','TRANSFER_OUT','TRANSFER_IN','ADJUSTMENT_GAIN','ADJUSTMENT_LOSS'].every(x=>sql.includes(`'${x}'`)));
pass('Manual opening, issue and adjustment retries use stable operation keys',api.includes('MANUAL:${type}:')&&js.includes('movementOperationKey')&&js.includes('newOperationKey'));
pass('Transfers carry source moving-average cost, are retry-idempotent and do not enqueue a financial event',sql.includes('v_cost:=v_from.average_unit_cost')&&sql.includes("source_key='TRANSFER_OUT:'||v_key")&&api.includes('p_request_key')&&js.includes('transferOperationKey')&&sql.includes("v_event:=case when v_type='OPENING'")&&!sql.includes("when v_type='TRANSFER_OUT' then 'INVENTORY"));
pass('Supplier Bill inventory receipt updates subledger without a second GL event',sql.includes('accounting_inventory_supplier_bill_receipt_trigger')&&sql.includes("'PURCHASE_RECEIPT'")&&sql.includes("'SUPPLIER_BILL_LINE:'||l.id::text")&&doc.includes('never creates a second journal'));
pass('Advanced Expense inventory receipt updates subledger without duplicate GL',sql.includes('accounting_inventory_expense_receipt_trigger')&&sql.includes("'DIRECT_EXPENSE_RECEIPT'")&&sql.includes("'EXPENSE_LINE:'||l.id::text"));
pass('Supplier Bill mapping requires account 1600 plus active item and location',sql.includes("v_account_code='1600'")&&sql.includes('requires an inventory item and location')&&pApi.includes("account.code==='1600'")&&pJs.includes('toggleInventory'));
pass('Advanced Expense INVENTORY classification is enabled only against account 1600',eApi.includes("classification==='INVENTORY'")&&eApi.includes("account.code!=='1600'")&&eJs.includes("c==='INVENTORY'")&&eJs.includes('inventoryItemOptions'));
pass('Issues and adjustments are routed through STEP 17 durable events',['INVENTORY_OPENING_POSTED','INVENTORY_ISSUE_POSTED','INVENTORY_ADJUSTMENT_POSTED'].every(x=>sql.includes(`'${x}'`))&&sql.includes('accounting_enqueue_event'));
pass('Worker has Inventory Opening, COGS and adjustment posting handlers',worker.includes("type==='INVENTORY_OPENING_POSTED'")&&worker.includes("type==='INVENTORY_ISSUE_POSTED'")&&worker.includes("type==='INVENTORY_ADJUSTMENT_POSTED'")&&worker.includes('Inventory adjustment gain'));
pass('Recovery scanner includes missing financial inventory events',worker.includes('accounting_inventory_movements?select=*&financial_event_type=not.is.null')&&worker.includes('summary.inventory_events'));
pass('Physical counts require every active item and post immutable variance movements',sql.includes('Every active inventory item must have a counted quantity before posting')&&sql.includes("'Physical count '||v.count_number")&&sql.includes('Posted physical counts are immutable'));
pass('Inventory GL-to-subledger reconciliation RPCs exist',sql.includes('accounting_inventory_gl_balance')&&sql.includes('accounting_inventory_subledger_value')&&api.includes('accounting_inventory_gl_balance')&&api.includes('accounting_inventory_subledger_value'));
pass('Inventory UI exposes item, location, movement, transfer and count controls',html.includes('+ Item')&&html.includes('+ Location')&&html.includes('Opening Balance')&&html.includes('Issue')&&html.includes('Transfer')&&html.includes('Physical Count')&&js.includes("post('TRANSFER'")&&js.includes("post('POST_COUNT'"));
pass('Inventory API is admin-only and same-origin for writes',api.includes('requireAdmin(event)')&&api.includes("event.httpMethod==='POST'&&!lib.sameOrigin(event)"));
pass('Inventory database tables are RLS-protected and browser roles revoked',sql.includes('enable row level security')&&sql.includes('revoke all on public.%I from anon,authenticated'));
pass('Verification covers 20 inventory controls',verify.includes("select 20,'initial_subledger_gl_control'")&&(verify.match(/ union all/g)||[]).length>=19);
pass('Root and Netlify Inventory function mirrors are identical',api===mirror);
pass('Inventory SQL root and Supabase mirrors are identical',sql===read('supabase/STEP18_6_INVENTORY_ACCOUNTING.sql')&&sql===read('cal/supabase/STEP18_6_INVENTORY_ACCOUNTING.sql'));
pass('Purchase and Expense function mirrors remain identical',pApi===read('cal-purchases.js')&&eApi===read('cal-expenses.js')&&worker===read('_cal-accounting-lib.js'));
const protectedHashes={
'index.html':'37606e19e13b019e6ae7465e0723edd5896f2cc5e15760d8de6b341f0f7dae57',
'work-with-us.html':'531bf6b4be655acd9e99bb17ce21efa70cea0f836ab800b0c30a1e890dd6de97',
'provider.html':'1b63e313b17c5213869181bc25fd3cf6f235c7bff4013c72515caa5f46c05969',
'admin-dashboard.html':'82d9f83eeaf65fcfe80bf09478dfe0e7ceb512e13189b047d245ad10b1cf03a9',
'service-request.html':'bf8001b0669a45108d6eb71d05e5df11e6902252742e29cdf902c83179d4525d',
'track-request.html':'658412a1179cc9fd47af989394ce438fab4120485aaa14394bb48cd0abd1f33e',
'payment.html':'122a5eea2ca3315e605778adbe19a1db54de5160a50f98f94a3a62ce9dd0d420',
'css/style.css':'8d4a495c85dd55cf1d8c28e0c98ccfd37443fed2a257e038440bb31197430e40',
'js/app.js':'a5520c3531073bafdd343d19d0fe62f256cbd9cb52570a042688a2529e52aada',
'stripe-webhook.js':'ae22531e33508826be005cb9d5dc9e0dabba1bef4ed2179af9d37dcc9a567812',
'cal-accounting-worker.js':'f5467c6b3e3129267f8151d5b5d787a2c8cdb558045af20183fa6520242db43d',
'admin-provider-payment-action.js':'f74fa51e9b45e91bc2ee4b2d53672a760a1df7a03e627944441022101b639e02',
'admin-invoice-action.js':'8afe9a402e088da72f682c38f132f17e77d636c9b046358141ab1836e2ece9f4',
'cal-receivables.js':'0d595ba25e86d326613ea12a9447e84b4f3cf5809e432290be29f23d1152e724',
'cal/js/receivables.js':'83b8b2223eee71a76182b430aa09646104d3581c74d31511d8613aadaa6d9943',
'cal-banking.js':'535b98e3fabf54c1311b3481cf0c43c829a175ba673ebf21e079857853097fee',
'cal/js/banking.js':'38e525fe64d0cb6a57e952a0aa2cb228164f422ed9f968b92bab9e0399511712'
};
pass('Public operations, Stripe, Provider Payments, A/R and Banking remain byte-identical',Object.entries(protectedHashes).every(([p,h])=>hash(p)===h));
if(process.exitCode)process.exit(process.exitCode);console.log('STEP 18.6 Inventory Accounting static audit completed successfully.');
