const lib=require('./_admin-lib');
exports.handler=async event=>{
  if(event.httpMethod!=='POST') return lib.json(405,{error:'Method not allowed'});
  try{
    if(!lib.sameOrigin(event)) return lib.json(403,{error:'Invalid request origin'});
    const auth=await lib.requireAdmin(event);
    const p=JSON.parse(event.body||'{}');
    if(!p.request_id||!p.action) return lib.json(400,{error:'Request and action are required.'});
    const rows=await lib.sbJson('/rest/v1/rpc/please_service_request_action',{method:'POST',body:JSON.stringify({p_actor:auth.user.id,p_request_id:p.request_id,p_action:p.action,p_value:p.value??null})});
    return lib.json(200,{request:Array.isArray(rows)?rows[0]:rows});
  }catch(e){console.error('admin-service-request-action',e);return lib.json(e.status||500,{error:e.status===401?'Unauthorized':(e.message||'Unable to update service request.')});}
};
