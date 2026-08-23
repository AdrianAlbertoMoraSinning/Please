const lib=require('./_provider-lib');
function overlap(aStart,aEnd,bStart,bEnd){return new Date(aStart)<new Date(bEnd)&&new Date(aEnd)>new Date(bStart);}function quarterIso(v){const d=new Date(v);return !Number.isNaN(d.getTime())&&d.getSeconds()===0&&d.getMilliseconds()===0&&[0,15,30,45].includes(d.getMinutes());}
exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
  try{
    const auth=await lib.requireProvider(event),body=JSON.parse(event.body||'{}'),assignmentId=String(body.assignment_id||'');
    const proposedStart=String(body.proposed_start||''),proposedEnd=String(body.proposed_end||''),reason=String(body.reason||'').trim().slice(0,1000);
    if(!assignmentId||!proposedStart||!proposedEnd||new Date(proposedEnd)<=new Date(proposedStart))return lib.json(400,{error:'A valid proposed date, start and end time are required.'});if(!quarterIso(proposedStart)||!quarterIso(proposedEnd))return lib.json(400,{error:'Schedule changes must use 15-minute increments.'});
    const rows=await lib.sbJson(`/rest/v1/job_assignments?select=id,job_id,provider_id,scheduled_start,scheduled_end,status&provider_id=eq.${encodeURIComponent(auth.provider.id)}&id=eq.${encodeURIComponent(assignmentId)}&limit=1`);
    const a=rows?.[0]; if(!a)return lib.json(404,{error:'Assignment not found.'});
    if(!['PENDING','CONFIRMED'].includes(a.status))return lib.json(409,{error:'Schedule changes can only be requested for pending or confirmed assignments.'});
    const pending=await lib.sbJson(`/rest/v1/assignment_schedule_change_requests?select=id&assignment_id=eq.${encodeURIComponent(a.id)}&status=eq.PENDING&limit=1`);
    if(pending?.length)return lib.json(409,{error:'A schedule change request is already waiting for PLEASE review.'});
    const active=await lib.sbJson(`/rest/v1/job_assignments?select=id,scheduled_start,scheduled_end,status&provider_id=eq.${encodeURIComponent(a.provider_id)}&status=in.(PENDING,CONFIRMED)`);
    if((active||[]).some(x=>x.id!==a.id&&overlap(proposedStart,proposedEnd,x.scheduled_start,x.scheduled_end)))return lib.json(409,{error:'The proposed time overlaps another active PLEASE assignment.'});
    const created=await lib.sbJson('/rest/v1/assignment_schedule_change_requests',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({assignment_id:a.id,job_id:a.job_id,provider_id:a.provider_id,requested_by_provider_user:auth.user.id,current_start:a.scheduled_start,current_end:a.scheduled_end,proposed_start:proposedStart,proposed_end:proposedEnd,provider_reason:reason||null,status:'PENDING'})});
    return lib.json(200,{ok:true,request:created?.[0]||null});
  }catch(e){console.error('provider-schedule-change-action',e);return lib.json(e.status||400,{error:e.message||'Schedule change request failed.'});}
};
