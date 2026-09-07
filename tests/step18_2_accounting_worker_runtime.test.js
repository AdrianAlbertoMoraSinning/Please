const path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'../netlify/functions');
const calls=[];
const IDs={bill:'11111111-1111-1111-1111-111111111111',payment:'22222222-2222-2222-2222-222222222222',expense:'33333333-3333-3333-3333-333333333333',tax:'44444444-4444-4444-4444-444444444444',fin:'55555555-5555-5555-5555-555555555555',bank:'66666666-6666-6666-6666-666666666666'};
let eventCounter=0;
const fakeLib={
  sbJson:async(url,opt={})=>{
    const body=opt.body?JSON.parse(opt.body):null;calls.push({url,method:opt.method||'GET',body});
    if(url.includes('/accounting_posting_rules?')&&url.includes('VENDOR_BILL_POSTED'))return[{credit_account_code:'2000',tax_account_code:'1200',configuration_json:{qst_recoverable_account:'1210'}}];
    if(url.includes('/accounting_posting_rules?')&&url.includes('SUPPLIER_PAYMENT_PAID'))return[{debit_account_code:'2000',configuration_json:{}}];
    if(url.startsWith(`/rest/v1/accounting_supplier_bills?select=*&id=eq.${IDs.bill}`))return[{id:IDs.bill,bill_number:'BILL-001001',bill_date:'2026-09-07',status:'POSTED',total:105,subtotal:100,tax_total:5,recoverable_tax:5}];
    if(url.startsWith('/rest/v1/accounting_supplier_bill_lines?'))return[{id:'l1',supplier_bill_id:IDs.bill,description:'Repair supplies',posting_account_id:IDs.expense,tax_code_id:IDs.tax,line_subtotal:100,tax_amount:5,recoverable_tax:5,line_total:105,sort_order:1}];
    if(url.startsWith(`/rest/v1/accounting_supplier_payments?select=*&id=eq.${IDs.payment}`))return[{id:IDs.payment,payment_number:'SUPPAY-001001',supplier_bill_id:IDs.bill,financial_account_id:IDs.fin,payment_date:'2026-09-08',amount:105,status:'PAID'}];
    if(url.startsWith(`/rest/v1/accounting_financial_accounts?id=eq.${IDs.fin}`))return[{id:IDs.fin,name:'Operating Bank',financial_type:'BANK',currency:'CAD',gl_account_id:IDs.bank,active:true}];
    if(url.startsWith(`/rest/v1/accounting_accounts?id=eq.${IDs.expense}`))return[{id:IDs.expense,code:'5600',name:'Repairs & Maintenance',account_type:'EXPENSE',active:true}];
    if(url.startsWith(`/rest/v1/accounting_accounts?id=eq.${IDs.bank}`))return[{id:IDs.bank,code:'1000',name:'Operating Bank',account_type:'ASSET',active:true}];
    if(url.startsWith(`/rest/v1/accounting_tax_codes?id=eq.${IDs.tax}`))return[{id:IDs.tax,code:'AB-GST',tax_kind:'GST',federal_rate:5,provincial_rate:0,recoverable_default:true}];
    if(url.startsWith(`/rest/v1/please_accounting_outbox?event_key=eq.${encodeURIComponent('PLEASE:VENDOR_BILL_POSTED:'+IDs.bill)}`))return[{id:'dep',status:'POSTED'}];
    if(url.startsWith('/rest/v1/accounting_external_events?'))return[];
    if(url==='/rest/v1/accounting_external_events'&&opt.method==='POST')return[{id:`evt-${++eventCounter}`,posting_status:'PENDING'}];
    if(url.startsWith('/rest/v1/accounting_external_events?id=eq.')&&opt.method==='PATCH')return null;
    if(url.startsWith('/rest/v1/please_accounting_outbox?id=eq.')&&opt.method==='PATCH')return null;
    if(url.startsWith('/rest/v1/accounting_accounts?code=eq.')){const m=url.match(/code=eq\.([^&]+)/);const code=decodeURIComponent(m?.[1]||'0000');return[{id:`account-${code}`,code}];}
    if(url==='/rest/v1/rpc/accounting_post_event_journal')return[{accounting_post_event_journal:`journal-${eventCounter}`}];
    throw new Error(`Unexpected ${opt.method||'GET'} ${url}`);
  }
};
require.cache[require.resolve(path.join(root,'_admin-lib.js'))]={exports:fakeLib};
const acct=require(path.join(root,'_cal-accounting-lib.js'));
(async()=>{
  const billRow={id:'outbox-bill',event_key:`PLEASE:VENDOR_BILL_POSTED:${IDs.bill}`,event_type:'VENDOR_BILL_POSTED',event_version:1,source_table:'accounting_supplier_bills',source_record_id:IDs.bill,source_reference:'BILL-001001',occurred_at:'2026-09-07T18:00:00Z',payload_json:{supplier_bill:{id:IDs.bill,bill_number:'BILL-001001',bill_date:'2026-09-07',status:'POSTED',total:105},lines:[{description:'Repair supplies',posting_account_id:IDs.expense,tax_code_id:IDs.tax,line_subtotal:100,tax_amount:5,recoverable_tax:5,line_total:105}]},attempts:1};
  const r1=await acct.processOutboxEvent(billRow,{workerId:'test'});assert.strictEqual(r1.status,'POSTED');
  const billPost=calls.find(c=>c.url==='/rest/v1/rpc/accounting_post_event_journal'&&c.body?.p_memo?.includes('Supplier bill posted'));assert.ok(billPost,'bill journal RPC');
  assert.deepStrictEqual(billPost.body.p_lines.map(x=>({code:x.code,debit:x.debit,credit:x.credit})),[{code:'5600',debit:100,credit:0},{code:'1200',debit:5,credit:0},{code:'2000',debit:0,credit:105}]);
  const payRow={id:'outbox-pay',event_key:`PLEASE:SUPPLIER_PAYMENT_PAID:${IDs.payment}`,event_type:'SUPPLIER_PAYMENT_PAID',event_version:1,source_table:'accounting_supplier_payments',source_record_id:IDs.payment,source_reference:'SUPPAY-001001',occurred_at:'2026-09-08T18:00:00Z',payload_json:{supplier_payment:{id:IDs.payment,payment_number:'SUPPAY-001001',supplier_bill_id:IDs.bill,financial_account_id:IDs.fin,payment_date:'2026-09-08',amount:105,status:'PAID'}},attempts:1};
  const r2=await acct.processOutboxEvent(payRow,{workerId:'test'});assert.strictEqual(r2.status,'POSTED');
  const payPost=calls.find(c=>c.url==='/rest/v1/rpc/accounting_post_event_journal'&&c.body?.p_memo?.includes('Supplier payment'));assert.ok(payPost,'payment journal RPC');
  assert.deepStrictEqual(payPost.body.p_lines.map(x=>({code:x.code,debit:x.debit,credit:x.credit})),[{code:'2000',debit:105,credit:0},{code:'1000',debit:0,credit:105}]);
  console.log('STEP 18.2 PURCHASE/AP WORKER RUNTIME PASS');
})().catch(e=>{console.error(e);process.exit(1)});
