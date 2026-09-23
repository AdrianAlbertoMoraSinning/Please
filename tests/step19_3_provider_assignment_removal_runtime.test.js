'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('path');
const root=path.join(__dirname,'..');
const fnPath=path.join(root,'netlify/functions/admin-job-action.js');
const libPath=path.join(root,'netlify/functions/_admin-lib.js');
const notifyPath=path.join(root,'netlify/functions/_notify-lib.js');

const ASSIGN='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JOB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROVIDER='cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function build({jobStatus='COMPLETED',events=[],evidence=[],payments=[],extensions=[],remaining=[]}={}){
  const calls=[],sent=[];
  const assignment={id:ASSIGN,job_id:JOB,provider_id:PROVIDER,status:'CONFIRMED',scheduled_start:'2026-09-10T16:00:00Z',scheduled_end:'2026-09-10T18:00:00Z',providers:{display_name:'Maria'},jobs:{id:JOB,reference:'PLS-JOB-20260910-ABC123',status:jobStatus,service_name:'Cleaning',required_provider_count:2}};
  const fakeLib={
    sameOrigin:()=>true,
    requireAdmin:async()=>({user:{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}}),
    json:(status,body)=>({statusCode:status,body:JSON.stringify(body)}),
    sbJson:async(url,opt={})=>{
      const body=opt.body?JSON.parse(opt.body):null;calls.push({url,opt,body});
      if(url.startsWith('/rest/v1/job_assignments?select=id,job_id,provider_id,status,scheduled_start'))return[assignment];
      if(url.startsWith('/rest/v1/job_service_events?'))return events;
      if(url.startsWith('/rest/v1/job_service_evidence?'))return evidence;
      if(url.startsWith('/rest/v1/provider_payments?'))return payments;
      if(url.startsWith('/rest/v1/job_extension_requests?'))return extensions;
      if(url.startsWith(`/rest/v1/job_assignments?id=eq.${ASSIGN}`)&&opt.method==='PATCH')return[{id:ASSIGN,job_id:JOB,provider_id:PROVIDER,status:'CANCELLED'}];
      if(url==='/rest/v1/assignment_status_history')return[];
      if(url.startsWith(`/rest/v1/job_assignments?select=id,status&job_id=eq.${JOB}`))return remaining;
      if(url.startsWith(`/rest/v1/jobs?id=eq.${JOB}`)&&opt.method==='PATCH')return[];
      if(url==='/rest/v1/job_status_history')return[];
      if(url==='/rest/v1/provider_technical_history')return[];
      throw new Error(`Unexpected ${url}`);
    }
  };
  const fakeNotify={
    assignmentContext:async()=>({...assignment,status:'CANCELLED',jobs:{...assignment.jobs,work_address:'Calgary'},providers:{display_name:'Maria'}}),
    sendProvider:async (providerId,opts)=>{sent.push({kind:'provider',providerId,...opts});return{sent:true}},
    sendAdmins:async opts=>{sent.push({kind:'admin',...opts});return{sent:true}},
    send:async opts=>{sent.push({kind:'customer',...opts});return{sent:true}},
    baseUrl:()=> 'https://pleaseservice.ca',
    formatDateTime:v=>String(v||''),
    money:n=>String(n)
  };
  require.cache[require.resolve(libPath)]={exports:fakeLib};
  require.cache[require.resolve(notifyPath)]={exports:fakeNotify};
  delete require.cache[require.resolve(fnPath)];
  return{handler:require(fnPath).handler,calls,sent};
}
function event(reduce=false){return{httpMethod:'POST',headers:{origin:'https://pleaseservice.ca'},body:JSON.stringify({action:'REMOVE_PROVIDER_ASSIGNMENT',payload:{assignment_id:ASSIGN,reason:'Provider replaced before service. Jorge performed the work instead.',reduce_team_requirement:reduce}})}};

test('confirmed non-attending Provider can be removed from a completed Job without reopening it or emailing customer',async()=>{
  const h=build();
  const res=await h.handler(event());
  assert.equal(res.statusCode,200);
  const body=JSON.parse(res.body);
  assert.equal(body.status,'CANCELLED');
  assert.equal(body.job_status,'COMPLETED');
  assert.equal(body.customer_notification_sent,false);
  assert.equal(h.sent.filter(x=>x.kind==='customer').length,0);
  assert.equal(h.sent.filter(x=>x.kind==='provider').length,1);
  assert.equal(h.sent.filter(x=>x.kind==='admin').length,1);
  assert.match(h.sent[0].title,/removed from this PLEASE service/i);
  assert.equal(h.calls.some(c=>c.url.startsWith(`/rest/v1/jobs?id=eq.${JOB}`)&&c.opt.method==='PATCH'),false);
  const patch=h.calls.find(c=>c.url.startsWith(`/rest/v1/job_assignments?id=eq.${ASSIGN}`)&&c.opt.method==='PATCH');
  assert.equal(patch.body.status,'CANCELLED');
});

test('Provider cannot be removed after service activity has begun',async()=>{
  const h=build({events:[{id:'e1',event_type:'ARRIVED'}]});
  const res=await h.handler(event());
  assert.equal(res.statusCode,409);
  assert.match(JSON.parse(res.body).error,/service activity or evidence/i);
  assert.equal(h.calls.some(c=>c.url.startsWith(`/rest/v1/job_assignments?id=eq.${ASSIGN}`)&&c.opt.method==='PATCH'),false);
  assert.equal(h.sent.length,0);
});

test('active team status is recalculated after safe Provider removal',async()=>{
  const h=build({jobStatus:'PENDING_PROVIDER',remaining:[{id:'x1',status:'CONFIRMED'},{id:'x2',status:'CONFIRMED'}]});
  const res=await h.handler(event());
  assert.equal(res.statusCode,200);
  assert.equal(JSON.parse(res.body).job_status,'CONFIRMED');
  const patch=h.calls.find(c=>c.url.startsWith(`/rest/v1/jobs?id=eq.${JOB}`)&&c.opt.method==='PATCH');
  assert.equal(patch.body.status,'CONFIRMED');
});


test('intentional team reduction persists new required count and keeps remaining Provider operational',async()=>{
  const h=build({jobStatus:'CONFIRMED',remaining:[{id:'x1',status:'CONFIRMED'}]});
  const res=await h.handler(event(true));
  assert.equal(res.statusCode,200);
  const body=JSON.parse(res.body);
  assert.equal(body.job_status,'CONFIRMED');
  assert.equal(body.team_requirement_reduced,true);
  const patches=h.calls.filter(c=>c.url.startsWith(`/rest/v1/jobs?id=eq.${JOB}`)&&c.opt.method==='PATCH');
  assert.equal(patches.length,1);
  assert.equal(patches[0].body.required_provider_count,1);
  assert.equal(patches[0].body.status,'CONFIRMED');
  assert.equal(h.sent.filter(x=>x.kind==='provider').length,1);
  assert.equal(h.sent.filter(x=>x.kind==='admin').length,1);
});
