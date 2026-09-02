const lib=require('./_admin-lib');
const notify=require('./_notify-lib');
const TZ='America/Edmonton';
const money=n=>Math.round((Number(n)||0)*100)/100;
const validUuid=v=>/^[0-9a-f-]{36}$/i.test(String(v||''));
const activeStatus=s=>['PENDING','CONFIRMED'].includes(String(s||'').toUpperCase());
const terminalJob=s=>['COMPLETED','CANCELLED'].includes(String(s||'').toUpperCase());

function validIso(v){const d=new Date(v);return !!v&&!Number.isNaN(d.getTime());}
function durationMinutes(start,end){const a=new Date(start).getTime(),b=new Date(end).getTime();return Number.isFinite(a)&&Number.isFinite(b)&&b>a?Math.round((b-a)/60000):0;}
function validQuarterIso(v){const d=new Date(v);return validIso(v)&&d.getUTCSeconds()===0&&d.getUTCMilliseconds()===0&&d.getUTCMinutes()%15===0;}
function overlap(aStart,aEnd,bStart,bEnd){return new Date(aStart)<new Date(bEnd)&&new Date(aEnd)>new Date(bStart);}
function lowerUnit(v){return String(v||'').trim().toLowerCase().replaceAll('_',' ');}
function isHourly(v){const u=lowerUnit(v);return u==='hour'||u==='hours'||u==='hr'||u==='hrs'||u.startsWith('hour ');}

function edmontonParts(iso){
  const d=new Date(iso);if(Number.isNaN(d.getTime()))return null;
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d);
  const get=t=>parts.find(x=>x.type===t)?.value||'';
  return{date:`${get('year')}-${get('month')}-${get('day')}`,time:`${get('hour')}:${get('minute')}`};
}

// Convert a Calgary/Edmonton wall-clock date/time into an ISO instant without
// hard-coding MST/MDT. The iterative correction handles DST automatically.
function edmontonLocalToIso(date,time){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||''))||!/^\d{2}:\d{2}$/.test(String(time||'')))throw Object.assign(new Error('Date and time are required.'),{status:400});
  const [y,m,d]=date.split('-').map(Number),[hh,mm]=time.split(':').map(Number);
  const target=Date.UTC(y,m-1,d,hh,mm,0,0);let guess=target;
  for(let i=0;i<4;i++){
    const p=edmontonParts(new Date(guess).toISOString());if(!p)break;
    const [py,pm,pd]=p.date.split('-').map(Number),[ph,pmin]=p.time.split(':').map(Number);
    const shown=Date.UTC(py,pm-1,pd,ph,pmin,0,0);const delta=target-shown;if(Math.abs(delta)<1000)break;guess+=delta;
  }
  const iso=new Date(guess).toISOString(),check=edmontonParts(iso);
  if(check?.date!==date||check?.time!==time)throw Object.assign(new Error('This local time is not available in the Calgary/Edmonton timezone. Choose another time.'),{status:400});
  return iso;
}

async function conflictsFor(targets,newStart,newEnd){
  const targetIds=new Set(targets.map(x=>x.id));
  for(const a of targets){
    const rows=await lib.sbJson(`/rest/v1/job_assignments?select=id,job_id,scheduled_start,scheduled_end,status&provider_id=eq.${encodeURIComponent(a.provider_id)}&status=in.(PENDING,CONFIRMED)&scheduled_start=lt.${encodeURIComponent(newEnd)}&scheduled_end=gt.${encodeURIComponent(newStart)}`);
    const conflict=(rows||[]).find(x=>!targetIds.has(x.id)&&overlap(newStart,newEnd,x.scheduled_start,x.scheduled_end));
    if(conflict)throw Object.assign(new Error(`The new time overlaps another active assignment for ${a.providers?.display_name||'this Provider'}.`),{status:409});
  }
}

function billingPatch(row,qty){
  const customerRate=Number(row.customer_unit_rate??row.unit_rate??0),providerRate=row.provider_unit_rate==null?null:Number(row.provider_unit_rate);
  const customerLine=money(qty*customerRate),providerLine=providerRate==null?null:money(qty*providerRate);
  return{quantity:money(qty),customer_line_total:customerLine,line_total:customerLine,provider_line_total:providerLine,gross_profit:providerLine==null?null:money(customerLine-providerLine)};
}

async function rollback({assignments=[],billing=[],job=null,request=null}){
  for(const a of assignments){try{await lib.sbJson(`/rest/v1/job_assignments?id=eq.${encodeURIComponent(a.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({scheduled_start:a.scheduled_start,scheduled_end:a.scheduled_end,updated_at:new Date().toISOString()})});}catch(e){console.error('job-schedule:assignment-rollback',a.id,e?.message||e);}}
  for(const b of billing){try{await lib.sbJson(`/rest/v1/job_billing_items?id=eq.${encodeURIComponent(b.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({quantity:b.quantity,customer_line_total:b.customer_line_total,provider_line_total:b.provider_line_total,gross_profit:b.gross_profit,line_total:b.line_total})});}catch(e){console.error('job-schedule:billing-rollback',b.id,e?.message||e);}}
  if(job){try{await lib.sbJson(`/rest/v1/jobs?id=eq.${encodeURIComponent(job.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({work_address:job.work_address,work_description:job.work_description,internal_notes:job.internal_notes,estimated_duration_minutes:job.estimated_duration_minutes,quoted_subtotal:job.quoted_subtotal,updated_at:new Date().toISOString()})});}catch(e){console.error('job-schedule:job-rollback',e?.message||e);}}
  if(request){try{await lib.sbJson(`/rest/v1/service_requests?id=eq.${encodeURIComponent(request.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({preferred_date:request.preferred_date,preferred_start_time:request.preferred_start_time,estimated_hours:request.estimated_hours,street_address:request.street_address,city:request.city,province:request.province,postal_code:request.postal_code,work_description:request.work_description,updated_at:new Date().toISOString()})});}catch(e){console.error('job-schedule:request-rollback',e?.message||e);}}
}

async function updateActiveJob({actorId,jobId,assignmentId=null,applyToTeam=true,scheduledStart=null,scheduledEnd=null,estimatedDurationMinutes=null,syncHourlyBilling=true,syncSourceRequest=true,workAddress,workDescription,internalNotes,reason='Schedule / duration updated by PLEASE Administration',notifyPeople=true}={}){
  if(!validUuid(jobId))throw Object.assign(new Error('Invalid Job.'),{status:400});
  const jobs=await lib.sbJson(`/rest/v1/jobs?select=id,reference,status,service_name,work_address,work_description,internal_notes,estimated_duration_minutes,quoted_subtotal,source_service_request_id,customers(first_name,last_name,email,phone)&id=eq.${encodeURIComponent(jobId)}&limit=1`),job=jobs?.[0];
  if(!job)throw Object.assign(new Error('Job not found.'),{status:404});
  if(terminalJob(job.status))throw Object.assign(new Error(`Completed or cancelled Jobs cannot be rescheduled.`),{status:409});
  const allAssignments=await lib.sbJson(`/rest/v1/job_assignments?select=id,job_id,provider_id,status,scheduled_start,scheduled_end,sequence_no,is_primary,providers(display_name)&job_id=eq.${encodeURIComponent(jobId)}&order=sequence_no.asc,assigned_at.asc`);
  const active=(allAssignments||[]).filter(x=>activeStatus(x.status));
  let targets=applyToTeam?active:active.filter(x=>x.id===assignmentId);
  if(!applyToTeam&&!validUuid(assignmentId))throw Object.assign(new Error('Select an active Provider assignment.'),{status:400});
  if(!applyToTeam&&!targets.length)throw Object.assign(new Error('The selected Provider assignment is no longer active.'),{status:409});

  let newStart=scheduledStart,newEnd=scheduledEnd,duration=Number(estimatedDurationMinutes)||0;
  if(targets.length){
    newStart=newStart||targets[0].scheduled_start;
    if(!newEnd&&duration>0)newEnd=new Date(new Date(newStart).getTime()+duration*60000).toISOString();
    newEnd=newEnd||targets[0].scheduled_end;
    if(!validQuarterIso(newStart)||!validQuarterIso(newEnd))throw Object.assign(new Error('Service date and time must use 15-minute increments.'),{status:400});
    duration=durationMinutes(newStart,newEnd);
    if(duration<15||duration>4320||duration%15!==0)throw Object.assign(new Error('Service duration must be 15 minutes to 72 hours in 15-minute increments.'),{status:400});
    const targetIds=targets.map(x=>x.id).map(encodeURIComponent).join(',');
    const events=targetIds?await lib.sbJson(`/rest/v1/job_service_events?select=assignment_id,event_type&assignment_id=in.(${targetIds})&event_type=in.(STARTED,COMPLETED)`).catch(()=>[]):[];
    for(const t of targets){
      const started=(events||[]).some(e=>e.assignment_id===t.id&&e.event_type==='STARTED');
      const completed=(events||[]).some(e=>e.assignment_id===t.id&&e.event_type==='COMPLETED');
      if(completed)throw Object.assign(new Error(`${t.providers?.display_name||'A Provider'} has already completed this assignment.`),{status:409});
      if(started&&new Date(newStart).getTime()!==new Date(t.scheduled_start).getTime())throw Object.assign(new Error(`The service has already started. You may adjust the end time / remaining duration, but not move the start time.`),{status:409});
    }
    await conflictsFor(targets,newStart,newEnd);
  }else{
    if(!duration){duration=Number(job.estimated_duration_minutes)||60;}
    if(duration<15||duration>4320||duration%15!==0)throw Object.assign(new Error('Estimated duration must use 15-minute increments.'),{status:400});
  }

  const billing=await lib.sbJson(`/rest/v1/job_billing_items?select=id,job_id,assignment_id,provider_id,quantity,unit,customer_unit_rate,customer_line_total,provider_unit_rate,provider_line_total,gross_profit,unit_rate,line_total&job_id=eq.${encodeURIComponent(jobId)}`).catch(()=>[]);
  const targetIds=new Set(targets.map(x=>x.id)),targetProviders=new Set(targets.map(x=>x.provider_id));
  const hourly=(billing||[]).filter(x=>syncHourlyBilling&&isHourly(x.unit)&&(targetIds.has(x.assignment_id)||(!x.assignment_id&&targetProviders.has(x.provider_id))));
  const snapshots={assignments:targets.map(x=>({...x})),billing:hourly.map(x=>({...x})),job:{...job},request:null};
  let sourceRequest=null;
  if(syncSourceRequest&&job.source_service_request_id){
    sourceRequest=(await lib.sbJson(`/rest/v1/service_requests?select=id,reference,status,preferred_date,preferred_start_time,estimated_hours,street_address,city,province,postal_code,work_description&id=eq.${encodeURIComponent(job.source_service_request_id)}&limit=1`).catch(()=>[]))?.[0]||null;
    if(sourceRequest)snapshots.request={...sourceRequest};
  }

  const now=new Date().toISOString();
  try{
    for(const t of targets){await lib.sbJson(`/rest/v1/job_assignments?id=eq.${encodeURIComponent(t.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({scheduled_start:newStart,scheduled_end:newEnd,updated_at:now})});}
    const qty=money(duration/60);
    for(const b of hourly){await lib.sbJson(`/rest/v1/job_billing_items?id=eq.${encodeURIComponent(b.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(billingPatch(b,qty))});}

    const allAfter=(allAssignments||[]).filter(x=>!['DECLINED','CANCELLED'].includes(String(x.status||'').toUpperCase())).map(x=>targetIds.has(x.id)?{...x,scheduled_start:newStart,scheduled_end:newEnd}:x);
    const maxDuration=allAfter.reduce((m,x)=>Math.max(m,durationMinutes(x.scheduled_start,x.scheduled_end)),0)||duration;
    let subtotal=job.quoted_subtotal;
    if(hourly.length){const totals=await lib.sbJson(`/rest/v1/job_billing_items?select=customer_line_total&job_id=eq.${encodeURIComponent(jobId)}`);subtotal=money((totals||[]).reduce((n,x)=>n+Number(x.customer_line_total||0),0));}
    const jobPatch={estimated_duration_minutes:maxDuration,quoted_subtotal:subtotal,updated_at:now};
    if(workAddress!==undefined){const v=String(workAddress||'').trim();if(!v)throw Object.assign(new Error('Work Address is required.'),{status:400});jobPatch.work_address=v.slice(0,500);}
    if(workDescription!==undefined){const v=String(workDescription||'').trim();if(!v)throw Object.assign(new Error('Work Description is required.'),{status:400});jobPatch.work_description=v.slice(0,5000);}
    if(internalNotes!==undefined)jobPatch.internal_notes=String(internalNotes||'').trim().slice(0,5000)||null;
    await lib.sbJson(`/rest/v1/jobs?id=eq.${encodeURIComponent(jobId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(jobPatch)});

    if(sourceRequest&&targets.length){
      const p=edmontonParts(newStart);const requestPatch={preferred_date:p.date,preferred_start_time:p.time,estimated_hours:money(duration/60),updated_at:now};
      if(workDescription!==undefined)requestPatch.work_description=String(workDescription||'').trim().slice(0,4000);
      await lib.sbJson(`/rest/v1/service_requests?id=eq.${encodeURIComponent(sourceRequest.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(requestPatch)});
    }
  }catch(e){await rollback(snapshots);throw e;}

  // Audit failures should never tempt an Administrator to repeat a successful schedule mutation.
  for(const t of targets){lib.sbJson('/rest/v1/assignment_status_history',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({assignment_id:t.id,old_status:t.status,new_status:t.status,changed_by_admin_portal_user:actorId,note:`${reason}. ${notify.formatDateTime(t.scheduled_start)} → ${notify.formatDateTime(newStart)}; end ${notify.formatDateTime(t.scheduled_end)} → ${notify.formatDateTime(newEnd)}.`})}).catch(e=>console.warn('job-schedule:assignment-history',e?.message||e));}
  lib.sbJson('/rest/v1/job_status_history',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({job_id:jobId,old_status:job.status,new_status:job.status,changed_by_admin_portal_user:actorId,note:`${reason}. Duration ${job.estimated_duration_minutes||'—'} → ${targets.length?duration:(estimatedDurationMinutes||duration)} minutes.${hourly.length?` ${hourly.length} hourly billing item(s) synchronized.`:''}`})}).catch(e=>console.warn('job-schedule:job-history',e?.message||e));
  if(sourceRequest)lib.sbJson('/rest/v1/service_request_status_history',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({service_request_id:sourceRequest.id,old_status:sourceRequest.status,new_status:sourceRequest.status,note:`Related Job ${job.reference} schedule/duration synchronized by PLEASE Administration`,changed_by_admin_portal_user:actorId})}).catch(()=>{});

  let notices=[];
  if(notifyPeople&&targets.length){
    const tasks=[
      ...targets.map(t=>notify.sendProvider(t.provider_id,{subject:`PLEASE — Service Schedule Updated (${job.reference})`,title:'Your PLEASE service schedule was updated',intro:'PLEASE Administration updated the date, time or duration of this assignment.',details:[['Job',job.reference],['Service',job.service_name],['New schedule',`${notify.formatDateTime(newStart)} → ${notify.formatDateTime(newEnd)}`],['Duration',`${duration} minutes`],['Address',workAddress!==undefined?String(workAddress):job.work_address]],message:reason,ctaLabel:'Open Provider Portal',ctaUrl:`${notify.baseUrl()}/provider.html#calendar`,idempotencyKey:`please-admin-schedule-${t.id}-${Date.now()}`})),
      ...(job.customers?.email?[notify.send({to:job.customers.email,subject:`PLEASE — Service Schedule Updated (${job.reference})`,title:'Your PLEASE service schedule was updated',intro:`Hi ${job.customers.first_name||'there'}, PLEASE Administration updated the schedule for your service.`,details:[['Service Job',job.reference],['Service',job.service_name],['New schedule',`${notify.formatDateTime(newStart)} → ${notify.formatDateTime(newEnd)}`],['Duration',`${duration} minutes`],['Address',workAddress!==undefined?String(workAddress):job.work_address]],message:'Your secure tracking page will reflect the current service schedule. It continues to show only confirmed PLEASE professionals.',ctaLabel:'Track Your Request',ctaUrl:`${notify.baseUrl()}/track-request.html`,idempotencyKey:`please-customer-admin-schedule-${job.id}-${Date.now()}`})]:[])
    ];
    const settled=await Promise.allSettled(tasks);
    notices=settled.map((x,i)=>x.status==='fulfilled'?x.value:{sent:false,error:String(x.reason?.message||x.reason||'Notification failed')});
    settled.filter(x=>x.status==='rejected').forEach(x=>console.warn('job-schedule:notification-warning',x.reason?.message||x.reason));
  }
  return{ok:true,job_id:jobId,job_reference:job.reference,updated_assignments:targets.length,updated_assignment_ids:targets.map(x=>x.id),estimated_duration_minutes:targets.length?duration:(estimatedDurationMinutes||duration),job_estimated_duration_minutes:targets.length?Math.max(duration,...(allAssignments||[]).filter(x=>!targetIds.has(x.id)&&!['DECLINED','CANCELLED'].includes(String(x.status||'').toUpperCase())).map(x=>durationMinutes(x.scheduled_start,x.scheduled_end))):(estimatedDurationMinutes||duration),hourly_billing_items_updated:hourly.length,notifications_sent:notices.filter(x=>x?.sent).length,scheduled_start:newStart,scheduled_end:newEnd};
}

module.exports={updateActiveJob,edmontonLocalToIso,edmontonParts,durationMinutes,validQuarterIso,isHourly};
