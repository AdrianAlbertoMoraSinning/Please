const path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'../netlify/functions');
const calls=[];
const IDs={inv:'11111111-1111-1111-1111-111111111111',note:'22222222-2222-2222-2222-222222222222',refund:'33333333-3333-3333-3333-333333333333',revenue:'44444444-4444-4444-4444-444444444444',tax:'55555555-5555-5555-5555-555555555555',fin:'66666666-6666-6666-6666-666666666666',bank:'77777777-7777-7777-7777-777777777777',party:'88888888-8888-8888-8888-888888888888'};
let eventCounter=0;
const fakeLib={
  sbJson:async(url,opt={})=>{
    const body=opt.body?JSON.parse(opt.body):null;calls.push({url,method:opt.method||'GET',body});
    if(url.includes('/accounting_posting_rules?')&&url.includes('CREDIT_NOTE_ISSUED'))return[{debit_account_code:'4000',credit_account_code:'1100',tax_account_code:'2100',configuration_json:{qst_payable_account:'2110'}}];
    if(url.includes('/accounting_posting_rules?')&&url.includes('REFUND_COMPLETED'))return[{debit_account_code:'1100',credit_account_code:'1000',configuration_json:{}}];
    if(url.startsWith(`/rest/v1/accounting_credit_notes?id=eq.${IDs.note}`))return[{id:IDs.note,credit_note_number:'CN-001001',invoice_id:IDs.inv,customer_party_id:IDs.party,credit_date:'2026-09-07',status:'POSTED',subtotal_reduction:100,tax_reduction:5,total:105,currency:'CAD'}];
    if(url.startsWith(`/rest/v1/accounting_invoices?id=eq.${IDs.inv}`))return[{id:IDs.inv,invoice_number:'PLS-INV-TEST',party_id:IDs.party,source_invoice_id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',invoice_date:'2026-09-05',status:'PAID',subtotal:100,tax_total:5,total:105,currency:'CAD'}];
    if(url.startsWith('/rest/v1/accounting_credit_note_lines?'))return[{id:'l1',credit_note_id:IDs.note,sort_order:1,description:'Service adjustment',quantity:1,unit_price:100,revenue_account_id:IDs.revenue,tax_code_id:IDs.tax,tax_amount_override:5,line_subtotal:100,line_tax:5,line_total:105}];
    if(url.startsWith(`/rest/v1/accounting_customer_refunds?id=eq.${IDs.refund}`))return[{id:IDs.refund,refund_number:'REF-001001',customer_party_id:IDs.party,credit_note_id:IDs.note,financial_account_id:IDs.fin,refund_date:'2026-09-08',amount:105,currency:'CAD',status:'COMPLETED'}];
    if(url.startsWith(`/rest/v1/accounting_financial_accounts?id=eq.${IDs.fin}`))return[{id:IDs.fin,name:'Operating Bank',financial_type:'BANK',currency:'CAD',gl_account_id:IDs.bank,active:true}];
    if(url.startsWith(`/rest/v1/accounting_accounts?id=eq.${IDs.revenue}`))return[{id:IDs.revenue,code:'4000',name:'Service Revenue',account_type:'REVENUE',active:true}];
    if(url.startsWith(`/rest/v1/accounting_accounts?id=eq.${IDs.bank}`))return[{id:IDs.bank,code:'1000',name:'Operating Bank',account_type:'ASSET',active:true}];
    if(url.startsWith(`/rest/v1/accounting_tax_codes?id=eq.${IDs.tax}`))return[{id:IDs.tax,code:'AB-GST',tax_kind:'GST',federal_rate:5,provincial_rate:0,recoverable_default:true}];
    if(url.startsWith(`/rest/v1/please_accounting_outbox?event_key=eq.${encodeURIComponent('PLEASE:INVOICE_ISSUED:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')}`))return[{id:'dep-inv',status:'POSTED'}];
    if(url.startsWith(`/rest/v1/please_accounting_outbox?event_key=eq.${encodeURIComponent('PLEASE:CREDIT_NOTE_ISSUED:'+IDs.note)}`))return[{id:'dep-cn',status:'POSTED'}];
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
  const cnRow={id:'outbox-cn',event_key:`PLEASE:CREDIT_NOTE_ISSUED:${IDs.note}`,event_type:'CREDIT_NOTE_ISSUED',event_version:1,source_table:'accounting_credit_notes',source_record_id:IDs.note,source_reference:'CN-001001',occurred_at:'2026-09-07T18:00:00Z',payload_json:{credit_note:{id:IDs.note,credit_note_number:'CN-001001',invoice_id:IDs.inv,status:'POSTED',subtotal_reduction:100,tax_reduction:5,total:105},lines:[{description:'Service adjustment',revenue_account_id:IDs.revenue,tax_code_id:IDs.tax,line_subtotal:100,line_tax:5,line_total:105}]},attempts:1};
  const r1=await acct.processOutboxEvent(cnRow,{workerId:'test'});assert.strictEqual(r1.status,'POSTED');
  const cnPost=calls.find(c=>c.url==='/rest/v1/rpc/accounting_post_event_journal'&&c.body?.p_memo?.includes('Credit note issued'));assert.ok(cnPost,'credit-note journal RPC');
  assert.deepStrictEqual(cnPost.body.p_lines.map(x=>({code:x.code,debit:x.debit,credit:x.credit})),[{code:'4000',debit:100,credit:0},{code:'2100',debit:5,credit:0},{code:'1100',debit:0,credit:105}]);

  const refRow={id:'outbox-ref',event_key:`PLEASE:REFUND_COMPLETED:${IDs.refund}`,event_type:'REFUND_COMPLETED',event_version:1,source_table:'accounting_customer_refunds',source_record_id:IDs.refund,source_reference:'REF-001001',occurred_at:'2026-09-08T18:00:00Z',payload_json:{customer_refund:{id:IDs.refund,refund_number:'REF-001001',customer_party_id:IDs.party,credit_note_id:IDs.note,financial_account_id:IDs.fin,refund_date:'2026-09-08',amount:105,status:'COMPLETED'}},attempts:1};
  const r2=await acct.processOutboxEvent(refRow,{workerId:'test'});assert.strictEqual(r2.status,'POSTED');
  const refPost=calls.find(c=>c.url==='/rest/v1/rpc/accounting_post_event_journal'&&c.body?.p_memo?.includes('Customer refund'));assert.ok(refPost,'refund journal RPC');
  assert.deepStrictEqual(refPost.body.p_lines.map(x=>({code:x.code,debit:x.debit,credit:x.credit})),[{code:'1100',debit:105,credit:0},{code:'1000',debit:0,credit:105}]);
  console.log('STEP 18.3 CREDIT NOTE / REFUND WORKER RUNTIME PASS');
})().catch(e=>{console.error(e);process.exit(1)});
