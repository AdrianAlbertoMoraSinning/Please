const lib=require('./_provider-lib');
exports.handler=async event=>{
  if(event.httpMethod!=='GET')return lib.json(405,{error:'Method not allowed'});
  try{
    const a=await lib.requireProvider(event),pid=a.provider.id,q=encodeURIComponent(pid);
    const [providers,ps,services,av,ex,assignRaw,rates,changeRequests]=await Promise.all([
      lib.sbJson(`/rest/v1/providers?select=id,reference,display_name,company_name,public_title,short_bio,technical_description,service_area,licensed_certified,insured,status,public_visible,slug&id=eq.${q}&limit=1`),
      lib.sbJson(`/rest/v1/provider_services?select=service_id,active,provider_notes&provider_id=eq.${q}`),
      lib.sbJson('/rest/v1/services?select=id,name,short_description,active&active=eq.true&order=sort_order.asc'),
      lib.sbJson(`/rest/v1/provider_availability?select=id,weekday,start_time,end_time,active&provider_id=eq.${q}&active=eq.true&order=weekday.asc,start_time.asc`),
      lib.sbJson(`/rest/v1/provider_availability_exceptions?select=id,exception_date,start_time,end_time,exception_type,reason,created_at&provider_id=eq.${q}&order=exception_date.asc,start_time.asc`),
      lib.sbJson(`/rest/v1/job_assignments?select=id,job_id,provider_id,scheduled_start,scheduled_end,status,assignment_message,provider_response_note,assigned_at,responded_at,updated_at&provider_id=eq.${q}&order=scheduled_start.desc`),
      lib.sbJson(`/rest/v1/provider_service_rates?select=id,provider_id,service_id,rate_name,description,billing_unit,customer_rate,provider_compensation_method,provider_compensation,active,sort_order,created_at,updated_at&provider_id=eq.${q}&order=active.desc,sort_order.asc,rate_name.asc`),
      lib.sbJson(`/rest/v1/assignment_schedule_change_requests?select=id,assignment_id,job_id,provider_id,current_start,current_end,proposed_start,proposed_end,provider_reason,status,admin_note,reviewed_at,created_at,updated_at&provider_id=eq.${q}&order=created_at.desc`)
    ]);
    const jobIds=[...new Set((assignRaw||[]).map(x=>x.job_id).filter(Boolean))];
    let jobs=[],billing=[];
    if(jobIds.length){
      const inList=jobIds.map(id=>encodeURIComponent(id)).join(',');
      [jobs,billing]=await Promise.all([
        lib.sbJson(`/rest/v1/jobs?select=id,reference,service_id,service_name,work_address,work_description,estimated_duration_minutes,status,created_at&id=in.(${inList})`),
        lib.sbJson(`/rest/v1/job_billing_items?select=id,job_id,provider_service_rate_id,service_id,service_name,description,quantity,unit,provider_unit_rate,provider_line_total,sort_order&job_id=in.(${inList})&order=sort_order.asc,id.asc`)
      ]);
    }
    const billByJob=new Map(); for(const x of billing||[]){if(!billByJob.has(x.job_id))billByJob.set(x.job_id,[]);billByJob.get(x.job_id).push(x);}
    const jobsById=new Map((jobs||[]).map(j=>[j.id,{...j,billing_items:billByJob.get(j.id)||[]}]))
    const reqByAssignment=new Map(); for(const r of changeRequests||[]){if(!reqByAssignment.has(r.assignment_id))reqByAssignment.set(r.assignment_id,[]);reqByAssignment.get(r.assignment_id).push(r);}
    const assignments=(assignRaw||[]).map(x=>({...x,jobs:jobsById.get(x.job_id)||null,schedule_changes:reqByAssignment.get(x.id)||[]}));
    const p=providers?.[0]||null,assignedIds=new Set((ps||[]).filter(x=>x.active).map(x=>x.service_id));
    return lib.json(200,{provider:p,services:(services||[]).filter(s=>assignedIds.has(s.id)),availability:av||[],exceptions:ex||[],assignments,rates:rates||[],schedule_changes:changeRequests||[],user:{email:a.user.email,display_name:a.user.display_name}});
  }catch(e){console.error('provider-dashboard',e);return lib.json(e.status||500,{error:e.status===401?'Unauthorized':'Unable to load provider portal.'});}
};
