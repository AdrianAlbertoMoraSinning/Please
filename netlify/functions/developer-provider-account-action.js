const lib=require('./_admin-lib');
exports.handler=async function(event){
 if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
 if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
 try{
  const auth=await lib.requireDeveloper(event),b=JSON.parse(event.body||'{}'),providerId=String(b.provider_id||'').trim(),action=String(b.action||'').trim().toUpperCase();
  if(!/^[0-9a-f-]{36}$/i.test(providerId))return lib.json(400,{error:'Invalid provider id'});
  if(!['CHANGE_LOGIN_EMAIL','RESET_PASSWORD','DEACTIVATE','REACTIVATE','ARCHIVE','SET_PUBLIC_VISIBILITY'].includes(action))return lib.json(400,{error:'Invalid action'});
  const result=await lib.sbJson('/rest/v1/rpc/developer_provider_account_action',{method:'POST',body:JSON.stringify({p_actor:auth.user.id,p_provider_id:providerId,p_action:action,p_payload:b.payload||{}})});
  return lib.json(200,{ok:true,result});
 }catch(e){console.error('developer-provider-account-action',e);return lib.json(e.status===401?401:400,{error:e.status===401?'Unauthorized':(e.message||'Provider account action failed.')});}
};
