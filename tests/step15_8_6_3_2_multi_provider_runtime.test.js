const path=require('path');
const root=path.resolve(__dirname,'../netlify/functions');
const calls=[];
const JOB='11111111-1111-1111-1111-111111111111',SERVICE='22222222-2222-2222-2222-222222222222',FAILED='33333333-3333-3333-3333-333333333333';
const SEB='44444444-4444-4444-4444-444444444444',FAB='99999999-9999-9999-9999-999999999999';
const RATE1='66666666-6666-6666-6666-666666666666',RATE2='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
let assignmentInsert=0;
function json(statusCode,payload){return {statusCode,body:JSON.stringify(payload),headers:{}}}
const fakeLib={
 json,sameOrigin:()=>true,requireAdmin:async()=>({user:{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}}),
 sbJson:async (url,opt={})=>{
  calls.push([url,opt.method||'GET',opt.body]);
  if(url.startsWith('/rest/v1/jobs?select=id,reference,status')) return [{id:JOB,reference:'PLS-JOB-X',status:'NEEDS_ASSIGNMENT',service_id:SERVICE,service_name:'Moving',required_provider_count:1,quoted_subtotal:25,estimated_duration_minutes:30}];
  if(url.startsWith('/rest/v1/job_assignments?select=id,job_id,provider_id,sequence_no,is_primary,status')&&url.includes('&id=eq.'+FAILED)) return [{id:FAILED,job_id:JOB,provider_id:SEB,sequence_no:1,is_primary:true,status:'DECLINED',scheduled_start:'2026-09-02T15:00:00Z',scheduled_end:'2026-09-02T15:30:00Z'}];
  if(url.startsWith('/rest/v1/job_assignments?select=id,job_id,provider_id,sequence_no,is_primary,status')&&url.includes('&job_id=eq.'+JOB)&&url.includes('order=sequence_no')) return [{id:FAILED,job_id:JOB,provider_id:SEB,sequence_no:1,is_primary:true,status:'DECLINED',scheduled_start:'2026-09-02T15:00:00Z',scheduled_end:'2026-09-02T15:30:00Z',assigned_at:'2026-09-01T10:00:00Z',responded_at:'2026-09-01T11:00:00Z'}];
  if(url.startsWith('/rest/v1/providers?select=id,status')) return [{id:url.includes(SEB)?SEB:FAB,status:'ACTIVE'}];
  if(url.startsWith('/rest/v1/provider_services?select=provider_id,service_id,active')) return [{provider_id:url.includes(SEB)?SEB:FAB,service_id:SERVICE,active:true}];
  if(url==='/rest/v1/rpc/provider_is_available_for_window') return true;
  if(url.startsWith('/rest/v1/job_assignments?select=id,job_id,status&provider_id=')) return [];
  if(url.startsWith('/rest/v1/provider_service_rates?select=')){
    if(url.includes('provider_id=eq.'+encodeURIComponent(SEB))) return [{id:RATE1,provider_id:SEB,service_id:SERVICE,rate_name:'Moving Labour',description:'',billing_unit:'hour',customer_rate:50,provider_compensation_method:'FIXED_CAD',provider_compensation:25,active:true}];
    if(url.includes('provider_id=eq.'+encodeURIComponent(FAB))) return [{id:RATE2,provider_id:FAB,service_id:SERVICE,rate_name:'Moving Helper',description:'',billing_unit:'hour',customer_rate:45,provider_compensation_method:'FIXED_CAD',provider_compensation:22,active:true}];
  }
  if(url.startsWith('/rest/v1/services?select=id,name')) return [{id:SERVICE,name:'Moving'}];
  if(url.startsWith('/rest/v1/provider_service_rates?id=eq.')&&opt.method==='PATCH') return null;
  if(url.startsWith('/rest/v1/job_billing_items?select=id,job_id,assignment_id,provider_id')&&url.includes('assignment_id=eq.'+FAILED)) return [{id:'55555555-5555-5555-5555-555555555555',job_id:JOB,assignment_id:FAILED,provider_id:SEB,provider_service_rate_id:RATE1,service_id:SERVICE,service_name:'Moving',description:'Moving Labour',quantity:.5,unit:'hour',customer_unit_rate:50,customer_line_total:25,unit_rate:50,line_total:25,provider_compensation_method:'FIXED_CAD',provider_compensation_value:25,provider_unit_rate:25,provider_line_total:12.5,gross_profit:12.5,sort_order:1010}];
  if(url.startsWith('/rest/v1/job_billing_items?select=id,job_id,assignment_id,provider_id')&&url.includes('assignment_id=is.null')) return [];
  if(url==='/rest/v1/job_assignments'&&opt.method==='POST'){
    assignmentInsert++;
    const b=JSON.parse(opt.body);return [{...b,id:assignmentInsert===1?'77777777-7777-7777-7777-777777777777':'88888888-8888-8888-8888-888888888888'}];
  }
  if(url==='/rest/v1/job_billing_items'&&opt.method==='POST'){
    const rows=JSON.parse(opt.body);return rows.map((r,i)=>({...r,id:`bbbbbbbb-bbbb-bbbb-bbbb-${String(i+1).padStart(12,'0')}`}));
  }
  if(url.startsWith('/rest/v1/job_billing_items?id=in.')&&opt.method==='DELETE') return null;
  if(url.startsWith('/rest/v1/job_billing_items?select=customer_line_total')) return [{customer_line_total:50},{customer_line_total:45}];
  if(url.startsWith('/rest/v1/jobs?id=eq.')&&opt.method==='PATCH') return null;
  if(url==='/rest/v1/assignment_status_history'||url==='/rest/v1/job_status_history'||url==='/rest/v1/provider_technical_history') return null;
  throw new Error('Unexpected '+(opt.method||'GET')+' '+url);
 }
};
const fakeNotify={
 assignmentContext:async(id)=>({provider_id:id.startsWith('7777')?SEB:FAB,status:'PENDING',scheduled_start:'2026-09-02T15:00:00Z',scheduled_end:'2026-09-02T16:00:00Z',providers:{display_name:'Provider'},jobs:{reference:'PLS-JOB-X',service_name:'Moving',work_address:'Calgary'}}),
 jobContext:async()=>({reference:'PLS-JOB-X',service_name:'Moving',work_address:'Calgary',customers:{email:'x@example.com',first_name:'Jacqueline'}}),
 sendProvider:async()=>({sent:true}),send:async()=>({sent:true}),money:n=>`$${n}`,formatDateTime:x=>x,baseUrl:()=> 'https://pleaseservice.ca'
};
require.cache[require.resolve(path.join(root,'_admin-lib.js'))]={exports:fakeLib};
require.cache[require.resolve(path.join(root,'_notify-lib.js'))]={exports:fakeNotify};
const {handler}=require(path.join(root,'admin-job-action.js'));
(async()=>{
 const event={httpMethod:'POST',headers:{},body:JSON.stringify({action:'REASSIGN_MULTI_WITH_BILLING',payload:{job_id:JOB,replace_assignment_id:FAILED,service_id:SERVICE,assignments:[
   {provider_id:SEB,scheduled_start:'2026-09-02T15:00:00Z',scheduled_end:'2026-09-02T16:00:00Z',assignment_message:'Primary corrected',replacement:true,is_primary:true,sequence_no:1,billing_items:[{provider_service_rate_id:RATE1,quantity:1,customer_unit_rate:50,provider_compensation_method:'FIXED_CAD',provider_compensation_value:30}]},
   {provider_id:FAB,scheduled_start:'2026-09-02T15:00:00Z',scheduled_end:'2026-09-02T16:00:00Z',assignment_message:'Additional helper',replacement:false,is_primary:false,sequence_no:2,billing_items:[{provider_service_rate_id:RATE2,quantity:1,customer_unit_rate:45,provider_compensation_method:'FIXED_CAD',provider_compensation_value:22}]}
 ]}})};
 const res=await handler(event);console.log(res.statusCode,res.body);if(res.statusCode!==200)process.exit(1);
 const out=JSON.parse(res.body);if(out.provider_count!==2||out.added_provider_count!==1||out.active_team_count!==2||out.replaced_assignment_id!==FAILED)process.exit(2);
 const inserts=calls.filter(c=>c[0]==='/rest/v1/job_assignments'&&c[1]==='POST').map(c=>JSON.parse(c[2]));
 if(inserts.length!==2||!inserts[0].is_primary||inserts[0].sequence_no!==1||inserts[1].is_primary||inserts[1].sequence_no!==2)process.exit(3);
 const jobPatch=calls.find(c=>c[0].startsWith('/rest/v1/jobs?id=eq.')&&c[1]==='PATCH');const jp=JSON.parse(jobPatch[2]);
 if(jp.required_provider_count!==2||jp.status!=='PENDING_PROVIDER'||jp.quoted_subtotal!==95)process.exit(4);
 const billingPost=calls.find(c=>c[0]==='/rest/v1/job_billing_items'&&c[1]==='POST');const billing=JSON.parse(billingPost[2]);
 if(billing.length!==2||billing[0].assignment_id===billing[1].assignment_id||billing[0].provider_compensation_value!==30)process.exit(5);
 console.log('MULTI REASSIGNMENT RUNTIME MOCK PASS');
})();
