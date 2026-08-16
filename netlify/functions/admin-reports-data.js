const lib=require('./_admin-lib');
exports.handler=async event=>{
  if(event.httpMethod!=='GET') return lib.json(405,{error:'Method not allowed'});
  try{
    await lib.requireAdmin(event);
    const [jobs,assignments,providers,services]=await Promise.all([
      lib.sbJson('/rest/v1/jobs?select=id,reference,service_id,service_name,status,work_address,estimated_duration_minutes,created_at,updated_at,completed_at,cancelled_at,customers(first_name,last_name,phone,email)&order=created_at.desc'),
      lib.sbJson('/rest/v1/job_assignments?select=id,job_id,provider_id,scheduled_start,scheduled_end,status,assigned_at,responded_at,provider_response_note,providers(id,reference,display_name,company_name)&order=scheduled_start.desc'),
      lib.sbJson('/rest/v1/providers?select=id,reference,display_name,company_name,status&order=display_name.asc'),
      lib.sbJson('/rest/v1/services?select=id,name,active&order=name.asc')
    ]);
    return lib.json(200,{jobs:jobs||[],assignments:assignments||[],providers:providers||[],services:services||[]});
  }catch(e){console.error('admin-reports-data',e);return lib.json(e.status||500,{error:e.status===401?'Unauthorized':'Unable to load reports.'});}
};
