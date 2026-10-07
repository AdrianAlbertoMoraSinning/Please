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
test('assignment creation accepts Hourly, Flat Rate and Quantity with correct customer and Provider totals',async()=>{
 for(const [unit,quantity,customer,provider,total,cost] of [['hour',2,100,50,200,100],['service',9,500,200,500,200],['item',3,40,20,120,60]]){
  const h=setup(),value=JSON.parse(JSON.stringify(payload));value.assignments[0].billing_items=[{provider_service_rate_id:RATE,unit,quantity,customer_unit_rate:customer,provider_compensation_value:provider,provider_compensation_method:'FIXED_CAD'}];
  const result=await h.handler(event(value));assert.equal(result.statusCode,200,result.body);
  const row=h.calls.find(c=>c.url==='/rest/v1/rpc/please_create_multi_provider_job').body.p_payload.assignments[0].billing_items[0];
  assert.equal(row.unit,unit);assert.equal(row.quantity,unit==='service'?1:quantity);assert.equal(row.customer_line_total,total);assert.equal(row.provider_line_total,cost);
  assert.equal(h.calls.some(c=>c.url.startsWith('/rest/v1/provider_service_rates?id=')),false,'Changing the Job billing basis must not rewrite the Provider catalogue');
 }
});
