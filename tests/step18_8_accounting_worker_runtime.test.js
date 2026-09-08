'use strict';
const path=require('path'),assert=require('assert');const root=path.resolve(__dirname,'../netlify/functions'),calls=[];let seq=0;
const run={id:'payrun-1',run_number:'PAY-000001',payment_date:'2026-09-18',status:'POSTED',gross_pay:1000,employee_cpp:50,employee_cpp2:5,employee_ei:16,income_tax:150,other_deductions:10,net_pay:769,employer_cpp:50,employer_cpp2:5,employer_ei:22,payment_financial_account_id:null,payment_reference:null};
const paidRun={...run,status:'PAID',payment_financial_account_id:'fin-bank',payment_reference:'PAYROLL-TEST',paid_at:'2026-09-18T18:00:00Z'};
const payLines=[{id:'pl1',payroll_run_id:'payrun-1',gross_pay:1000,net_pay:769}];
const rem={id:'rem-1',remittance_number:'PRM-000001',period_end:'2026-09-30',remittance_date:'2026-10-15',status:'PAID',financial_account_id:'fin-bank',employee_cpp:50,employer_cpp:50,employee_cpp2:5,employer_cpp2:5,employee_ei:16,employer_ei:22,income_tax:150,total_remittance:298,reference:'CRA-RP-TEST'};
const rules={PAYROLL_POSTED:{debit_account_code:'7000',credit_account_code:'2030',configuration_json:{employer_cpp_expense:'7010',employer_ei_expense:'7020',cpp_payable:'2040',ei_payable:'2050',tax_payable:'2060',other_payable:'2070'}},PAYROLL_PAID:{debit_account_code:'2030',credit_account_code:'1000',configuration_json:{}},PAYROLL_REMITTANCE_PAID:{debit_account_code:'2040',credit_account_code:'1000',configuration_json:{ei_payable:'2050',tax_payable:'2060'}}};
const fake={sbJson:async(url,opt={})=>{const body=opt.body?JSON.parse(opt.body):null;calls.push({url,method:opt.method||'GET',body});
 if(url.includes('/accounting_posting_rules?')){const m=url.match(/event_type=eq\.([^&]+)/);return[rules[decodeURIComponent(m?.[1]||'')]||null].filter(Boolean)}
 if(url.includes('/accounting_payroll_runs?id=eq.payrun-1'))return[url.includes('status')?paidRun:paidRun];
 if(url.includes('/accounting_payroll_run_lines?payroll_run_id=eq.payrun-1'))return payLines;
 if(url.includes('/accounting_payroll_remittances?id=eq.rem-1'))return[rem];
 if(url.includes('/please_accounting_outbox?event_key=eq.PLEASE%3APAYROLL_POSTED%3Apayrun-1'))return[{status:'POSTED'}];
 if(url.includes('/accounting_financial_accounts?id=eq.fin-bank'))return[{id:'fin-bank',name:'Operating Bank',financial_type:'BANK',gl_account_id:'gl-bank',active:true}];
 if(url.includes('/accounting_accounts?id=eq.gl-bank'))return[{id:'gl-bank',code:'1000',active:true}];
 if(url.startsWith('/rest/v1/accounting_external_events?'))return[];
 if(url==='/rest/v1/accounting_external_events'&&opt.method==='POST')return[{id:`evt-${++seq}`,posting_status:'PENDING'}];
 if(url.startsWith('/rest/v1/accounting_external_events?id=eq.')&&opt.method==='PATCH')return null;
 if(url.startsWith('/rest/v1/please_accounting_outbox?id=eq.')&&opt.method==='PATCH')return null;
 if(url.startsWith('/rest/v1/accounting_accounts?code=eq.')){const code=decodeURIComponent((url.match(/code=eq\.([^&]+)/)||[])[1]||'0000');return[{id:`acc-${code}`,code}]}
 if(url==='/rest/v1/rpc/accounting_post_event_journal')return[{accounting_post_event_journal:`journal-${seq}`}];
 throw new Error(`Unexpected ${opt.method||'GET'} ${url}`)}};
require.cache[require.resolve(path.join(root,'_admin-lib.js'))]={exports:fake};const acct=require(path.join(root,'_cal-accounting-lib.js'));
function row(id,type,payload={}){return{id:`out-${id}-${type}`,event_key:`PLEASE:${type}:${id}`,event_type:type,event_version:1,source_table:type==='PAYROLL_REMITTANCE_PAID'?'accounting_payroll_remittances':'accounting_payroll_runs',source_record_id:id,source_reference:id,occurred_at:'2026-09-18T12:00:00Z',payload_json:payload,attempts:1}}
async function runCase(r,expected){const before=calls.length,res=await acct.processOutboxEvent(r,{workerId:'payroll-test'});assert.strictEqual(res.status,'POSTED');const post=calls.slice(before).find(c=>c.url==='/rest/v1/rpc/accounting_post_event_journal');assert.ok(post,'journal RPC was called');assert.deepStrictEqual(post.body.p_lines.map(x=>({code:x.code,debit:x.debit,credit:x.credit})),expected)}
(async()=>{
 await runCase(row('payrun-1','PAYROLL_POSTED',{payroll_run:run,lines:payLines}),[{code:'7000',debit:1000,credit:0},{code:'7010',debit:55,credit:0},{code:'7020',debit:22,credit:0},{code:'2030',debit:0,credit:769},{code:'2040',debit:0,credit:110},{code:'2050',debit:0,credit:38},{code:'2060',debit:0,credit:150},{code:'2070',debit:0,credit:10}]);
 await runCase(row('payrun-1','PAYROLL_PAID',{payroll_run:paidRun}),[{code:'2030',debit:769,credit:0},{code:'1000',debit:0,credit:769}]);
 await runCase(row('rem-1','PAYROLL_REMITTANCE_PAID',{payroll_remittance:rem}),[{code:'2040',debit:110,credit:0},{code:'2050',debit:38,credit:0},{code:'2060',debit:150,credit:0},{code:'1000',debit:0,credit:298}]);
 console.log('STEP 18.8 PAYROLL WORKER RUNTIME PASS');
})().catch(e=>{console.error(e);process.exit(1)});
