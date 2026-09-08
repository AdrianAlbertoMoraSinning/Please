'use strict';
const path=require('path'),assert=require('assert');const root=path.resolve(__dirname,'../netlify/functions'),calls=[];
const fake={
 json:(status,obj)=>({statusCode:status,body:JSON.stringify(obj)}),sameOrigin:()=>true,requireAdmin:async()=>({user:{id:'admin-1',email:'admin@test.local'}}),
 sbJson:async(url,opt={})=>{const body=opt.body?JSON.parse(opt.body):null;calls.push({url,method:opt.method||'GET',body});
   if(url==='/rest/v1/rpc/accounting_prepare_period_close_guarded')return[{accounting_prepare_period_close_guarded:'period-1'}];
   if(url==='/rest/v1/rpc/accounting_engine_health')return[{status:'HEALTHY'}];
   if(url.startsWith('/rest/v1/accounting_fiscal_periods?'))return[{id:'period-1',period_start:'2026-08-01',period_end:'2026-08-31',status:'OPEN',close_state:'IN_REVIEW',close_version:0,boundary_type:'CALENDAR_MONTH'}];
   if(url.startsWith('/rest/v1/accounting_accounts?'))return[];
   if(url.startsWith('/rest/v1/accounting_period_close_checklist?'))return[];
   if(url.startsWith('/rest/v1/accounting_period_adjustments?'))return[];
   if(url.startsWith('/rest/v1/accounting_period_close_actions?'))return[];
   if(url.startsWith('/rest/v1/accounting_period_close_snapshots?'))return[];
   if(url.startsWith('/rest/v1/please_accounting_outbox?event_type=eq.PERIOD_CLOSE_ADJUSTMENT_POSTED'))return[];
   throw new Error(`Unexpected ${opt.method||'GET'} ${url}`);
 }};
require.cache[require.resolve(path.join(root,'_admin-lib.js'))]={exports:fake};const fn=require(path.join(root,'cal-period-close.js'));
(async()=>{
 let r=await fn.handler({httpMethod:'POST',headers:{},body:JSON.stringify({action:'PREPARE',payload:{period_start:'2026-09-01',period_end:'2026-09-07'}})});let j=JSON.parse(r.body);assert.strictEqual(r.statusCode,400);assert.ok(/explicit confirmation/i.test(j.error));
 r=await fn.handler({httpMethod:'POST',headers:{},body:JSON.stringify({action:'PREPARE',payload:{period_start:'2026-09-01',period_end:'2026-09-07',allow_custom:true,boundary_reason:'short'}})});j=JSON.parse(r.body);assert.strictEqual(r.statusCode,400);assert.ok(/at least 10/i.test(j.error));
 r=await fn.handler({httpMethod:'POST',headers:{},body:JSON.stringify({action:'PREPARE',payload:{period_start:'2026-09-01',period_end:'2026-09-07',allow_custom:true,boundary_reason:'Intentional migration stub period'}})});j=JSON.parse(r.body);assert.strictEqual(r.statusCode,200);const rpc=calls.filter(c=>c.url==='/rest/v1/rpc/accounting_prepare_period_close_guarded').pop();assert.deepStrictEqual(rpc.body,{p_period_start:'2026-09-01',p_period_end:'2026-09-07',p_actor_id:'admin-1',p_allow_custom:true,p_boundary_reason:'Intentional migration stub period'});
 console.log('STEP 18.9.1 PERIOD BOUNDARY API RUNTIME PASS');
})().catch(e=>{console.error(e);process.exit(1)});
