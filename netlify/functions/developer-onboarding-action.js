const lib=require('./_admin-lib');
exports.handler=async function(event){
  if(event.httpMethod!=='POST') return lib.json(405,{error:'Method not allowed'});
  if(!lib.sameOrigin(event)) return lib.json(403,{error:'Invalid request origin'});
  try{
    const auth=await lib.requireDeveloper(event);
    const body=JSON.parse(event.body||'{}');
    const applicationId=String(body.application_id||'').trim();
    const action=String(body.action||'').trim().toUpperCase();
    const payload=(body.payload&&typeof body.payload==='object')?body.payload:{};
    if(!/^[0-9a-f-]{36}$/i.test(applicationId)) return lib.json(400,{error:'Invalid application id'});
    if(!['START_ONBOARDING','SAVE_ONBOARDING','APPROVE','ACTIVATE'].includes(action)) return lib.json(400,{error:'Invalid action'});
    const result=await lib.sbJson('/rest/v1/rpc/developer_portal_onboarding_action',{method:'POST',body:JSON.stringify({p_actor:auth.user.id,p_application_id:applicationId,p_action:action,p_payload:payload})});
    return lib.json(200,{ok:true,result});
  }catch(error){console.error('developer-onboarding-action',error);return lib.json(error.status===401?401:400,{error:error.status===401?'Unauthorized':(error.message||'Developer action failed')});}
};
