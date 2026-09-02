const lib=require('./_admin-lib');
const notify=require('./_notify-lib');
const UNITS=new Set(['hour','service','item','load','room','sq_ft','day','other']);
const METHODS=new Set(['FIXED_CAD','PERCENT']);
const money=n=>Math.round(Number(n)*100)/100;
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
 try{
  const auth=await lib.requireAdmin(event),b=JSON.parse(event.body||'{}'),pid=String(b.provider_id||''),action=String(b.action||'SAVE').toUpperCase(),p=b.payload||{};if(!/^[0-9a-f-]{36}$/i.test(pid))return lib.json(400,{error:'Invalid Provider.'});
  const provider=(await lib.sbJson(`/rest/v1/providers?select=id,reference,display_name,status&id=eq.${encodeURIComponent(pid)}&limit=1`))?.[0];if(!provider)return lib.json(404,{error:'Provider not found.'});
  if(action==='DEACTIVATE'){
   const id=String(p.id||'');const owned=(await lib.sbJson(`/rest/v1/provider_service_rates?select=id,rate_name&id=eq.${encodeURIComponent(id)}&provider_id=eq.${encodeURIComponent(pid)}&limit=1`))?.[0];if(!owned)return lib.json(404,{error:'Rate item not found.'});
   await lib.sbJson(`/rest/v1/provider_service_rates?id=eq.${encodeURIComponent(id)}&provider_id=eq.${encodeURIComponent(pid)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({active:false,updated_at:new Date().toISOString()})});
   await lib.sbJson('/rest/v1/provider_technical_history',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({provider_id:pid,event_type:'ADMIN_RATE_CHANGED',event_label:'Provider rate deactivated by PLEASE Administration',details:{rate_id:id,rate_name:owned.rate_name},actor_type:'ADMIN',actor_admin_user_id:auth.user.id})}).catch(()=>{});
   return lib.json(200,{ok:true});
  }
  if(action!=='SAVE')return lib.json(400,{error:'Unsupported rate action.'});
  const id=String(p.id||'').trim(),serviceId=String(p.service_id||'').trim(),name=String(p.rate_name||'').trim().slice(0,160),description=String(p.description||'').trim().slice(0,1000)||null,unit=String(p.billing_unit||'service').toLowerCase(),method=String(p.provider_compensation_method||'FIXED_CAD').toUpperCase(),comp=money(p.provider_compensation);
  if(!/^[0-9a-f-]{36}$/i.test(serviceId)||!name||!UNITS.has(unit)||!METHODS.has(method)||!Number.isFinite(comp)||comp<0)return lib.json(400,{error:'Complete Service, Rate Name, Billing Unit and Provider Rate.'});if(method==='PERCENT'&&comp>100)return lib.json(400,{error:'Provider percentage cannot exceed 100%.'});
  const assigned=await lib.sbJson(`/rest/v1/provider_services?select=service_id&provider_id=eq.${encodeURIComponent(pid)}&service_id=eq.${encodeURIComponent(serviceId)}&active=eq.true&limit=1`);if(!assigned?.length)return lib.json(409,{error:'That service is not authorized for this Provider.'});
  let existingCustomerRate=0;if(id){const old=(await lib.sbJson(`/rest/v1/provider_service_rates?select=id,customer_rate&provider_id=eq.${encodeURIComponent(pid)}&id=eq.${encodeURIComponent(id)}&limit=1`))?.[0];if(!old)return lib.json(404,{error:'Rate item not found.'});existingCustomerRate=Number(old.customer_rate)||0;}
  const row={provider_id:pid,service_id:serviceId,rate_name:name,description,billing_unit:unit,customer_rate:existingCustomerRate,provider_compensation_method:method,provider_compensation:comp,active:p.active!==false,updated_at:new Date().toISOString()};let saved;
  if(id)saved=(await lib.sbJson(`/rest/v1/provider_service_rates?id=eq.${encodeURIComponent(id)}&provider_id=eq.${encodeURIComponent(pid)}&select=*`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(row)}))?.[0];else saved=(await lib.sbJson('/rest/v1/provider_service_rates?select=*',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(row)}))?.[0];
  await lib.sbJson('/rest/v1/provider_technical_history',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({provider_id:pid,event_type:'ADMIN_RATE_CHANGED',event_label:'Provider rate updated by PLEASE Administration',details:{rate_id:saved?.id,service_id:serviceId,rate_name:name,billing_unit:unit,compensation_method:method,compensation:comp},actor_type:'ADMIN',actor_admin_user_id:auth.user.id})}).catch(()=>{});
  await notify.sendProvider(pid,{subject:'PLEASE — Provider Rate Updated',title:'Provider rate updated by PLEASE Administration',intro:`Hello ${provider.display_name||'Provider'}, PLEASE Administration updated one of your Provider Service Rates.`,details:[['Rate',name],['Billing unit',unit],['Provider compensation',method==='PERCENT'?`${comp}%`:notify.money(comp)]],ctaLabel:'Open Provider Portal',ctaUrl:`${notify.baseUrl()}/provider-login.html`,idempotencyKey:`please-admin-provider-rate-${saved?.id||Date.now()}-${Date.now()}`}).catch(()=>null);
  return lib.json(200,{ok:true,rate:saved});
 }catch(e){console.error('admin-provider-rate-action',e);return lib.json(e.status||500,{error:e.status===401?'Unauthorized':(e.message||'Unable to save Provider Rate.')});}
};
