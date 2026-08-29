const lib=require('./_admin-lib');
const notify=require('./_notify-lib');
exports.handler=async function(event){
 if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
 try{
  const a=await lib.requireDeveloper(event),b=JSON.parse(event.body||'{}'),pid=String(b.provider_id||'').trim(),ids=Array.isArray(b.service_ids)?b.service_ids:[];
  if(!/^[0-9a-f-]{36}$/i.test(pid))return lib.json(400,{error:'Invalid provider id'});for(const id of ids)if(!/^[0-9a-f-]{36}$/i.test(String(id)))return lib.json(400,{error:'Invalid service id'});
  const result=await lib.sbJson('/rest/v1/rpc/developer_provider_service_action',{method:'POST',body:JSON.stringify({p_actor:a.user.id,p_provider_id:pid,p_service_ids:ids})});
  let names=[];if(ids.length){names=(await lib.sbJson(`/rest/v1/services?select=id,name&id=in.(${ids.map(x=>encodeURIComponent(String(x))).join(',')})`).catch(()=>[])).map(x=>x.name);}
  const pr=await notify.providerContext(pid).catch(()=>null);
  const n=await notify.sendProvider(pid,{subject:'PLEASE — Provider Services Authorization Updated',title:'Your PLEASE service authorization changed',intro:`Hello ${pr?.display_name||'Provider'}, the PLEASE Developer workflow updated the services authorized for your Provider profile.`,details:[['Authorized services',names.length?names.join(', '):'None currently authorized']],ctaLabel:'Provider Portal',ctaUrl:`${notify.baseUrl()}/provider.html`,idempotencyKey:`please-developer-provider-services-${pid}-${Date.now()}`});
  return lib.json(200,{ok:true,result,provider_notified:!!n?.sent});
 }catch(e){console.error('developer-provider-service-action',e);return lib.json(e.status===401?401:400,{error:e.status===401?'Unauthorized':(e.message||'Authorized services could not be updated.')});}
};
