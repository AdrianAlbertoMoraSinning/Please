'use strict';
const path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'../netlify/functions');
const IDS={bankAccount:'fa-bank',bankGL:'gl-bank'};
const fake={
  json:(status,obj)=>({statusCode:status,body:JSON.stringify(obj)}),sameOrigin:()=>true,requestIp:()=>null,requestUserAgent:()=>null,requireAdmin:async()=>({user:{id:'admin-1',email:'admin@test.local'}}),
  sbJson:async(url,opt={})=>{
    if(url.startsWith('/rest/v1/accounting_accounts?'))return[{id:IDS.bankGL,code:'1000',name:'Operating Bank',account_type:'ASSET',active:true}];
    if(url.startsWith('/rest/v1/accounting_financial_accounts?'))return[{id:IDS.bankAccount,name:'Operating Bank',financial_type:'BANK',gl_account_id:IDS.bankGL,is_primary:true,active:true,currency:'CAD'}];
    if(url.startsWith('/rest/v1/accounting_journal_entries?'))return[];
    if(url.startsWith('/rest/v1/accounting_journal_lines?'))return[];
    if(url==='/rest/v1/rpc/accounting_financial_account_balance')return 1000;
    if(url.startsWith('/rest/v1/accounting_bank_reconciliations?'))return[];
    if(url.startsWith('/rest/v1/accounting_bank_matches?'))return[];
    if(url.startsWith('/rest/v1/accounting_supplier_bills?'))return[];
    if(url.startsWith('/rest/v1/accounting_expense_claims?'))return[];
    if(url.startsWith('/rest/v1/provider_payments?'))return[];
    if(url.startsWith('/rest/v1/accounting_invoices?'))return[];
    if(url.startsWith('/rest/v1/accounting_credit_notes?'))return[];
    if(url.startsWith('/rest/v1/accounting_payroll_runs?'))return[
      {id:'run-posted',status:'POSTED',payment_date:'2026-09-07',net_pay:500,employee_cpp:30,employer_cpp:30,employee_cpp2:0,employer_cpp2:0,employee_ei:10,employer_ei:14,income_tax:100},
      {id:'run-paid',status:'PAID',payment_date:'2026-08-20',net_pay:400,employee_cpp:20,employer_cpp:20,employee_cpp2:0,employer_cpp2:0,employee_ei:8,employer_ei:11,income_tax:80}
    ];
    if(url.startsWith('/rest/v1/accounting_payroll_remittances?'))return[{id:'rem-1',status:'PAID',total_remittance:139,period_end:'2026-08-31',remittance_date:'2026-09-05'}];
    if(url.startsWith('/rest/v1/accounting_payroll_settings?'))return[{remitter_type:'THRESHOLD_1'}];
    throw new Error(`Unexpected ${opt.method||'GET'} ${url}`);
  }
};
require.cache[require.resolve(path.join(root,'_admin-lib.js'))]={exports:fake};
const fn=require(path.join(root,'cal-banking.js'));
(async()=>{
  const r=await fn.handler({httpMethod:'GET',queryStringParameters:{},headers:{}}),j=JSON.parse(r.body),t=j.data.treasury;
  assert.strictEqual(r.statusCode,200);
  assert.strictEqual(t.bankCash,1000);
  // First PAID run source deductions (139) are fully covered FIFO by the remittance.
  // The POSTED Sep 7 net payroll ($500) is due now. Its $184 source deductions are due Sep 25 under Threshold 1,
  // so they belong in the 30-day horizon but not Today/7-day on Sep 8.
  assert.strictEqual(t.commitmentsToday,500);
  assert.strictEqual(t.commitments7,500);
  assert.strictEqual(t.commitments30,684);
  assert.strictEqual(t.availableResources,500);
  assert.strictEqual(t.components.payrollNetToday,500);
  assert.strictEqual(t.components.payrollSourceOutstanding,184);
  assert.strictEqual(t.components.nextPayrollRemittanceDue,'2026-09-25');
  assert.strictEqual(t.components.remitterType,'THRESHOLD_1');
  console.log('STEP 18.8 TREASURY PAYROLL RUNTIME PASS');
})().catch(e=>{console.error(e);process.exit(1)});
