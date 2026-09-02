const lib=require('./_admin-lib');
const notify=require('./_notify-lib');
const customerLib=require('./_customer-lib');
const jobSchedule=require('./_job-schedule-lib');

function actionAlreadyApplied(action,status){
  const a=String(action||'').toUpperCase();
  if(a==='START_REVIEW') return status==='REVIEWING';
  if(a==='READY_TO_ASSIGN') return status==='READY_TO_ASSIGN';
  if(a==='CANCEL') return status==='CANCELLED';
  return false;
}

function transitionPlan(action,current,value){
  const a=String(action||'').trim().toUpperCase();
  const now=new Date().toISOString();
  if(a==='START_REVIEW'){
    if(current.status!=='NEW'){
      const e=new Error('Only NEW requests can start review.'); e.status=409; throw e;
    }
    return {action:a,newStatus:'REVIEWING',patch:{status:'REVIEWING',reviewed_at:current.reviewed_at||now},note:null};
  }
  if(a==='READY_TO_ASSIGN'){
    if(!['NEW','REVIEWING'].includes(current.status)){
      const e=new Error('Request is not ready for this transition.'); e.status=409; throw e;
    }
    return {action:a,newStatus:'READY_TO_ASSIGN',patch:{status:'READY_TO_ASSIGN',reviewed_at:current.reviewed_at||now,ready_to_assign_at:now},note:null};
  }
  if(a==='CANCEL'){
    if(['ASSIGNED','CANCELLED'].includes(current.status)){
      const e=new Error('Request cannot be cancelled from its current status.'); e.status=409; throw e;
    }
    const reason=String(value||'').trim();
    if(!reason){const e=new Error('Cancellation reason is required.');e.status=400;throw e;}
    return {action:a,newStatus:'CANCELLED',patch:{status:'CANCELLED',cancelled_at:now,cancellation_reason:reason},note:reason};
  }
  const e=new Error('Unsupported action.'); e.status=400; throw e;
}

async function patchRequest(current,patch){
  // Optimistic status guard: if a second admin changes the same request at the same
  // time we do not overwrite that newer state with a stale browser action.
  const rows=await lib.sbJson(`/rest/v1/service_requests?id=eq.${encodeURIComponent(current.id)}&status=eq.${encodeURIComponent(current.status)}&select=*`,{
    method:'PATCH',
    headers:{Prefer:'return=representation'},
    body:JSON.stringify(patch)
  });
  if(rows?.[0]) return rows[0];

  const freshRows=await lib.sbJson(`/rest/v1/service_requests?select=*&id=eq.${encodeURIComponent(current.id)}&limit=1`);
  const fresh=freshRows?.[0];
  if(fresh) return {__concurrent:true,...fresh};
  const e=new Error('Service request not found.');e.status=404;throw e;
}

async function recordHistory({requestId,oldStatus,newStatus,note,actorId}){
  try{
    await lib.sbJson('/rest/v1/service_request_status_history',{
      method:'POST',
      headers:{Prefer:'return=minimal'},
      body:JSON.stringify({
        service_request_id:requestId,
        old_status:oldStatus,
        new_status:newStatus,
        note:note||null,
        changed_by_admin_portal_user:actorId
      })
    });
    return true;
  }catch(e){
    // The status update has already succeeded. Do not report the whole action as failed
    // and tempt an administrator to click twice; log the audit warning for Netlify instead.
    console.error('admin-service-request-action:history-warning',e);
    return false;
  }
}

exports.handler=async event=>{
  if(event.httpMethod!=='POST') return lib.json(405,{error:'Method not allowed'});
  try{
    if(!lib.sameOrigin(event)) return lib.json(403,{error:'Invalid request origin'});
    const auth=await lib.requireAdmin(event);
    const p=JSON.parse(event.body||'{}');
    if(!p.request_id||!p.action) return lib.json(400,{error:'Request and action are required.'});

    const currentRows=await lib.sbJson(`/rest/v1/service_requests?select=*&id=eq.${encodeURIComponent(p.request_id)}&limit=1`);
    const current=Array.isArray(currentRows)?currentRows[0]:null;
    if(!current) return lib.json(404,{error:'Service request not found'});

    const action=String(p.action||'').trim().toUpperCase();
    if(actionAlreadyApplied(action,current.status)) return lib.json(200,{request:current,already_applied:true});

    if(action==='UPDATE_DETAILS'){
      const v=p.value||{}; const serviceId=String(v.service_id||'').trim();
      if(!serviceId) return lib.json(400,{error:'Service is required.'});
      const sr=await lib.sbJson(`/rest/v1/services?select=id,name&id=eq.${encodeURIComponent(serviceId)}&active=eq.true&limit=1`),svc=sr?.[0];
      if(!svc) return lib.json(400,{error:'Selected service is not available.'});
      const preferredDate=String(v.preferred_date||'').trim();
      const preferredTime=String(v.preferred_start_time||'').trim().slice(0,5);
      const estimatedHours=Number(v.estimated_hours);
      const flexibility=String(v.scheduling_flexibility||'FLEXIBLE').trim().toUpperCase();
      if(!preferredDate||!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) return lib.json(400,{error:'Preferred Date is required.'});
      if(!/^\d{2}:(00|15|30|45)$/.test(preferredTime)) return lib.json(400,{error:'Preferred Time must use 15-minute increments.'});
      if(!Number.isFinite(estimatedHours)||estimatedHours<0.25||estimatedHours>72||Math.abs(estimatedHours*4-Math.round(estimatedHours*4))>1e-9) return lib.json(400,{error:'Estimated Hours must use 0.25-hour increments between 0.25 and 72.'});
      if(!['EXACT','SAME_DAY','FLEXIBLE','ANYTIME'].includes(flexibility)) return lib.json(400,{error:'Invalid scheduling flexibility.'});
      const dropoff=String(v.dropoff_address||'').trim();
      const customerFreeNotes=String(v.customer_notes||'').trim();
      const legacyNotes=[dropoff?`Drop-off address: ${dropoff}`:'',`Estimated hours requested: ${estimatedHours}`,customerFreeNotes].filter(Boolean).join('\n');
      const patch={service_id:svc.id,service_name:svc.name,street_address:String(v.street_address||'').trim()||null,city:String(v.city||'').trim()||null,province:String(v.province||'').trim()||null,postal_code:String(v.postal_code||'').trim()||null,dropoff_address:dropoff||null,estimated_hours:estimatedHours,preferred_date:preferredDate,preferred_start_time:preferredTime,scheduling_flexibility:flexibility,work_description:String(v.work_description||'').trim(),customer_notes:legacyNotes||null,updated_at:new Date().toISOString()};
      if(!patch.work_description) return lib.json(400,{error:'Work Description is required.'});
      if(!patch.street_address||!patch.city||!patch.province) return lib.json(400,{error:'Complete the service location before scheduling the Job.'});
      // If this request has already become a Job, the Service Request cannot become a
      // second, conflicting source of schedule truth. Save the request and synchronize
      // the active Job in one controlled operation. A failed Job sync rolls the request
      // back to the values it had before the Administrator clicked Save.
      if(current.job_id&&current.status==='ASSIGNED'){
        const linked=(await lib.sbJson(`/rest/v1/jobs?select=id,service_id,reference,status&id=eq.${encodeURIComponent(current.job_id)}&limit=1`))?.[0];
        if(!linked) return lib.json(409,{error:'The related Job could not be found. Open Service Maintenance before changing this assigned request.'});
        if(String(linked.service_id||'')!==String(svc.id||'')) return lib.json(409,{error:'The Service cannot be changed after a Job has been created. Change only the date, time, hours, address or work description.'});
      }
      const rollbackPatch={service_id:current.service_id,service_name:current.service_name,street_address:current.street_address,city:current.city,province:current.province,postal_code:current.postal_code,dropoff_address:current.dropoff_address,estimated_hours:current.estimated_hours,preferred_date:current.preferred_date,preferred_start_time:current.preferred_start_time,scheduling_flexibility:current.scheduling_flexibility,work_description:current.work_description,customer_notes:current.customer_notes,customer_id:current.customer_id,updated_at:current.updated_at};
      let updated;
      try{
        updated=await lib.sbJson(`/rest/v1/service_requests?id=eq.${encodeURIComponent(current.id)}&select=*`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});
        if(current.job_id&&current.status==='ASSIGNED'){
          const scheduledStart=jobSchedule.edmontonLocalToIso(preferredDate,preferredTime),scheduledEnd=new Date(new Date(scheduledStart).getTime()+Math.round(estimatedHours*60)*60000).toISOString();
          await jobSchedule.updateActiveJob({actorId:auth.user.id,jobId:current.job_id,applyToTeam:true,scheduledStart,scheduledEnd,estimatedDurationMinutes:Math.round(estimatedHours*60),syncHourlyBilling:true,syncSourceRequest:false,workAddress:[patch.street_address,patch.city,patch.province,patch.postal_code].filter(Boolean).join(', '),workDescription:patch.work_description,reason:`Related Service Request ${current.reference} updated by PLEASE Administration`,notifyPeople:true});
        }
      }catch(syncError){
        try{await lib.sbJson(`/rest/v1/service_requests?id=eq.${encodeURIComponent(current.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(rollbackPatch)});}catch(rollbackError){console.error('admin-service-request-action:request-rollback-warning',rollbackError);}
        throw Object.assign(new Error(`The request was not changed because the related Job could not be synchronized. ${syncError.message||''}`.trim()),{status:syncError.status||409});
      }
      const customerId=await customerLib.upsertCustomer({first_name:current.first_name,last_name:current.last_name,email:current.email,phone:current.phone,street_address:patch.street_address,city:patch.city,province:patch.province,postal_code:patch.postal_code},{incrementRequest:false});
      if(customerId&&customerId!==current.customer_id){await lib.sbJson(`/rest/v1/service_requests?id=eq.${encodeURIComponent(current.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({customer_id:customerId,updated_at:new Date().toISOString()})}).catch(()=>{});if(updated?.[0])updated[0].customer_id=customerId;}
      await lib.sbJson('/rest/v1/service_request_status_history',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({service_request_id:current.id,old_status:current.status,new_status:current.status,note:current.job_id?'Request details updated and related Job synchronized by PLEASE Administration':'Request details updated by PLEASE Administration',changed_by_admin_portal_user:auth.user.id})}).catch(e=>console.error('admin-service-request-action:details-history-warning',e));
      const out=updated?.[0]||current;
      // The active Job synchronization already sends the schedule update when linked.
      // For an unassigned request, keep the normal request-update email.
      const n=current.job_id?null:await notify.send({to:out.email,subject:`PLEASE — Request Updated (${out.reference})`,title:'Your service request was updated',intro:`Hi ${out.first_name||'there'}, PLEASE Administration updated the details of your request.`,details:[['Request',out.reference],['Service',out.service_name],['Status',out.status]],ctaLabel:'Track Your Request',ctaUrl:`${notify.baseUrl()}/track-request.html`,idempotencyKey:`please-request-details-${out.id}-${Date.now()}`});
      return lib.json(200,{request:out,related_job_synchronized:!!current.job_id,notification_sent:!!n?.sent});
    }

    if(action==='SAVE_NOTES'){
      const updated=await lib.sbJson(`/rest/v1/service_requests?id=eq.${encodeURIComponent(current.id)}&select=*`,{
        method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({internal_notes:String(p.value??'')})
      });
      // Internal notes are private administration data and must never trigger a customer email.
      return lib.json(200,{request:updated?.[0]||current,notification_sent:false});
    }

    // STEP 15.8.6.1: perform the simple request-state transitions directly through the
    // already authenticated Netlify backend. This removes the legacy RPC as a single
    // point of failure while keeping the same state machine and audit history.
    const plan=transitionPlan(action,current,p.value);
    const out=await patchRequest(current,plan.patch);
    if(out.__concurrent){
      if(actionAlreadyApplied(action,out.status)) return lib.json(200,{request:out,already_applied:true});
      return lib.json(409,{error:'This request changed in another session. Refresh and try again.',request:out});
    }
    let title='PLEASE request update',intro=`Hi ${out.first_name||'there'}, your PLEASE request has been updated.`,message='';
    if(action==='START_REVIEW'){title='PLEASE is reviewing your request';intro=`Hi ${out.first_name||'there'}, our operations team has started reviewing your service request.`;}
    if(action==='READY_TO_ASSIGN'){title='Your request is ready for provider coordination';intro=`Hi ${out.first_name||'there'}, PLEASE has reviewed your request and is coordinating the right provider and schedule.`;}
    if(action==='CANCEL'){title='Your PLEASE request was cancelled';intro=`Hi ${out.first_name||'there'}, your service request has been marked cancelled.`;message=String(p.value||out.cancellation_reason||'').slice(0,1000);}

    // Email delivery is deliberately non-blocking for the business transition in the sense
    // that it is bounded by the global Resend timeout and cannot roll back the database update.
    // History + email run in parallel so Netlify is not forced through two sequential network waits.
    const [historyRecorded,n]=await Promise.all([
      recordHistory({requestId:current.id,oldStatus:current.status,newStatus:plan.newStatus,note:plan.note,actorId:auth.user.id}),
      notify.send({to:out.email,subject:`PLEASE — ${title} (${out.reference})`,title,intro,details:[['Request',out.reference],['Service',out.service_name],['Status',out.status]],message,ctaLabel:'Track Your Request',ctaUrl:`${notify.baseUrl()}/track-request.html`,idempotencyKey:`please-request-${out.id}-${action}`})
    ]);
    return lib.json(200,{request:out,notification_sent:!!n?.sent,history_recorded:historyRecorded});
  }catch(e){
    console.error('admin-service-request-action',e);
    return lib.json(e.status||500,{error:e.status===401?'Unauthorized':(e.message||'Unable to update service request.')});
  }
};
