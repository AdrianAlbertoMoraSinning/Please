'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('path');
const root=path.join(__dirname,'..');
const fnPath=path.join(root,'netlify/functions/provider-assignment-action.js');
const libPath=path.join(root,'netlify/functions/_provider-lib.js');
const notifyPath=path.join(root,'netlify/functions/_notify-lib.js');

function harness(team){
  const sent=[];
  const job={id:'job-1',reference:'PLS-JOB-1',service_name:'Car Detailing',customers:{first_name:'Maria',email:'maria@example.com'}};
  const before={id:'a-1',job_id:'job-1',provider_id:'p-1',status:'PENDING',scheduled_start:'2026-09-12T16:00:00Z',scheduled_end:'2026-09-12T17:00:00Z',providers:{display_name:'Alex'},jobs:job};
  const after={...before,status:'CONFIRMED'};
  const fakeLib={
    sameOrigin:()=>true,
    requireProvider:async()=>({user:{id:'u-1',email:'provider@example.com'},provider:{id:'p-1',display_name:'Alex'}}),
    json:(status,body)=>({statusCode:status,body:JSON.stringify(body)}),
    sbJson:async(url,opt={})=>{
      if(url==='/rest/v1/rpc/provider_portal_assignment_action')return{ok:true};
      if(url.startsWith('/rest/v1/job_assignments?select=id,job_id,status'))return team;
      throw new Error(`Unexpected ${url}`);
    }
  };
  let contexts=0;
  const fakeNotify={
    assignmentContext:async()=>contexts++===0?before:after,
    sendAdmins:async opts=>{sent.push({kind:'admin',...opts});return{sent:true}},
    send:async opts=>{sent.push({kind:'customer',...opts});return{sent:true}},
    baseUrl:()=> 'https://pleaseservice.ca',
    formatDateTime:v=>String(v||'')
  };
  require.cache[require.resolve(libPath)]={exports:fakeLib};
  require.cache[require.resolve(notifyPath)]={exports:fakeNotify};
  delete require.cache[require.resolve(fnPath)];
  return {handler:require(fnPath).handler,sent};
}
function event(){return{httpMethod:'POST',headers:{origin:'https://pleaseservice.ca'},body:JSON.stringify({assignment_id:'a-1',action:'CONFIRM',note:''})};}

test('first confirmation in a multi-provider team does not email customer yet',async()=>{
  const h=harness([
    {id:'a-1',job_id:'job-1',status:'CONFIRMED',sequence_no:1,scheduled_start:'2026-09-12T16:00:00Z',scheduled_end:'2026-09-12T17:00:00Z',providers:{display_name:'Alex'}},
    {id:'a-2',job_id:'job-1',status:'PENDING',sequence_no:2,scheduled_start:'2026-09-12T16:00:00Z',scheduled_end:'2026-09-12T17:00:00Z',providers:{display_name:'Sam'}}
  ]);
  const res=await h.handler(event());
  assert.equal(res.statusCode,200);
  assert.equal(h.sent.filter(x=>x.kind==='customer').length,0);
  assert.equal(h.sent.filter(x=>x.kind==='admin').length,1);
});

test('last required confirmation sends exactly one whole-service confirmation email',async()=>{
  const h=harness([
    {id:'a-1',job_id:'job-1',status:'CONFIRMED',sequence_no:1,scheduled_start:'2026-09-12T16:00:00Z',scheduled_end:'2026-09-12T17:00:00Z',providers:{display_name:'Alex'}},
    {id:'a-2',job_id:'job-1',status:'CONFIRMED',sequence_no:2,scheduled_start:'2026-09-12T16:00:00Z',scheduled_end:'2026-09-12T18:00:00Z',providers:{display_name:'Sam'}}
  ]);
  const res=await h.handler(event());
  assert.equal(res.statusCode,200);
  const customer=h.sent.filter(x=>x.kind==='customer');
  assert.equal(customer.length,1);
  assert.equal(customer[0].title,'Your PLEASE service is confirmed');
  assert.equal(customer[0].idempotencyKey,'please-customer-service-confirmed-job-1');
  assert.match(customer[0].details.find(x=>x[0]==='Professionals')[1],/Alex, Sam/);
});
