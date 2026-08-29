const lib=require('./_provider-lib');
const notify=require('./_notify-lib');
const UNITS=new Set(['hour','service','item','load','room','sq_ft','day','other']);
const METHODS=new Set(['NONE','FIXED_CAD','PERCENT']);
const money=n=>Math.round(Number(n)*100)/100;
exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
  try{
    const auth=await lib.requireProvider(event),body=JSON.parse(event.body||'{}');
    const action=String(body.action||'').toUpperCase(),payload=body.payload||{},pid=auth.provider.id;
    if(action==='SAVE'){
      const id=String(payload.id||'').trim(),serviceId=String(payload.service_id||'').trim();
      const name=String(payload.rate_name||'').trim().slice(0,160),description=String(payload.description||'').trim().slice(0,1000)||null;
      const unit=String(payload.billing_unit||'service').trim().toLowerCase();
      const method=String(payload.provider_compensation_method||'NONE').trim().toUpperCase();
      let comp=null;if(method!=='NONE')comp=money(payload.provider_compensation);
      if(!/^[0-9a-f-]{36}$/i.test(serviceId)||!name||!UNITS.has(unit)||!METHODS.has(method)||method==='NONE')return lib.json(400,{error:'Service, rate name, billing unit and a Provider Charge method are required.'});
      if(method!=='NONE'&&(!Number.isFinite(comp)||comp<0))return lib.json(400,{error:'Enter a valid provider compensation value.'});
      if(method==='PERCENT'&&comp>100)return lib.json(400,{error:'Provider compensation percentage cannot exceed 100%.'});
      const assigned=await lib.sbJson(`/rest/v1/provider_services?select=service_id&provider_id=eq.${encodeURIComponent(pid)}&service_id=eq.${encodeURIComponent(serviceId)}&active=eq.true&limit=1`);
      if(!assigned?.length)return lib.json(409,{error:'That service is not active on your provider profile.'});
      let existingCustomerRate=0;if(id){const old=await lib.sbJson(`/rest/v1/provider_service_rates?select=id,customer_rate&provider_id=eq.${encodeURIComponent(pid)}&id=eq.${encodeURIComponent(id)}&limit=1`);existingCustomerRate=Number(old?.[0]?.customer_rate)||0;}
      const row={provider_id:pid,service_id:serviceId,rate_name:name,description,billing_unit:unit,customer_rate:existingCustomerRate,provider_compensation_method:method,provider_compensation:comp,active:true,updated_at:new Date().toISOString()};
      let savedId=id;
      if(id){
        const owned=await lib.sbJson(`/rest/v1/provider_service_rates?select=id&provider_id=eq.${encodeURIComponent(pid)}&id=eq.${encodeURIComponent(id)}&limit=1`);if(!owned?.length)return lib.json(404,{error:'Rate item not found.'});
        await lib.sbJson(`/rest/v1/provider_service_rates?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)});
      }else{
        const created=await lib.sbJson('/rest/v1/provider_service_rates',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(row)});savedId=created?.[0]?.id;
      }
      const service=(await lib.sbJson(`/rest/v1/services?select=name&id=eq.${encodeURIComponent(serviceId)}&limit=1`).catch(()=>[]))?.[0];
      const n=await notify.sendAdmins({subject:`PLEASE — Provider Rate Updated (${auth.provider.reference||auth.provider.display_name})`,title:'Provider rate updated',intro:`${auth.provider.display_name} saved a provider compensation rate.`,details:[['Provider',auth.provider.display_name],['Service',service?.name||serviceId],['Rate',name],['Billing unit',unit],['Compensation',method==='PERCENT'?`${comp}%`:notify.money(comp)],['Method',method]],ctaLabel:'Open Providers',ctaUrl:`${notify.baseUrl()}/admin-providers.html`,idempotencyKey:`please-provider-rate-save-${savedId||pid+'-'+Date.now()}`});
      return lib.json(200,{ok:true,id:savedId,admin_notified:!!n?.sent});
    }
    if(action==='DEACTIVATE'){
      const id=String(payload.id||'');
      const owned=await lib.sbJson(`/rest/v1/provider_service_rates?select=id,rate_name,service_id&provider_id=eq.${encodeURIComponent(pid)}&id=eq.${encodeURIComponent(id)}&limit=1`);if(!owned?.length)return lib.json(404,{error:'Rate item not found.'});
      await lib.sbJson(`/rest/v1/provider_service_rates?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({active:false,updated_at:new Date().toISOString()})});
      const n=await notify.sendAdmins({subject:`PLEASE — Provider Rate Deactivated (${auth.provider.reference||auth.provider.display_name})`,title:'Provider rate deactivated',intro:`${auth.provider.display_name} deactivated a provider rate.`,details:[['Provider',auth.provider.display_name],['Rate',owned[0].rate_name]],ctaLabel:'Open Providers',ctaUrl:`${notify.baseUrl()}/admin-providers.html`,idempotencyKey:`please-provider-rate-deactivate-${id}`});
      return lib.json(200,{ok:true,admin_notified:!!n?.sent});
    }
    return lib.json(400,{error:'Unsupported rate action.'});
  }catch(e){console.error('provider-service-rate-action',e);return lib.json(e.status||400,{error:e.message||'Rate could not be saved.'});}
};
