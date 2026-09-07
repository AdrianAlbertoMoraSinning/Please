'use strict';
const path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'../netlify/functions');
const IDS={bankAccount:'fa-bank',clearAccount:'fa-clear',bankGL:'gl-bank',clearGL:'gl-clear',je1:'je1',je2:'je2',jl1:'jl1',jl2:'jl2'};
const fake={
  json:(status,obj)=>({statusCode:status,body:JSON.stringify(obj)}),sameOrigin:()=>true,requestIp:()=>null,requestUserAgent:()=>null,requireAdmin:async()=>({user:{id:'admin-1',email:'admin@test.local'}}),
  sbJson:async(url,opt={})=>{
    if(url.startsWith('/rest/v1/accounting_accounts?'))return[{id:IDS.bankGL,code:'1000',name:'Operating Bank',account_type:'ASSET',active:true},{id:IDS.clearGL,code:'1090',name:'Stripe Clearing',account_type:'ASSET',active:true}];
    if(url.startsWith('/rest/v1/accounting_financial_accounts?'))return[{id:IDS.bankAccount,name:'Operating Bank',financial_type:'BANK',gl_account_id:IDS.bankGL,is_primary:true,active:true,currency:'CAD'},{id:IDS.clearAccount,name:'Stripe Clearing',financial_type:'CLEARING',gl_account_id:IDS.clearGL,is_primary:false,active:true,currency:'CAD'}];
    if(url.startsWith('/rest/v1/accounting_journal_entries?'))return[{id:IDS.je1,entry_number:'JE-1',entry_date:'2026-09-05',memo:'Bank receipt',status:'POSTED'},{id:IDS.je2,entry_number:'JE-2',entry_date:'2026-09-06',memo:'Stripe receipt',status:'POSTED'}];
    if(url.startsWith('/rest/v1/accounting_journal_lines?'))return[{id:IDS.jl1,journal_entry_id:IDS.je1,account_id:IDS.bankGL,debit:190.05,credit:0,description:'Bank cash'},{id:IDS.jl2,journal_entry_id:IDS.je2,account_id:IDS.clearGL,debit:50,credit:0,description:'Stripe clearing'}];
    if(url==='/rest/v1/rpc/accounting_financial_account_balance'){const b=JSON.parse(opt.body||'{}');return b.p_financial_account_id===IDS.bankAccount?190.05:(b.p_financial_account_id===IDS.clearAccount?50:0);}
    if(url.startsWith('/rest/v1/accounting_bank_reconciliations?'))return[];
    if(url.startsWith('/rest/v1/accounting_bank_matches?'))return[];
    if(url.startsWith('/rest/v1/accounting_supplier_bills?'))return[{id:'bill',due_date:'2026-09-07',status:'POSTED',total:25,amount_paid:0}];
    if(url.startsWith('/rest/v1/accounting_expense_claims?'))return[{id:'exp',status:'POSTED',payment_mode:'REIMBURSEMENT',total:5,amount_reimbursed:0}];
    if(url.startsWith('/rest/v1/provider_payments?'))return[{id:'prov',status:'PENDING',amount:10,needs_rate_review:false,created_at:'2026-09-07'}];
    if(url.startsWith('/rest/v1/accounting_invoices?'))return[{id:'inv',due_date:'2026-09-10',status:'SENT',total:100,paid_total:0}];
    if(url.startsWith('/rest/v1/accounting_credit_notes?'))return[];
    throw new Error(`Unexpected ${opt.method||'GET'} ${url}`);
  }
};
require.cache[require.resolve(path.join(root,'_admin-lib.js'))]={exports:fake};
const fn=require(path.join(root,'cal-banking.js'));
(async()=>{const r=await fn.handler({httpMethod:'GET',queryStringParameters:{},headers:{}}),j=JSON.parse(r.body);assert.strictEqual(r.statusCode,200);assert.strictEqual(j.data.treasury.bankCash,190.05);assert.strictEqual(j.data.treasury.clearing,50);assert.strictEqual(j.data.treasury.commitmentsToday,40);assert.strictEqual(j.data.treasury.availableResources,200.05);assert.strictEqual(j.data.treasury.receivables7,100);assert.strictEqual(j.data.financialAccounts.find(x=>x.id===IDS.bankAccount).balance,190.05);console.log('STEP 18.5 TREASURY RUNTIME PASS')})().catch(e=>{console.error(e);process.exit(1)});
