const path=require('path');
const root=path.resolve(__dirname,'../netlify/functions'),calls=[];
const JOB='11111111-1111-1111-1111-111111111111',REQ='22222222-2222-2222-2222-222222222222',A1='33333333-3333-3333-3333-333333333333',A2='44444444-4444-4444-4444-444444444444',P1='55555555-5555-5555-5555-555555555555',P2='66666666-6666-6666-6666-666666666666';
const B1='77777777-7777-7777-7777-777777777777',B2='88888888-8888-8888-8888-888888888888';
const original={
 job:{id:JOB,reference:'PLS-JOB-HOURS',status:'CONFIRMED',service_name:'Cleaning',work_address:'100 Main St, Calgary, AB',work_description:'Clean home',internal_notes:null,estimated_duration_minutes:240,quoted_subtotal:320,source_service_request_id:REQ,customers:{first_name:'Maria',last_name:'Client',email:'customer@example.com',phone:'4035550000'}},
 assignments:[
  {id:A1,job_id:JOB,provider_id:P1,status:'CONFIRMED',scheduled_start:'2026-09-03T15:00:00.000Z',scheduled_end:'2026-09-03T19:00:00.000Z',sequence_no:1,is_primary:true,providers:{display_name:'Sebastian'}},
  {id:A2,job_id:JOB,provider_id:P2,status:'CONFIRMED',scheduled_start:'2026-09-03T15:00:00.000Z',scheduled_end:'2026-09-03T19:00:00.000Z',sequence_no:2,is_primary:false,providers:{display_name:'Fabian'}}
 ],
 billing:[
  {id:B1,job_id:JOB,assignment_id:A1,provider_id:P1,quantity:4,unit:'hour',customer_unit_rate:40,customer_line_total:160,provider_unit_rate:25,provider_line_total:100,gross_profit:60,unit_rate:40,line_total:160},
  {id:B2,job_id:JOB,assignment_id:A2,provider_id:P2,quantity:4,unit:'hour',customer_unit_rate:40,customer_line_total:160,provider_unit_rate:20,provider_line_total:80,gross_profit:80,unit_rate:40,line_total:160}
 ],
 request:{id:REQ,reference:'PLS-REQ-HOURS',status:'ASSIGNED',preferred_date:'2026-09-03',preferred_start_time:'09:00',estimated_hours:4,street_address:'100 Main St',city:'Calgary',province:'AB',postal_code:'T2X 0X0',work_description:'Clean home'}
};
let currentBilling=original.billing.map(x=>({...x}));
const fakeLib={
 sbJson:async(url,opt={})=>{
  const method=opt.method||'GET';calls.push([url,method,opt.body]);
  if(url.startsWith('/rest/v1/jobs?select=id,reference,status'))return [{...original.job}];
  if(url.startsWith('/rest/v1/job_assignments?select=id,job_id,provider_id,status'))return original.assignments.map(x=>({...x}));
  if(url.startsWith('/rest/v1/job_service_events?select=assignment_id,event_type'))return [];
  if(url.startsWith('/rest/v1/job_assignments?select=id,job_id,scheduled_start,scheduled_end,status&provider_id='))return [];
  if(url.startsWith('/rest/v1/job_billing_items?select=id,job_id,assignment_id,provider_id'))return currentBilling.map(x=>({...x}));
  if(url.startsWith('/rest/v1/service_requests?select=id,reference,status'))return [{...original.request}];
  if(url.startsWith('/rest/v1/job_assignments?id=eq.')&&method==='PATCH')return null;
  if(url.startsWith('/rest/v1/job_billing_items?id=eq.')&&method==='PATCH'){
   const id=decodeURIComponent(url.match(/id=eq\.([^&]+)/)[1]),patch=JSON.parse(opt.body);currentBilling=currentBilling.map(x=>x.id===id?{...x,...patch}:x);return null;
  }
  if(url.startsWith('/rest/v1/job_billing_items?select=customer_line_total'))return currentBilling.map(x=>({customer_line_total:x.customer_line_total}));
  if(url.startsWith('/rest/v1/job_billing_items?select=id,quantity,unit,customer_unit_rate'))return currentBilling.map(x=>({...x}));
  if(url.startsWith('/rest/v1/jobs?id=eq.')&&method==='PATCH')return null;
  if(url.startsWith('/rest/v1/service_requests?id=eq.')&&method==='PATCH')return null;
  if(['/rest/v1/assignment_status_history','/rest/v1/job_status_history','/rest/v1/service_request_status_history'].includes(url))return null;
  throw new Error(`Unexpected ${method} ${url}`);
 }
};
const fakeNotify={
 sendProvider:async()=>({sent:true}),send:async()=>({sent:true}),formatDateTime:x=>x,baseUrl:()=> 'https://pleaseservice.ca'
};
require.cache[require.resolve(path.join(root,'_admin-lib.js'))]={exports:fakeLib};
require.cache[require.resolve(path.join(root,'_notify-lib.js'))]={exports:fakeNotify};
const helper=require(path.join(root,'_job-schedule-lib.js'));
(async()=>{
 const start='2026-09-03T15:00:00.000Z',end='2026-09-03T17:00:00.000Z';
 const out=await helper.updateActiveJob({actorId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',jobId:JOB,applyToTeam:true,scheduledStart:start,scheduledEnd:end,estimatedDurationMinutes:120,syncHourlyBilling:true,syncSourceRequest:true,reason:'Customer reduced service from 4h to 2h',notifyPeople:true});
 console.log(JSON.stringify(out));
 if(out.updated_assignments!==2||out.hourly_billing_items_updated!==2||out.estimated_duration_minutes!==120||out.notifications_sent!==3)process.exit(1);
 if(currentBilling.some(x=>x.quantity!==2)||currentBilling[0].customer_line_total!==80||currentBilling[0].provider_line_total!==50||currentBilling[0].gross_profit!==30||currentBilling[1].provider_line_total!==40)process.exit(2);
 const assignmentPatches=calls.filter(c=>c[0].startsWith('/rest/v1/job_assignments?id=eq.')&&c[1]==='PATCH').map(c=>JSON.parse(c[2]));
 if(assignmentPatches.length!==2||assignmentPatches.some(x=>x.scheduled_end!==end))process.exit(3);
 const jobPatch=JSON.parse(calls.find(c=>c[0].startsWith('/rest/v1/jobs?id=eq.')&&c[1]==='PATCH')[2]);
 if(jobPatch.estimated_duration_minutes!==120||jobPatch.quoted_subtotal!==160)process.exit(4);
 const reqPatch=JSON.parse(calls.find(c=>c[0].startsWith('/rest/v1/service_requests?id=eq.')&&c[1]==='PATCH')[2]);
 if(reqPatch.preferred_date!=='2026-09-03'||reqPatch.preferred_start_time!=='09:00'||reqPatch.estimated_hours!==2||'street_address' in reqPatch)process.exit(5);
 console.log('STEP 15.9.1 ACTIVE JOB SCHEDULE RUNTIME MOCK PASS');
})().catch(e=>{console.error(e);process.exit(10)});
