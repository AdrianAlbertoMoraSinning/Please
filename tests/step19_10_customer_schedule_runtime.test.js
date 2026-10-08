'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {customerSchedule}=require('../netlify/functions/_customer-schedule-lib');
const start='2026-10-10T15:00:00.000Z',end='2026-10-10T18:00:00.000Z';
const pending={id:'private-assignment',provider_id:'private-provider',status:'PENDING',scheduled_start:start,scheduled_end:end,is_primary:true};
function mockModule(file,mocks){const resolved=require.resolve(file);delete require.cache[resolved];const saved=[];for(const [name,value]of Object.entries(mocks)){const key=require.resolve(name);saved.push([key,require.cache[key]]);require.cache[key]={id:key,filename:key,loaded:true,exports:value};}const mod=require(file);return{mod,restore(){delete require.cache[resolved];for(const[k,v]of saved){if(v)require.cache[k]=v;else delete require.cache[k];}}};}
test('pending schedules are public without Provider identity; duplicate windows and obsolete slots are removed',()=>{
 const result=customerSchedule([pending,{...pending,id:'second'},{...pending,status:'DECLINED',scheduled_start:'2026-10-09T20:00:00Z'},{...pending,status:'CANCELLED'}],'PENDING_PROVIDER');
 assert.deepEqual(result,{status:'SCHEDULED',windows:[{start,end}]});
 assert.equal(customerSchedule([pending],'CANCELLED'),null);
 assert.equal(customerSchedule([pending],'NEEDS_ASSIGNMENT'),null);
 assert.equal(customerSchedule([{...pending,status:'CONFIRMED'}],'CONFIRMED').status,'CONFIRMED');
 assert.equal(customerSchedule([{...pending,scheduled_start:'bad'}]),null);
});
test('tracking API exposes assigned Saturday schedule while keeping pending team private and original Friday request intact',async()=>{
 const fake={json:(statusCode,p)=>({statusCode,body:JSON.stringify(p)}),sbJson:async url=>{
  if(url.includes('service_request_tracking_tokens'))return[{service_request_id:'req'}];
  if(url.startsWith('/rest/v1/service_requests?'))return[{id:'req',reference:'REQ',first_name:'Kendra',status:'ASSIGNED',job_id:'job',preferred_date:'2026-10-09',preferred_start_time:'14:00'}];
  if(url.startsWith('/rest/v1/jobs?'))return url.includes('internal_notes=like')?[]:[{id:'job',reference:'JOB',status:'PENDING_PROVIDER',estimated_duration_minutes:180}];
  if(url.startsWith('/rest/v1/job_assignments?'))return[pending];
  if(url.startsWith('/rest/v1/providers?'))throw Error('Pending Provider must not be loaded');
  return[];
 }};
 const h=mockModule('../netlify/functions/public-request-tracking',{'../netlify/functions/_admin-lib':fake});
 try{const response=await h.mod.handler({httpMethod:'GET',queryStringParameters:{token:'a'.repeat(48)}});assert.equal(response.statusCode,200);const p=JSON.parse(response.body);assert.equal(p.assignment,null);assert.deepEqual(p.team,[]);assert.deepEqual(p.scheduled_schedule,{status:'SCHEDULED',windows:[{start,end}]});assert.equal(p.request.preferred_start_time,'14:00');assert.deepEqual(p.service_days[0].assignments,[{start,end,status:'SCHEDULED'}]);assert.doesNotMatch(response.body,/private-provider|private-assignment/);}finally{h.restore();}
});
async function render(payload){const box={hidden:false,innerHTML:''},empty={hidden:true};const document={getElementById:id=>id==='tracking-card'?box:id==='tracking-no-token'?empty:null};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/track-request.js'),'utf8'),{document,location:{search:'?token='+ 'a'.repeat(48),href:'https://pleaseservice.ca/track-request.html'},URL,URLSearchParams,Intl,Date,fetch:async()=>({ok:true,json:async()=>payload})});await new Promise(resolve=>setImmediate(resolve));return box.innerHTML;}
const base={request:{reference:'REQ',service_name:'Moving',preferred_date:'2026-10-09',preferred_start_time:'14:00'},job:{reference:'JOB',status:'PENDING_PROVIDER'},public_status:{code:'SCHEDULING',label:'Scheduling service'}};
test('customer page prioritizes assigned schedule even with no confirmed Provider and never shows 2 PM as scheduled',async()=>{
 const html=await render({...base,scheduled_schedule:customerSchedule([pending],'PENDING_PROVIDER')});assert.match(html,/Scheduled by PLEASE/);assert.match(html,/Oct 10, 2026/);assert.match(html,/9:00/);assert.match(html,/12:00/);assert.doesNotMatch(html,/Preferred time|2:00 PM|Requested Schedule/);
 const unscheduled=await render(base);assert.match(unscheduled,/coordinating a new service schedule/);assert.doesNotMatch(unscheduled,/2:00 PM/);
 const cancelled=await render({...base,job:{reference:'JOB',status:'CANCELLED'},scheduled_schedule:null,assignment:{scheduled_start:start,scheduled_end:end}});assert.match(cancelled,/service has been cancelled/);assert.doesNotMatch(cancelled,/Confirmed Service Schedule/);
 const original=await render({...base,job:null});assert.match(original,/Requested Schedule/);assert.match(original,/2:00 PM/);assert.match(original,/not a confirmed booking/);
});
test('tracking-link email includes saved schedule and preview generation sends no email',async()=>{
 const sent=[];const fake={requireAdmin:async()=>({user:{email:'admin@example.com'}}),sameOrigin:()=>true,json:(statusCode,p)=>({statusCode,body:JSON.stringify(p)}),sbJson:async url=>url.startsWith('/rest/v1/service_requests?')?[{id:'a'.repeat(36),reference:'REQ',email:'customer@example.com',job_id:'job'}]:url.startsWith('/rest/v1/jobs?')?[{status:'PENDING_PROVIDER'}]:[pending]};
 const h=mockModule('../netlify/functions/admin-request-tracking-link',{'../netlify/functions/_admin-lib':fake,'../netlify/functions/_security-lib':{issueTrackingToken:async()=>{}},'../netlify/functions/_notify-lib':{baseUrl:()=> 'https://pleaseservice.ca',formatDateTime:v=>v,send:async p=>{sent.push(p);return{sent:true}}}});
 try{const request=notify_customer=>({httpMethod:'POST',body:JSON.stringify({request_id:'a'.repeat(36),notify_customer})});assert.equal((await h.mod.handler(request(true))).statusCode,200);assert.match(JSON.stringify(sent[0].details),/2026-10-10T15:00:00.000Z/);assert.doesNotMatch(JSON.stringify(sent),/14:00|private-provider/);await h.mod.handler(request(false));assert.equal(sent.length,1);}finally{h.restore();}
});
