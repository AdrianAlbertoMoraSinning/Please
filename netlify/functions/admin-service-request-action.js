const lib=require('./_admin-lib');
const notify=require('./_notify-lib');

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
      const patch={service_id:svc.id,service_name:svc.name,street_address:String(v.street_address||'').trim()||null,city:String(v.city||'').trim()||null,province:String(v.province||'').trim()||null,postal_code:String(v.postal_code||'').trim()||null,work_description:String(v.work_description||'').trim(),customer_notes:String(v.customer_notes||'').trim()||null,updated_at:new Date().toISOString()};
      if(!patch.work_description) return lib.json(400,{error:'Work Description is required.'});
      if(!patch.street_address||!patch.city||!patch.province) return lib.json(400,{error:'Complete the service location before scheduling the Job.'});
      const updated=await lib.sbJson(`/rest/v1/service_requests?id=eq.${encodeURIComponent(current.id)}&select=*`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});
      await lib.sbJson('/rest/v1/service_request_status_history',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({service_request_id:current.id,old_status:current.status,new_status:current.status,note:'Request details updated by PLEASE Administration',changed_by_admin_portal_user:auth.user.id})}).catch(e=>console.error('admin-service-request-action:details-history-warning',e));
      const out=updated?.[0]||current;
      const n=await notify.send({to:out.email,subject:`PLEASE — Request Updated (${out.reference})`,title:'Your service request was updated',intro:`Hi ${out.first_name||'there'}, PLEASE Administration updated the details of your request.`,details:[['Request',out.reference],['Service',out.service_name],['Status',out.status]],ctaLabel:'Track Your Request',ctaUrl:`${notify.baseUrl()}/track-request.html`,idempotencyKey:`please-request-details-${out.id}-${Date.now()}`});
      return lib.json(200,{request:out,notification_sent:!!n?.sent});
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
