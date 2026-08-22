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

    const rows=await lib.sbJson('/rest/v1/rpc/please_service_request_action',{method:'POST',body:JSON.stringify({p_actor:auth.user.id,p_request_id:p.request_id,p_action:p.action,p_value:p.value??null})});
    return lib.json(200,{request:Array.isArray(rows)?rows[0]:rows});
  }catch(e){
    console.error('admin-service-request-action',e);
    return lib.json(e.status||500,{error:e.status===401?'Unauthorized':(e.message||'Unable to update service request.')});
  }
};
