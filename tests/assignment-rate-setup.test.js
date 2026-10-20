const test=require('node:test');
const assert=require('node:assert/strict');
const {prepare}=require('../js/assignment-rate-setup');
const base={name:'Full interior and exterior',unit:'service',method:'FIXED_CAD',serviceId:'11111111-1111-4111-8111-111111111111',customer:'250',provider:'100'};
test('requires explicit customer and Provider values; explicit zero is allowed',()=>{
 for(const field of ['customer','provider'])for(const value of ['',null,undefined,'abc','-1'])assert.throws(()=>prepare({...base,[field]:value}));
 const x=prepare({...base,provider:'0'});assert.equal(x.customerRate,250);assert.equal(x.payload.provider_compensation,0);assert.equal(x.quantity,1);
});
test('flat, hourly and percent values stay separate with multi-day protection',()=>{
 assert.equal(prepare({...base,unit:'hour',minutes:120}).quantity,2);
 const x=prepare({...base,method:'PERCENT',provider:'25',multiDay:true});assert.equal(x.payload.provider_compensation,25);assert.equal(x.customerRate,250);assert.equal(x.quantity,1);
 assert.throws(()=>prepare({...base,method:'PERCENT',provider:'101'}));assert.throws(()=>prepare({...base,unit:'hour',multiDay:true}));
});
test('existing admin endpoint can create owned rates for either profile without creating assignments',async()=>{
 const lib=require('../netlify/functions/_admin-lib'),notify=require('../netlify/functions/_notify-lib'),handler=require('../netlify/functions/admin-provider-rate-action').handler;
 const old={sameOrigin:lib.sameOrigin,requireAdmin:lib.requireAdmin,sbJson:lib.sbJson,sendProvider:notify.sendProvider};const writes=[];
 try{
  lib.sameOrigin=()=>true;lib.requireAdmin=async()=>({user:{id:'admin'}});notify.sendProvider=async()=>({ok:true});
  lib.sbJson=async(url,opt={})=>{if(url.startsWith('/rest/v1/providers?'))return[{id:'provider',display_name:'Profile',status:'ACTIVE'}];if(url.startsWith('/rest/v1/provider_services?'))return[{service_id:base.serviceId}];if(opt.method==='POST'){const row=JSON.parse(opt.body);writes.push({url,row});return[{id:'22222222-2222-4222-8222-222222222222',...row}]}return[]};
  for(const id of ['33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444']){
   const r=await handler({httpMethod:'POST',body:JSON.stringify({provider_id:id,action:'SAVE',payload:prepare({...base,provider:'0'}).payload})});assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).rate.provider_id,id);
  }
  assert.equal(writes.filter(x=>x.url.startsWith('/rest/v1/provider_service_rates?')).length,2);assert.equal(writes.some(x=>/job_assignments|jobs\?/.test(x.url)),false);
  lib.sameOrigin=()=>false;assert.equal((await handler({httpMethod:'POST'})).statusCode,403);
 }finally{Object.assign(lib,{sameOrigin:old.sameOrigin,requireAdmin:old.requireAdmin,sbJson:old.sbJson});notify.sendProvider=old.sendProvider;}
});
