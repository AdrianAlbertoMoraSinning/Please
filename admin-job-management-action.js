const lib=require('./_admin-lib');
const notify=require('./_notify-lib');
exports.handler=async event=>{
  if(event.httpMethod!=='POST') return lib.json(405,{error:'Method not allowed'});
  try{
    if(!lib.sameOrigin(event)) return lib.json(403,{error:'Forbidden'});
    const auth=await lib.requireAdmin(event);
    let body={}; try{body=JSON.parse(event.body||'{}')}catch{return lib.json(400,{error:'Invalid JSON'})}
    const jobId=String(body.job_id||'').trim(), action=String(body.action||'').trim().toUpperCase(), note=String(body.note||'').trim();
    if(!jobId||!action) return lib.json(400,{error:'Job and action are required'});
    if(note.length>1000) return lib.json(400,{error:'Note cannot exceed 1000 characters'});
    const before=await notify.jobContext(jobId).catch(()=>null);
    const assignments=await lib.sbJson(`/rest/v1/job_assignments?select=id,provider_id,status,scheduled_start,scheduled_end&job_id=eq.${encodeURIComponent(jobId)}`).catch(()=>[]);
    const result=await lib.sbJson('/rest/v1/rpc/please_portal_manage_job',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_actor:auth.user.id,p_job_id:jobId,p_action:action,p_note:note||null})});
    const after=await notify.jobContext(jobId).catch(()=>before),notices=[];
    if(['COMPLETE','CANCEL'].includes(action)){
      const completed=action==='COMPLETE',title=completed?'PLEASE service completed':'PLEASE service cancelled';
      if(after?.customers?.email)notices.push(await notify.send({to:after.customers.email,subject:`PLEASE — ${title} (${after.reference})`,title,intro:completed?`Hi ${after.customers.first_name||'there'}, PLEASE Administration marked your service as completed.`:`Hi ${after.customers.first_name||'there'}, PLEASE Administration cancelled this service.`,details:[['Job',after.reference],['Service',after.service_name],['Status',after.status],['Address',after.work_address]],message:note,ctaLabel:'Track Your Request',ctaUrl:`${notify.baseUrl()}/track-request.html`,idempotencyKey:`please-customer-job-manage-${jobId}-${action}`}));
      for(const as of assignments||[])notices.push(await notify.sendProvider(as.provider_id,{subject:`PLEASE — ${completed?'Job Completed':'Job Cancelled'} (${after?.reference||'Job'})`,title:completed?'PLEASE job completed':'PLEASE job cancelled',intro:completed?'PLEASE Administration finalized this job as completed.':'PLEASE Administration cancelled this job. Do not proceed unless a new assignment is issued.',details:[['Job',after?.reference],['Service',after?.service_name],['Status',after?.status]],message:note,ctaLabel:'Provider Portal',ctaUrl:`${notify.baseUrl()}/provider.html#history`,idempotencyKey:`please-provider-job-manage-${jobId}-${action}-${as.provider_id}`}));
    }
    return lib.json(200,{...(Array.isArray(result)?result[0]:result),notifications_sent:notices.filter(n=>n?.sent).length});
  }catch(e){console.error('admin-job-management-action',e);return lib.json(e.status||400,{error:e.message||'Job action failed.'});}
};
