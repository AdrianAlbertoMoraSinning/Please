const lib=require('./_admin-lib');

function actionAlreadyApplied(action,status){
  const a=String(action||'').toUpperCase();
  if(a==='START_REVIEW') return status==='REVIEWING';
  if(a==='READY_TO_ASSIGN') return status==='READY_TO_ASSIGN';
  if(a==='CANCEL') return status==='CANCELLED';
  return false;
}

exports.handler=async event=>{
  if(event.httpMethod!=='POST') return lib.json(405,{error:'Method not allowed'});
  try{
    if(!lib.sameOrigin(event)) return lib.json(403,{error:'Invalid request origin'});
    const auth=await lib.requireAdmin(event);
    const p=JSON.parse(event.body||'{}');
    if(!p.request_id||!p.action) return lib.json(400,{error:'Request and action are required.'});

    // Make status transitions idempotent. Browser double-clicks, mobile taps, or a retried
    // network request must not turn a successful transition into a misleading error banner.
    const currentRows=await lib.sbJson(`/rest/v1/service_requests?select=*&id=eq.${encodeURIComponent(p.request_id)}&limit=1`);
    const current=Array.isArray(currentRows)?currentRows[0]:null;
    if(!current) return lib.json(404,{error:'Service request not found'});
    if(actionAlreadyApplied(p.action,current.status)) return lib.json(200,{request:current,already_applied:true});

    if(String(p.action).toUpperCase()==='UPDATE_DETAILS'){
      const v=p.value||{}; const serviceId=String(v.service_id||'').trim();
      if(!serviceId) return lib.json(400,{error:'Service is required.'});
      const sr=await lib.sbJson(`/rest/v1/services?select=id,name&id=eq.${encodeURIComponent(serviceId)}&active=eq.true&limit=1`),svc=sr?.[0];
      if(!svc) return lib.json(400,{error:'Selected service is not available.'});
      const moving=String(svc.name||'').toLowerCase()==='moving';
      const patch={service_id:svc.id,service_name:svc.name,street_address:String(v.street_address||'').trim()||null,city:String(v.city||'').trim()||null,province:String(v.province||'').trim()||null,postal_code:String(v.postal_code||'').trim()||null,work_description:String(v.work_description||'').trim(),customer_notes:String(v.customer_notes||'').trim()||null,moving_bedrooms:moving&&v.moving_bedrooms!==''?Number(v.moving_bedrooms):null,moving_square_feet:moving&&v.moving_square_feet!==''?Number(v.moving_square_feet):null,moving_inventory:moving?String(v.moving_inventory||'').trim()||null:null,updated_at:new Date().toISOString()};
      if(!patch.work_description) return lib.json(400,{error:'Work Description is required.'});
      if(!patch.street_address||!patch.city||!patch.province) return lib.json(400,{error:'Complete the service location before scheduling the Job.'});
      if(moving&&(!Number.isInteger(patch.moving_bedrooms)||patch.moving_bedrooms<0||!Number.isFinite(patch.moving_square_feet)||patch.moving_square_feet<=0||!patch.moving_inventory)) return lib.json(400,{error:'Complete all Moving details.'});
      const updated=await lib.sbJson(`/rest/v1/service_requests?id=eq.${encodeURIComponent(current.id)}&select=*`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});
      await lib.sbJson('/rest/v1/service_request_status_history',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({service_request_id:current.id,old_status:current.status,new_status:current.status,note:'Request details updated by PLEASE Administration',changed_by_admin_portal_user:auth.user.id})}).catch(()=>{});
      return lib.json(200,{request:updated?.[0]||current});
    }

    const rows=await lib.sbJson('/rest/v1/rpc/please_service_request_action',{method:'POST',body:JSON.stringify({p_actor:auth.user.id,p_request_id:p.request_id,p_action:p.action,p_value:p.value??null})});
    return lib.json(200,{request:Array.isArray(rows)?rows[0]:rows});
  }catch(e){
    console.error('admin-service-request-action',e);
    return lib.json(e.status||500,{error:e.status===401?'Unauthorized':(e.message||'Unable to update service request.')});
  }
};
