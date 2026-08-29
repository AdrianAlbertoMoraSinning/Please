const lib=require('./_provider-lib');
const notify=require('./_notify-lib');
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
 try{
  const a=await lib.requireProvider(event),b=JSON.parse(event.body||'{}'),id=String(b.service_id||'').trim(),enabled=!!b.enabled;
  if(!/^[0-9a-f-]{36}$/i.test(id))return lib.json(400,{error:'Invalid service'});
  const service=(await lib.sbJson(`/rest/v1/services?select=id,name&id=eq.${encodeURIComponent(id)}&limit=1`).catch(()=>[]))?.[0];
  const result=await lib.sbJson('/rest/v1/rpc/provider_portal_service_action',{method:'POST',body:JSON.stringify({p_actor:a.user.id,p_service_id:id,p_enabled:enabled})});
  const n=await notify.sendAdmins({subject:`PLEASE — Provider Service ${enabled?'Enabled':'Paused'} (${a.provider.reference||a.provider.display_name})`,title:`Provider service ${enabled?'enabled':'paused'}`,intro:`${a.provider.display_name} changed a service setting in the Provider Portal.`,details:[['Provider',a.provider.display_name],['Service',service?.name||id],['Status',enabled?'ENABLED':'PAUSED']],ctaLabel:'Open Providers',ctaUrl:`${notify.baseUrl()}/admin-providers.html`,idempotencyKey:`please-provider-service-toggle-${a.provider.id}-${id}-${enabled}-${Date.now()}`});
  return lib.json(200,{ok:true,result,admin_notified:!!n?.sent});
 }
 catch(e){console.error('provider-service-action',e);return lib.json(e.status===401?401:400,{error:e.status===401?'Unauthorized':(e.message||'Service could not be updated.')});}
};
