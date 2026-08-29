const lib=require('./_admin-lib');
const notify=require('./_notify-lib');
exports.handler=async function(event){
 if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
 if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
 try{
  const auth=await lib.requireDeveloper(event),b=JSON.parse(event.body||'{}'),providerId=String(b.provider_id||'').trim(),action=String(b.action||'').trim().toUpperCase();
  if(!/^[0-9a-f-]{36}$/i.test(providerId))return lib.json(400,{error:'Invalid provider id'});
  if(!['CHANGE_LOGIN_EMAIL','RESET_PASSWORD','DEACTIVATE','REACTIVATE','ARCHIVE','SET_PUBLIC_VISIBILITY','SET_WORKER_TYPE'].includes(action))return lib.json(400,{error:'Invalid action'});
  let result={ok:true};
  if(action==='SET_WORKER_TYPE'){const wt=String(b.payload?.worker_type||'').toUpperCase();if(!['INDEPENDENT_PROVIDER','PLEASE_STAFF'].includes(wt))return lib.json(400,{error:'Invalid worker type'});await lib.sbJson(`/rest/v1/providers?id=eq.${encodeURIComponent(providerId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({worker_type:wt,updated_at:new Date().toISOString()})});}
  else result=await lib.sbJson('/rest/v1/rpc/developer_provider_account_action',{method:'POST',body:JSON.stringify({p_actor:auth.user.id,p_provider_id:providerId,p_action:action,p_payload:b.payload||{}})});
  const pr=await notify.providerContext(providerId).catch(()=>null),n=await notify.sendProvider(providerId,{subject:`PLEASE — Provider Account Update`,title:'PLEASE Provider account updated',intro:`Hello ${pr?.display_name||'Provider'}, your PLEASE Provider account settings were updated by the Developer workflow.`,details:[['Provider',pr?.display_name],['Action',action.replaceAll('_',' ')],['Status',pr?.status]],message:action==='RESET_PASSWORD'?'For security, passwords are not included in email. Use the approved secure channel for any temporary credential.':'',ctaLabel:'Provider Portal',ctaUrl:`${notify.baseUrl()}/provider-login.html`,idempotencyKey:`please-provider-account-developer-${providerId}-${action}-${Date.now()}`});
  return lib.json(200,{ok:true,result,notification_sent:!!n?.sent});
 }catch(e){console.error('developer-provider-account-action',e);return lib.json(e.status===401?401:400,{error:e.status===401?'Unauthorized':(e.message||'Provider account action failed.')});}
};
