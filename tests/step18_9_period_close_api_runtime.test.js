'use strict';
const path=require('path'),assert=require('assert');const root=path.resolve(__dirname,'../netlify/functions'),calls=[];
const fake={
 json:(status,obj)=>({statusCode:status,body:JSON.stringify(obj)}),sameOrigin:()=>true,requireAdmin:async()=>({user:{id:'admin-1',email:'admin@test.local'}}),
 sbJson:async(url,opt={})=>{const body=opt.body?JSON.parse(opt.body):null;calls.push({url,method:opt.method||'GET',body});
   if(url==='/rest/v1/rpc/accounting_prepare_period_close_guarded')return[{accounting_prepare_period_close_guarded:'period-1'}];
   if(url==='/rest/v1/rpc/accounting_engine_health')return[{status:'HEALTHY'}];
   if(url.startsWith('/rest/v1/accounting_fiscal_periods?'))return[{id:'period-1',period_start:'2026-08-01',period_end:'2026-08-31',status:'OPEN',close_state:'IN_REVIEW',close_version:0}];
   if(url.startsWith('/rest/v1/accounting_accounts?'))return[{id:'a1',code:'5500',name:'Professional Fees',account_type:'EXPENSE',allow_manual_posting:true,active:true}];
   if(url.startsWith('/rest/v1/accounting_period_close_checklist?'))return[{id:'c1',period_id:'period-1',control_code:'BANK_RECON',category:'TREASURY',label:'Bank reconciliation',requirement_level:'REVIEW',status:'REVIEW'}];
   if(url.startsWith('/rest/v1/accounting_period_adjustments?'))return[];
   if(url.startsWith('/rest/v1/accounting_period_close_actions?'))return[];
   if(url.startsWith('/rest/v1/accounting_period_close_snapshots?'))return[];
   if(url.startsWith('/rest/v1/please_accounting_outbox?event_type=eq.PERIOD_CLOSE_ADJUSTMENT_POSTED'))return[];
   throw new Error(`Unexpected ${opt.method||'GET'} ${url}`);
 }};
require.cache[require.resolve(path.join(root,'_admin-lib.js'))]={exports:fake};const fn=require(path.join(root,'cal-period-close.js'));
(async()=>{
 let r=await fn.handler({httpMethod:'POST',headers:{},body:JSON.stringify({action:'CLOSE_PERIOD',payload:{period_id:'period-1',confirmation:'no'}})});let j=JSON.parse(r.body);assert.strictEqual(r.statusCode,400);assert.ok(/Type CLOSE/.test(j.error));
 r=await fn.handler({httpMethod:'POST',headers:{},body:JSON.stringify({action:'PREPARE',payload:{period_start:'2026-08-01',period_end:'2026-08-31'}})});j=JSON.parse(r.body);assert.strictEqual(r.statusCode,200);assert.strictEqual(j.result.period_id,'period-1');assert.strictEqual(j.data.selectedPeriod.id,'period-1');assert.strictEqual(j.data.summary.reviews,1);const rpc=calls.find(c=>c.url==='/rest/v1/rpc/accounting_prepare_period_close_guarded');assert.deepStrictEqual(rpc.body,{p_period_start:'2026-08-01',p_period_end:'2026-08-31',p_actor_id:'admin-1',p_allow_custom:false,p_boundary_reason:null});
 console.log('STEP 18.9 PERIOD CLOSE API RUNTIME PASS');
})().catch(e=>{console.error(e);process.exit(1)});
