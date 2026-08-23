const lib=require('./_admin-lib');
function overlap(aStart,aEnd,bStart,bEnd){return new Date(aStart)<new Date(bEnd)&&new Date(aEnd)>new Date(bStart);}
function mins(a,b){return Math.max(1,Math.round((new Date(b)-new Date(a))/60000));}
async function activeAssignmentsForProvider(providerId){
  return lib.sbJson(`/rest/v1/job_assignments?select=id,job_id,provider_id,scheduled_start,scheduled_end,status&provider_id=eq.${encodeURIComponent(providerId)}&status=in.(PENDING,CONFIRMED)`);
}
async function validateNoConflict(assignment,newStart,newEnd,teamIds=new Set()){
  const active=await activeAssignmentsForProvider(assignment.provider_id);
  if((active||[]).some(x=>x.id!==assignment.id&&!teamIds.has(x.id)&&overlap(newStart,newEnd,x.scheduled_start,x.scheduled_end))){
    throw Object.assign(new Error(`The proposed time overlaps another active assignment for this Provider.`),{status:409});
  }
}
async function recalcJobDuration(jobId){
  const rows=await lib.sbJson(`/rest/v1/job_assignments?select=scheduled_start,scheduled_end,status&job_id=eq.${encodeURIComponent(jobId)}&status=not.in.(CANCELLED,DECLINED)`);
  const max=(rows||[]).reduce((m,x)=>Math.max(m,mins(x.scheduled_start,x.scheduled_end)),0);
  await lib.sbJson(`/rest/v1/jobs?id=eq.${encodeURIComponent(jobId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({estimated_duration_minutes:max||null,updated_at:new Date().toISOString()})});
}
async function history(auth,a,oldStart,newStart,note){
  await lib.sbJson('/rest/v1/assignment_status_history',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({assignment_id:a.id,old_status:a.status,new_status:a.status,changed_by_admin_portal_user:auth.user.id,note:`Schedule changed by PLEASE: ${oldStart} → ${newStart}${note?` · ${note}`:''}`})});
}
exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
  try{
    const auth=await lib.requireAdmin(event),body=JSON.parse(event.body||'{}'),action=String(body.action||'').toUpperCase(),id=String(body.request_id||''),note=String(body.note||'').trim().slice(0,1000),applyTeam=body.apply_to_team===true;
    if(!['ACCEPT','REJECT'].includes(action))return lib.json(400,{error:'Unsupported schedule action.'});
    const rows=await lib.sbJson(`/rest/v1/assignment_schedule_change_requests?select=*&id=eq.${encodeURIComponent(id)}&status=eq.PENDING&limit=1`);
    const req=rows?.[0]; if(!req)return lib.json(404,{error:'Pending schedule change request not found.'});
    const assignments=await lib.sbJson(`/rest/v1/job_assignments?select=id,job_id,provider_id,sequence_no,is_primary,scheduled_start,scheduled_end,status&job_id=eq.${encodeURIComponent(req.job_id)}&status=in.(PENDING,CONFIRMED)&order=sequence_no.asc,assigned_at.asc`);
    const source=(assignments||[]).find(x=>x.id===req.assignment_id); if(!source)return lib.json(409,{error:'The assignment is no longer active.'});
    if(action==='REJECT'){
      await lib.sbJson(`/rest/v1/assignment_schedule_change_requests?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'REJECTED',reviewed_by_admin_portal_user:auth.user.id,admin_note:note||null,reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
      return lib.json(200,{ok:true,status:'REJECTED',updated_assignments:0});
    }
    const targets=applyTeam?(assignments||[]):[source];
    const targetIds=new Set(targets.map(x=>x.id));
    for(const a of targets)await validateNoConflict(a,req.proposed_start,req.proposed_end,targetIds);
    const now=new Date().toISOString();
    for(const a of targets){
      const oldStart=a.scheduled_start;
      await lib.sbJson(`/rest/v1/job_assignments?id=eq.${encodeURIComponent(a.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({scheduled_start:req.proposed_start,scheduled_end:req.proposed_end,updated_at:now})});
      await history(auth,a,oldStart,req.proposed_start,applyTeam?`Team schedule applied${note?` · ${note}`:''}`:note);
    }
    await recalcJobDuration(req.job_id);
    if(applyTeam){
      const teamIdList=[...targetIds].map(encodeURIComponent).join(',');
      if(teamIdList){
        await lib.sbJson(`/rest/v1/assignment_schedule_change_requests?assignment_id=in.(${teamIdList})&status=eq.PENDING`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'ACCEPTED',reviewed_by_admin_portal_user:auth.user.id,admin_note:note||'Approved by PLEASE and applied to the service team.',reviewed_at:now,updated_at:now})});
      }
    }else{
      await lib.sbJson(`/rest/v1/assignment_schedule_change_requests?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'ACCEPTED',reviewed_by_admin_portal_user:auth.user.id,admin_note:note||null,reviewed_at:now,updated_at:now})});
    }
    return lib.json(200,{ok:true,status:'ACCEPTED',apply_to_team:applyTeam,updated_assignments:targets.length});
  }catch(e){console.error('admin-schedule-change-action',e);return lib.json(e.status||400,{error:e.message||'Schedule change review failed.'});}
};
