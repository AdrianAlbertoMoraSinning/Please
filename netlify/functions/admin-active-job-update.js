const lib=require('./_admin-lib');
const schedule=require('./_job-schedule-lib');
const clean=(v,n=5000)=>String(v??'').trim().slice(0,n);
exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
  try{
    const auth=await lib.requireAdmin(event),b=JSON.parse(event.body||'{}');
    const result=await schedule.updateActiveJob({actorId:auth.user.id,jobId:String(b.job_id||''),assignmentId:String(b.assignment_id||'')||null,applyToTeam:b.apply_to_team!==false,scheduledStart:b.scheduled_start||null,scheduledEnd:b.scheduled_end||null,estimatedDurationMinutes:b.estimated_duration_minutes==null?null:Number(b.estimated_duration_minutes),syncHourlyBilling:b.sync_hourly_billing!==false,syncSourceRequest:b.sync_source_request!==false,workAddress:b.work_address===undefined?undefined:clean(b.work_address,500),workDescription:b.work_description===undefined?undefined:clean(b.work_description,5000),internalNotes:b.internal_notes===undefined?undefined:clean(b.internal_notes,5000),reason:clean(b.reason,1000)||'Service schedule / duration updated by PLEASE Administration',notifyPeople:b.notify_people!==false});
    return lib.json(200,result);
  }catch(e){console.error('admin-active-job-update',e);return lib.json(e.status||400,{error:e.message||'The active Job could not be updated.'});}
};
