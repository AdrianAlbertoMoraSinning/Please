'use strict';
const path=require('path'),assert=require('assert');const root=path.resolve(__dirname,'../netlify/functions'),calls=[];
const fakeAdmin={json:(status,obj)=>({statusCode:status,body:JSON.stringify(obj)}),sameOrigin:()=>true,requireAdmin:async()=>({user:{id:'11111111-1111-1111-1111-111111111111',email:'admin@test.local'}}),requestIp:()=>null,requestUserAgent:()=>null,
 sbJson:async(url,opt={})=>{const body=opt.body?JSON.parse(opt.body):null;calls.push({url,method:opt.method||'GET',body});
   if(url==='/rest/v1/rpc/accounting_integration_health')return[{accounting_integration_health:{status:'HEALTHY',financial_contracts:22,domain_contracts:5,missing_events:0,queue:{dead_letter:0}}}];
   if(url==='/rest/v1/rpc/accounting_engine_health')return[{accounting_engine_health:{status:'HEALTHY'}}];
   if(url==='/rest/v1/rpc/accounting_integration_exceptions')return[];
   if(url==='/rest/v1/rpc/accounting_requeue_dead_letter')return[{accounting_requeue_dead_letter:'RETRY'}];
   if(url.startsWith('/rest/v1/accounting_integration_contracts?'))return[{event_type:'INVOICE_ISSUED',route:'FINANCIAL_OUTBOX'}];
   if(url.startsWith('/rest/v1/please_accounting_outbox?')||url.startsWith('/rest/v1/please_domain_events?')||url==='/rest/v1/accounting_audit_log')return[];
   throw new Error(`Unexpected ${opt.method||'GET'} ${url}`);
 }};
const fakeAccounting={SUPPORTED_FINANCIAL_EVENT_TYPES:['INVOICE_ISSUED'],FINANCIAL_EVENT_PRIORITY:{INVOICE_ISSUED:10},reconcile:async limit=>({queued:0,limit,errors:[]}),runWorker:async({limit})=>({ok:true,claimed:0,posted:0,ignored:0,retried:0,dead_letter:0,limit})};
require.cache[require.resolve(path.join(root,'_admin-lib.js'))]={exports:fakeAdmin};require.cache[require.resolve(path.join(root,'_cal-accounting-lib.js'))]={exports:fakeAccounting};const fn=require(path.join(root,'cal-integration.js'));
(async()=>{let r=await fn.handler({httpMethod:'GET',headers:{}});let j=JSON.parse(r.body);assert.strictEqual(r.statusCode,200);assert.strictEqual(j.data.health.status,'HEALTHY');assert.deepStrictEqual(j.data.supportedFinancialEvents,['INVOICE_ISSUED']);
 r=await fn.handler({httpMethod:'POST',headers:{},body:JSON.stringify({action:'RECONCILE',payload:{limit:300}})});j=JSON.parse(r.body);assert.strictEqual(r.statusCode,200);assert.strictEqual(j.result.scan.limit,300);
 r=await fn.handler({httpMethod:'POST',headers:{},body:JSON.stringify({action:'RUN_WORKER',payload:{limit:100}})});j=JSON.parse(r.body);assert.strictEqual(j.result.worker.limit,100);
 r=await fn.handler({httpMethod:'POST',headers:{},body:JSON.stringify({action:'REQUEUE_DEAD_LETTER',payload:{event_key:'PLEASE:X:1'}})});j=JSON.parse(r.body);assert.strictEqual(j.result.status,'RETRY');assert.ok(calls.some(c=>c.url==='/rest/v1/rpc/accounting_requeue_dead_letter'&&c.body.p_event_key==='PLEASE:X:1'));
 console.log('STEP 18.11 INTEGRATION API RUNTIME PASS');})().catch(e=>{console.error(e);process.exit(1)});
