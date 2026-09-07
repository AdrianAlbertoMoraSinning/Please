const fs=require('fs'),crypto=require('crypto'),assert=require('assert');
const read=p=>fs.readFileSync(p,'utf8');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function pass(name,cond){assert.ok(cond,name);console.log('PASS:',name)}
const sql=read('supabase/STEP18_2_PURCHASES_AP.sql'),api=read('netlify/functions/cal-purchases.js'),worker=read('netlify/functions/_cal-accounting-lib.js'),page=read('cal/purchases.html'),js=read('cal/js/purchases.js'),toml=read('netlify.toml'),doc=read('STEP18_2_PURCHASES_AP.md');
pass('Supplier AP uses new tables and does not replace operational provider payments',sql.includes('create table if not exists public.accounting_supplier_bills')&&sql.includes('create table if not exists public.accounting_supplier_payments')&&!/alter table public\.provider_payments/i.test(sql));
pass('Supplier bills have controlled approval/posting lifecycle',sql.includes("'DRAFT','SUBMITTED','APPROVED','POSTED','PARTIAL','PAID','VOID'")&&sql.includes("v_action='SUBMIT'")&&sql.includes("v_action='APPROVE'")&&sql.includes("v_action='POST'"));
pass('Draft save is atomic PostgreSQL RPC',sql.includes('create or replace function public.accounting_save_supplier_bill')&&sql.includes('delete from public.accounting_supplier_bill_lines')&&sql.includes('return v_id'));
pass('Supplier payment is atomic and rejects overpayment',sql.includes('create or replace function public.accounting_record_supplier_payment')&&sql.includes('Supplier payment exceeds the outstanding balance')&&sql.includes("status=case when v_paid+0.001>=total then 'PAID' else 'PARTIAL' end"));
pass('Bill posting and payment enqueue durable STEP 17 events',sql.includes("'VENDOR_BILL_POSTED'")&&sql.includes("'SUPPLIER_PAYMENT_PAID'")&&sql.includes('accounting_enqueue_event'));
pass('Posting rules remain compatible with STEP 16 non-null and composite uniqueness',sql.includes("('PLEASE','VENDOR_BILL_POSTED','5400','2000','1200'")&&sql.includes("('PLEASE','SUPPLIER_PAYMENT_PAID','2000','1000',null")&&sql.includes('on conflict(source_system,event_type,debit_account_code,credit_account_code)'));
pass('Supplier payment event is causally dependent on posted bill',sql.includes("'PLEASE:VENDOR_BILL_POSTED:'||new.supplier_bill_id::text")&&worker.includes('Dependency pending: ${billKey}'));
pass('Worker posts supplier bill to expense/asset + recoverable tax + AP',worker.includes("type==='VENDOR_BILL_POSTED'")&&worker.includes("rule.credit_account_code||'2000'")&&worker.includes("qst_recoverable_account||'1210'")&&worker.includes("rule.tax_account_code||'1200'"));
pass('Worker pays AP through mapped Financial Account GL',worker.includes("type==='SUPPLIER_PAYMENT_PAID'")&&worker.includes('financialAccount(payment.financial_account_id')&&worker.includes("rule.debit_account_code||'2000'"));
pass('Posted purchase documents are protected from destructive edits',sql.includes('Posted supplier bill financial fields are immutable')&&sql.includes('Lines of a posted supplier bill are immutable')&&sql.includes('Supplier payments cannot be deleted'));
pass('Purchases API requires PLEASE Admin and same-origin writes',api.includes('requireAdmin(event)')&&api.includes("event.httpMethod==='POST'&&!lib.sameOrigin(event)"));
pass('Purchases API normalizes tax server-side from active tax codes',api.includes('normalizeLines')&&api.includes('tax.recoverable_default===false?0:taxAmount')&&api.includes('tax.effective_from'));
pass('Purchases UI exposes controlled workflow and A/P aging',page.includes('Purchases & Accounts Payable')&&page.includes('A/P Aging')&&page.includes('Submit → Approve → Post')&&js.includes("data-act=\"APPROVE\""));
pass('CAL has friendly Purchases route',toml.includes('from = "/purchases.html"')&&toml.includes('to = "/cal/purchases.html"'));
const calPages=fs.readdirSync('cal').filter(x=>x.endsWith('.html')&&x!=='index.html');
pass('All CAL application sidebars expose Purchases & A/P',calPages.every(f=>read('cal/'+f).includes('Purchases & A/P')));
pass('STEP 18.2 documentation blocks scope creep into 18.3',doc.includes('Only after acceptance proceed to STEP 18.3'));
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
'cal-accounting-worker.js':'f5467c6b3e3129267f8151d5b5d787a2c8cdb558045af20183fa6520242db43d'
};
pass('Protected PLEASE operational files remain byte-identical to accepted STEP 18.1 baseline',Object.entries(protectedHashes).every(([p,h])=>hash(p)===h));
console.log('STEP 18.2 Purchases & Accounts Payable static audit completed successfully.');
