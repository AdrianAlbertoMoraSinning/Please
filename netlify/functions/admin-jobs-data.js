const lib=require('./_admin-lib');
async function signed(path,expires=1800){if(!path)return null;try{const enc=String(path).split('/').map(encodeURIComponent).join('/');const d=await lib.sbJson(`/storage/v1/object/sign/provider-applications/${enc}`,{method:'POST',body:JSON.stringify({expiresIn:expires})});const u=d?.signedURL||d?.signedUrl;return u?`${process.env.PLEASE_SUPABASE_URL.replace(/\/$/,'')}/storage/v1${u}`:null;}catch{return null;}}
exports.handler=async event=>{
  if(event.httpMethod!=='GET') return lib.json(405,{error:'Method not allowed'});
  try{
    await lib.requireAdmin(event);
    const [jobs,assignments,providers,services,jobHistory,assignmentHistory,billingItems,scheduleChanges,evidence]=await Promise.all([
      lib.sbJson('/rest/v1/jobs?select=id,reference,customer_id,service_id,service_name,work_address,work_description,moving_bedrooms,moving_square_feet,moving_inventory,estimated_duration_minutes,billing_type,customer_rate,billable_quantity,billing_unit,quoted_subtotal,status,internal_notes,created_at,updated_at,completed_at,completion_notes,cancelled_at,cancellation_reason,customers(first_name,last_name,phone,email)&order=created_at.desc'),
      lib.sbJson('/rest/v1/job_assignments?select=id,job_id,provider_id,sequence_no,is_primary,scheduled_start,scheduled_end,status,assignment_message,provider_response_note,assigned_at,responded_at,updated_at,providers(id,reference,display_name,company_name,public_title)&order=assigned_at.desc'),
      lib.sbJson('/rest/v1/providers?select=id,reference,display_name,company_name,public_title,status&order=display_name.asc'),
      lib.sbJson('/rest/v1/services?select=id,name,active&order=name.asc'),
      lib.sbJson('/rest/v1/job_status_history?select=id,job_id,old_status,new_status,note,changed_at,changed_by_admin_portal_user,changed_by_provider_user&order=changed_at.desc'),
      lib.sbJson('/rest/v1/assignment_status_history?select=id,assignment_id,old_status,new_status,note,changed_at,changed_by_admin_portal_user,changed_by_provider_user&order=changed_at.desc'),
      lib.sbJson('/rest/v1/job_billing_items?select=id,job_id,assignment_id,provider_id,service_name,description,quantity,unit,customer_unit_rate,customer_line_total,provider_unit_rate,provider_line_total,gross_profit,unit_rate,line_total,sort_order&order=job_id.asc,sort_order.asc'),
      lib.sbJson('/rest/v1/assignment_schedule_change_requests?select=id,assignment_id,job_id,provider_id,current_start,current_end,proposed_start,proposed_end,provider_reason,status,admin_note,reviewed_at,created_at&order=created_at.desc'),
      lib.sbJson('/rest/v1/job_service_evidence?select=id,job_id,assignment_id,provider_id,evidence_type,storage_path,created_at&status=eq.COMMITTED&order=created_at.asc').catch(()=>[])
    ]);
    for(const x of evidence||[])x.url=await signed(x.storage_path);
    return lib.json(200,{jobs:jobs||[],assignments:assignments||[],providers:providers||[],services:services||[],job_history:jobHistory||[],assignment_history:assignmentHistory||[],job_billing_items:billingItems||[],schedule_changes:scheduleChanges||[],evidence:evidence||[]});
  }catch(e){console.error('admin-jobs-data',e);return lib.json(e.status||500,{error:e.status===401?'Unauthorized':'Unable to load jobs.'});}
};
