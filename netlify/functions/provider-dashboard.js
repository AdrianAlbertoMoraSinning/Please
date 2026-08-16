const lib=require('./_provider-lib');

exports.handler=async event=>{
  if(event.httpMethod!=='GET')return lib.json(405,{error:'Method not allowed'});
  try{
    const a=await lib.requireProvider(event),pid=a.provider.id,q=encodeURIComponent(pid);
    const [providers,ps,services,av,ex,assignRaw]=await Promise.all([
      lib.sbJson(`/rest/v1/providers?select=id,reference,display_name,company_name,public_title,short_bio,technical_description,service_area,licensed_certified,insured,status,public_visible,slug&id=eq.${q}&limit=1`),
      lib.sbJson(`/rest/v1/provider_services?select=service_id,active,provider_notes&provider_id=eq.${q}`),
      lib.sbJson('/rest/v1/services?select=id,name,short_description,active&active=eq.true&order=sort_order.asc'),
      lib.sbJson(`/rest/v1/provider_availability?select=id,weekday,start_time,end_time,active&provider_id=eq.${q}&active=eq.true&order=weekday.asc,start_time.asc`),
      lib.sbJson(`/rest/v1/provider_availability_exceptions?select=id,exception_date,start_time,end_time,exception_type,reason,created_at&provider_id=eq.${q}&order=exception_date.asc,start_time.asc`),
      // Fetch assignments without an embedded relation first. This makes provider task visibility
      // independent of PostgREST relationship inference and guarantees every assignment for this provider is returned.
      lib.sbJson(`/rest/v1/job_assignments?select=id,job_id,provider_id,scheduled_start,scheduled_end,status,assignment_message,provider_response_note,assigned_at,responded_at,updated_at&provider_id=eq.${q}&order=scheduled_start.desc`)
    ]);

    const jobIds=[...new Set((assignRaw||[]).map(x=>x.job_id).filter(Boolean))];
    let jobs=[];
    if(jobIds.length){
      const inList=jobIds.map(id=>encodeURIComponent(id)).join(',');
      jobs=await lib.sbJson(`/rest/v1/jobs?select=id,reference,service_id,service_name,work_address,work_description,estimated_duration_minutes,status,created_at&id=in.(${inList})`);
    }
    const jobsById=new Map((jobs||[]).map(j=>[j.id,j]));
    const assignments=(assignRaw||[]).map(x=>({...x,jobs:jobsById.get(x.job_id)||null}));

    const p=providers?.[0]||null;
    const assignedIds=new Set((ps||[]).filter(x=>x.active).map(x=>x.service_id));
    return lib.json(200,{provider:p,services:(services||[]).filter(s=>assignedIds.has(s.id)),availability:av||[],exceptions:ex||[],assignments,user:{email:a.user.email,display_name:a.user.display_name}});
  }catch(e){
    console.error('provider-dashboard',e);
    return lib.json(e.status||500,{error:e.status===401?'Unauthorized':'Unable to load provider portal.'});
  }
};
