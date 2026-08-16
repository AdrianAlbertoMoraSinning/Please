const lib=require('./_admin-lib');
function overlap(aStart,aEnd,bStart,bEnd){return new Date(aStart)<new Date(bEnd)&&new Date(aEnd)>new Date(bStart);}
exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
  try{
    const auth=await lib.requireAdmin(event),body=JSON.parse(event.body||'{}'),action=String(body.action||'').toUpperCase(),id=String(body.request_id||''),note=String(body.note||'').trim().slice(0,1000);
    if(!['ACCEPT','REJECT'].includes(action))return lib.json(400,{error:'Unsupported schedule action.'});
    const rows=await lib.sbJson(`/rest/v1/assignment_schedule_change_requests?select=*&id=eq.${encodeURIComponent(id)}&status=eq.PENDING&limit=1`);
    const req=rows?.[0]; if(!req)return lib.json(404,{error:'Pending schedule change request not found.'});
    const assignments=await lib.sbJson(`/rest/v1/job_assignments?select=id,job_id,provider_id,scheduled_start,scheduled_end,status&id=eq.${encodeURIComponent(req.assignment_id)}&limit=1`);
    const a=assignments?.[0]; if(!a||!['PENDING','CONFIRMED'].includes(a.status))return lib.json(409,{error:'The assignment is no longer active.'});
    if(action==='REJECT'){
      await lib.sbJson(`/rest/v1/assignment_schedule_change_requests?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'REJECTED',reviewed_by_admin_portal_user:auth.user.id,admin_note:note||null,reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
      return lib.json(200,{ok:true,status:'REJECTED'});
    }
    const active=await lib.sbJson(`/rest/v1/job_assignments?select=id,scheduled_start,scheduled_end,status&provider_id=eq.${encodeURIComponent(a.provider_id)}&status=in.(PENDING,CONFIRMED)`);
    if((active||[]).some(x=>x.id!==a.id&&overlap(req.proposed_start,req.proposed_end,x.scheduled_start,x.scheduled_end)))return lib.json(409,{error:'The proposed time now overlaps another active assignment.'});
    const minutes=Math.max(1,Math.round((new Date(req.proposed_end)-new Date(req.proposed_start))/60000));
    await lib.sbJson(`/rest/v1/job_assignments?id=eq.${encodeURIComponent(a.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({scheduled_start:req.proposed_start,scheduled_end:req.proposed_end,updated_at:new Date().toISOString()})});
    await lib.sbJson(`/rest/v1/jobs?id=eq.${encodeURIComponent(a.job_id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({estimated_duration_minutes:minutes,updated_at:new Date().toISOString()})});
    await lib.sbJson(`/rest/v1/assignment_schedule_change_requests?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'ACCEPTED',reviewed_by_admin_portal_user:auth.user.id,admin_note:note||null,reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
    await lib.sbJson('/rest/v1/assignment_status_history',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({assignment_id:a.id,old_status:a.status,new_status:a.status,changed_by_admin_portal_user:auth.user.id,note:`Schedule changed by PLEASE: ${req.current_start} → ${req.proposed_start}${note?` · ${note}`:''}`})});
    return lib.json(200,{ok:true,status:'ACCEPTED'});
  }catch(e){console.error('admin-schedule-change-action',e);return lib.json(e.status||400,{error:e.message||'Schedule change review failed.'});}
};
