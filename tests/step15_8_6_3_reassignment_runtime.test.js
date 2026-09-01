const path=require('path');
const root=path.resolve(__dirname,'../netlify/functions');
const calls=[];
function json(statusCode,payload){return {statusCode,body:JSON.stringify(payload),headers:{}}}
const fakeLib={
 json,sameOrigin:()=>true,requireAdmin:async()=>({user:{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}}),
 sbJson:async (url,opt={})=>{
  calls.push([url,opt.method||'GET',opt.body]);
  if(url.startsWith('/rest/v1/jobs?select=id,reference,status')) return [{id:'11111111-1111-1111-1111-111111111111',reference:'PLS-JOB-X',status:'NEEDS_ASSIGNMENT',service_id:'22222222-2222-2222-2222-222222222222',service_name:'Moving',required_provider_count:1}];
  if(url.includes('/rest/v1/job_assignments?select=id,job_id,provider_id,sequence_no,is_primary,status') && url.includes('&id=eq.33333333')) return [{id:'33333333-3333-3333-3333-333333333333',job_id:'11111111-1111-1111-1111-111111111111',provider_id:'44444444-4444-4444-4444-444444444444',sequence_no:1,is_primary:true,status:'DECLINED'}];
  if(url.startsWith('/rest/v1/job_billing_items?select=id,assignment_id,provider_id') && url.includes('assignment_id=eq.')) return [{id:'55555555-5555-5555-5555-555555555555',assignment_id:'33333333-3333-3333-3333-333333333333',provider_id:'44444444-4444-4444-4444-444444444444'}];
  if(url.startsWith('/rest/v1/job_billing_items?select=id,assignment_id,provider_id') && url.includes('assignment_id=is.null')) return [];
  if(url.startsWith('/rest/v1/provider_service_rates?select=')) return [{id:'66666666-6666-6666-6666-666666666666',provider_id:'44444444-4444-4444-4444-444444444444',service_id:'22222222-2222-2222-2222-222222222222',rate_name:'Labour',description:'',billing_unit:'hour',customer_rate:50,provider_compensation_method:'FIXED_CAD',provider_compensation:25,active:true}];
  if(url.startsWith('/rest/v1/services?select=id,name')) return [{id:'22222222-2222-2222-2222-222222222222',name:'Moving'}];
  if(url.startsWith('/rest/v1/provider_service_rates?id=eq.') && opt.method==='PATCH') return null;
  if(url==='/rest/v1/rpc/please_portal_job_action' && JSON.parse(opt.body).p_action==='ASSIGN_EXISTING') return {ok:true,job_id:'11111111-1111-1111-1111-111111111111',assignment_id:'77777777-7777-7777-7777-777777777777',status:'PENDING'};
  if(url.startsWith('/rest/v1/job_assignments?id=eq.7777') && opt.method==='PATCH') return null;
  if(url==='/rest/v1/job_billing_items' && opt.method==='POST') return [{id:'88888888-8888-8888-8888-888888888888'}];
  if(url.startsWith('/rest/v1/job_billing_items?id=in.') && opt.method==='DELETE') return null;
  if(url.startsWith('/rest/v1/job_billing_items?select=customer_line_total')) return [{customer_line_total:25}];
  if(url.startsWith('/rest/v1/jobs?id=eq.') && opt.method==='PATCH') return null;
  if(url==='/rest/v1/job_status_history' || url==='/rest/v1/provider_technical_history') return null;
  throw new Error('Unexpected '+(opt.method||'GET')+' '+url);
 }
};
const fakeNotify={
 assignmentContext:async()=>({provider_id:'44444444-4444-4444-4444-444444444444',status:'PENDING',scheduled_start:'2026-09-02T15:00:00Z',scheduled_end:'2026-09-02T15:30:00Z',providers:{display_name:'Sebastian'},jobs:{reference:'PLS-JOB-X',service_name:'Moving',work_address:'Calgary'}}),
 jobContext:async()=>({reference:'PLS-JOB-X',service_name:'Moving',work_address:'Calgary',customers:{email:'x@example.com',first_name:'Jacqueline'}}),
 sendProvider:async()=>({sent:true}),send:async()=>({sent:true}),money:n=>`$${n}`,formatDateTime:x=>x,baseUrl:()=> 'https://pleaseservice.ca'
};
require.cache[require.resolve(path.join(root,'_admin-lib.js'))]={exports:fakeLib};
require.cache[require.resolve(path.join(root,'_notify-lib.js'))]={exports:fakeNotify};
const {handler}=require(path.join(root,'admin-job-action.js'));
(async()=>{
 const event={httpMethod:'POST',headers:{},body:JSON.stringify({action:'REASSIGN_WITH_BILLING',payload:{job_id:'11111111-1111-1111-1111-111111111111',replace_assignment_id:'33333333-3333-3333-3333-333333333333',provider_id:'44444444-4444-4444-4444-444444444444',service_id:'22222222-2222-2222-2222-222222222222',scheduled_start:'2026-09-02T15:00:00Z',scheduled_end:'2026-09-02T15:30:00Z',billing_items:[{provider_service_rate_id:'66666666-6666-6666-6666-666666666666',quantity:.5,customer_unit_rate:50,provider_compensation_method:'FIXED_CAD',provider_compensation_value:30}]}})};
 const res=await handler(event); console.log(res.statusCode,res.body);
 if(res.statusCode!==200) process.exit(1);
 const out=JSON.parse(res.body);
 if(out.billing_items_replaced!==1||out.provider_rates_updated!==1||out.job_reference!=='PLS-JOB-X') process.exit(2);
 const patch=calls.find(c=>c[0].startsWith('/rest/v1/job_assignments?id=eq.7777')&&c[1]==='PATCH');
 if(!patch||!JSON.parse(patch[2]).is_primary) process.exit(3);
 const insert=calls.find(c=>c[0]==='/rest/v1/job_billing_items'&&c[1]==='POST');
 const row=JSON.parse(insert[2])[0];
 if(row.quantity!==0.5||row.customer_unit_rate!==50||row.provider_compensation_value!==30||row.assignment_id!=='77777777-7777-7777-7777-777777777777') process.exit(4);
 console.log('RUNTIME MOCK PASS');
})();
