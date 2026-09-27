'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('path');
const root=path.join(__dirname,'..');
const fn=path.join(root,'netlify/functions/admin-job-action.js');
const libPath=path.join(root,'netlify/functions/_admin-lib.js');
const notifyPath=path.join(root,'netlify/functions/_notify-lib.js');
const REQUEST='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',JOB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',SERVICE='cccccccc-cccc-4ccc-8ccc-cccccccccccc',PROVIDER='dddddddd-dddd-4ddd-8ddd-dddddddddddd',RATE='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
function setup(status='ASSIGNED'){
  const calls=[];
  require.cache[require.resolve(libPath)]={exports:{sameOrigin:()=>true,requireAdmin:async()=>({user:{id:REQUEST}}),json:(statusCode,body)=>({statusCode,body:JSON.stringify(body)}),sbJson:async(url,opt={})=>{
    const body=opt.body?JSON.parse(opt.body):null;calls.push({url,body});
    if(url.startsWith('/rest/v1/service_requests?'))return[{id:REQUEST,reference:'PLS-REQ-20260927-A1',status,job_id:status==='ASSIGNED'?JOB:null,first_name:'Adrian',last_name:'Mora',email:'customer@example.com',phone:'555-0100',service_id:SERVICE,city:'Calgary',province:'AB'}];
    if(url.startsWith('/rest/v1/jobs?select=id,reference&internal_notes='))return[];
    if(url.startsWith('/rest/v1/provider_service_rates?'))return[{id:RATE,provider_id:PROVIDER,service_id:SERVICE,rate_name:'Moving hour',billing_unit:'hour',customer_rate:100,provider_compensation_method:'FIXED_CAD',provider_compensation:50,active:true}];
    if(url.startsWith('/rest/v1/services?'))return[{id:SERVICE,name:'Moving'}];
    if(url==='/rest/v1/rpc/please_create_multi_provider_job')return{job_id:'ffffffff-ffff-4fff-8fff-ffffffffffff',job_reference:'PLS-JOB-2',assignment_ids:[],provider_count:1};
    throw Error(`Unexpected ${url}`);
  }}};
  require.cache[require.resolve(notifyPath)]={exports:{}};
  delete require.cache[require.resolve(fn)];
  return{handler:require(fn).handler,calls};
}
const payload={additional_day_request_id:REQUEST,service_id:SERVICE,customer_first_name:'Wrong',customer_email:'wrong@example.com',internal_notes:'Load the truck',assignments:[{provider_id:PROVIDER,scheduled_start:'2026-09-29T13:00:00Z',scheduled_end:'2026-09-29T17:00:00Z',billing_items:[{provider_service_rate_id:RATE,quantity:4,customer_unit_rate:100}]}]};
function event(value=payload){return{httpMethod:'POST',body:JSON.stringify({action:'CREATE_MULTI_ASSIGN',payload:value})};}
test('additional day creates an independently scheduled Job tied to the original request',async()=>{
  const h=setup(),result=await h.handler(event()),data=JSON.parse(result.body);
  assert.equal(result.statusCode,200);
  assert.equal(data.additional_day,'2026-09-29');
  const rpc=h.calls.find(c=>c.url==='/rest/v1/rpc/please_create_multi_provider_job');
  assert.equal(rpc.body.p_payload.customer_email,'customer@example.com');
  assert.equal(rpc.body.p_payload.customer_first_name,'Adrian');
  assert.match(rpc.body.p_payload.internal_notes,new RegExp(`\\[PLEASE-REQUEST-DAY:${REQUEST}:2026-09-29\\]`));
  assert.equal(rpc.body.p_payload.service_request_id,undefined);
});
test('cannot add an additional day before the first Job exists',async()=>{
  const h=setup('READY_TO_ASSIGN'),result=await h.handler(event());
  assert.equal(result.statusCode,409);
  assert.equal(h.calls.some(c=>c.url==='/rest/v1/rpc/please_create_multi_provider_job'),false);
});

test('customer tracking lists later days but hides unconfirmed Provider identities',async()=>{
  const publicFn=path.join(root,'netlify/functions/public-request-tracking.js');
  const first={id:JOB,reference:'PLS-JOB-1',status:'COMPLETED',estimated_duration_minutes:480};
  const later='99999999-9999-4999-8999-999999999999';
  require.cache[require.resolve(libPath)]={exports:{json:(statusCode,body)=>({statusCode,body:JSON.stringify(body)}),sbJson:async url=>{
    if(url.startsWith('/rest/v1/service_request_tracking_tokens?'))return[{service_request_id:REQUEST}];
    if(url.startsWith('/rest/v1/service_requests?'))return[{id:REQUEST,reference:'PLS-REQ-1',first_name:'Adrian',service_name:'Moving',status:'ASSIGNED',job_id:JOB,created_at:'2026-09-27T21:00:00Z'}];
    if(url.startsWith('/rest/v1/jobs?select=id,reference,service_name,status'))return[first];
    if(url.startsWith('/rest/v1/jobs?select=id,reference,status,estimated_duration_minutes,internal_notes'))return[{id:later,reference:'PLS-JOB-2',status:'PENDING_PROVIDER',estimated_duration_minutes:240,internal_notes:`[PLEASE-REQUEST-DAY:${REQUEST}:2026-09-29]`}];
    if(url.startsWith('/rest/v1/job_assignments?')&&url.includes(`job_id=eq.${JOB}`))return[];
    if(url.startsWith('/rest/v1/job_assignments?')&&url.includes(`job_id=in.(${later})`))return[{job_id:later,provider_id:PROVIDER,scheduled_start:'2026-09-29T13:00:00Z',scheduled_end:'2026-09-29T17:00:00Z',status:'PENDING'}];
    if(url.startsWith('/rest/v1/invoices?'))return[];
    if(url.startsWith('/rest/v1/job_service_events?'))return[];
    if(url.startsWith('/rest/v1/job_extension_requests?'))return[];
    throw Error(`Unexpected ${url}`);
  }}};
  delete require.cache[require.resolve(publicFn)];
  const result=await require(publicFn).handler({httpMethod:'GET',queryStringParameters:{token:'a'.repeat(48)}});
  assert.equal(result.statusCode,200);
  const data=JSON.parse(result.body);
  assert.equal(data.service_days.length,2);
  assert.equal(data.service_days[1].assignments[0].provider_name,null);
  assert.equal(data.public_status.code,'COORDINATING');
});
