const lib=require('./_admin-lib');

exports.handler=async event=>{
  if(event.httpMethod!=='GET') return lib.json(405,{error:'Method not allowed'});
  try{
    await lib.requireAdmin(event);
    const [jobs,assignments,providers,services,jobHistory,assignmentHistory]=await Promise.all([
      lib.sbJson('/rest/v1/jobs?select=id,reference,customer_id,service_id,service_name,work_address,work_description,estimated_duration_minutes,billing_type,customer_rate,billable_quantity,billing_unit,quoted_subtotal,status,internal_notes,created_at,updated_at,completed_at,completion_notes,cancelled_at,cancellation_reason,customers(first_name,last_name,phone,email)&order=created_at.desc'),
      lib.sbJson('/rest/v1/job_assignments?select=id,job_id,provider_id,scheduled_start,scheduled_end,status,assignment_message,provider_response_note,assigned_at,responded_at,updated_at,providers(id,reference,display_name,company_name,public_title)&order=assigned_at.desc'),
      lib.sbJson('/rest/v1/providers?select=id,reference,display_name,company_name,public_title,status&order=display_name.asc'),
      lib.sbJson('/rest/v1/services?select=id,name,active&order=name.asc'),
      lib.sbJson('/rest/v1/job_status_history?select=id,job_id,old_status,new_status,note,changed_at,changed_by_admin_portal_user,changed_by_provider_user&order=changed_at.desc'),
      lib.sbJson('/rest/v1/assignment_status_history?select=id,assignment_id,old_status,new_status,note,changed_at,changed_by_admin_portal_user,changed_by_provider_user&order=changed_at.desc')
    ]);
    return lib.json(200,{jobs:jobs||[],assignments:assignments||[],providers:providers||[],services:services||[],job_history:jobHistory||[],assignment_history:assignmentHistory||[]});
  }catch(e){
    console.error('admin-jobs-data',e);
    return lib.json(e.status||500,{error:e.status===401?'Unauthorized':'Unable to load jobs.'});
  }
};
