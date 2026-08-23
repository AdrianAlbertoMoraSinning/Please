const lib=require('./_admin-lib');

async function safe(label,fn,warnings){
  try{return await fn();}
  catch(e){console.error(`admin-reports-data:${label}`,e);warnings.push(`${label}: ${e.message||'unavailable'}`);return [];}
}

exports.handler=async event=>{
  if(event.httpMethod!=='GET') return lib.json(405,{error:'Method not allowed'});
  try{
    await lib.requireAdmin(event);
    const warnings=[];

    // Core operational data. These are loaded independently so one optional financial
    // dataset can never leave the Reports page stuck on "Checking secure session…".
    const [jobs,assignments,providers,services,assignmentHistory,invoices,providerPaymentsRaw]=await Promise.all([
      safe('jobs',()=>lib.sbJson('/rest/v1/jobs?select=id,reference,service_id,service_name,status,work_address,estimated_duration_minutes,created_at,updated_at,completed_at,cancelled_at,customers(first_name,last_name,phone,email)&order=created_at.desc'),warnings),
      safe('assignments',()=>lib.sbJson('/rest/v1/job_assignments?select=id,job_id,provider_id,sequence_no,is_primary,scheduled_start,scheduled_end,status,assigned_at,responded_at,provider_response_note,providers(id,reference,display_name,company_name)&order=scheduled_start.desc'),warnings),
      safe('providers',()=>lib.sbJson('/rest/v1/providers?select=id,reference,display_name,company_name,status&order=display_name.asc'),warnings),
      safe('services',()=>lib.sbJson('/rest/v1/services?select=id,name,active&order=name.asc'),warnings),
      safe('assignment history',()=>lib.sbJson('/rest/v1/assignment_status_history?select=id,assignment_id,old_status,new_status,changed_at&order=changed_at.desc'),warnings),
      safe('invoices',()=>lib.sbJson('/rest/v1/invoices?select=id,invoice_number,job_id,client_name,client_email,invoice_date,status,payment_status,subtotal,gst_amount,total_amount,currency&status=neq.VOID&order=invoice_date.desc'),warnings),
      // Keep this flat. Nested provider/job/customer embeds can fail when PostgREST's
      // relationship cache is stale after a migration. We hydrate below from core data.
      safe('provider payments',()=>lib.sbJson('/rest/v1/provider_payments?select=id,payment_reference,job_id,provider_id,status,amount,paid_at,created_at,needs_rate_review&order=created_at.desc'),warnings)
    ]);

    const providerMap=new Map((providers||[]).map(p=>[p.id,p]));
    const jobMap=new Map((jobs||[]).map(j=>[j.id,j]));
    const providerPayments=(providerPaymentsRaw||[]).map(p=>({
      ...p,
      providers:providerMap.get(p.provider_id)||null,
      jobs:jobMap.get(p.job_id)||null
    }));

    return lib.json(200,{
      jobs:jobs||[],assignments:assignments||[],providers:providers||[],services:services||[],
      assignment_history:assignmentHistory||[],invoices:invoices||[],provider_payments:providerPayments,
      warnings
    });
  }catch(e){
    console.error('admin-reports-data',e);
    return lib.json(e.status||500,{error:e.status===401?'Unauthorized':(e.message||'Unable to load reports.')});
  }
};
