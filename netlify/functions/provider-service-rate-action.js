const lib=require('./_provider-lib');
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
      let comp=null;
      if(method!=='NONE')comp=money(payload.provider_compensation);
      if(!/^[0-9a-f-]{36}$/i.test(serviceId)||!name||!UNITS.has(unit)||!METHODS.has(method)||method==='NONE')return lib.json(400,{error:'Service, rate name, billing unit and a Provider Charge method are required.'});
      if(method!=='NONE'&&(!Number.isFinite(comp)||comp<0))return lib.json(400,{error:'Enter a valid provider compensation value.'});
      if(method==='PERCENT'&&comp>100)return lib.json(400,{error:'Provider compensation percentage cannot exceed 100%.'});
            const assigned=await lib.sbJson(`/rest/v1/provider_services?select=service_id&provider_id=eq.${encodeURIComponent(pid)}&service_id=eq.${encodeURIComponent(serviceId)}&active=eq.true&limit=1`);
      if(!assigned?.length)return lib.json(409,{error:'That service is not active on your provider profile.'});
      let existingCustomerRate=0;if(id){const old=await lib.sbJson(`/rest/v1/provider_service_rates?select=id,customer_rate&provider_id=eq.${encodeURIComponent(pid)}&id=eq.${encodeURIComponent(id)}&limit=1`);existingCustomerRate=Number(old?.[0]?.customer_rate)||0;}const row={provider_id:pid,service_id:serviceId,rate_name:name,description,billing_unit:unit,customer_rate:existingCustomerRate,provider_compensation_method:method,provider_compensation:comp,active:true,updated_at:new Date().toISOString()};
      if(id){
        const owned=await lib.sbJson(`/rest/v1/provider_service_rates?select=id&provider_id=eq.${encodeURIComponent(pid)}&id=eq.${encodeURIComponent(id)}&limit=1`);
        if(!owned?.length)return lib.json(404,{error:'Rate item not found.'});
        await lib.sbJson(`/rest/v1/provider_service_rates?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)});
        return lib.json(200,{ok:true,id});
      }
      const created=await lib.sbJson('/rest/v1/provider_service_rates',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(row)});
      return lib.json(200,{ok:true,id:created?.[0]?.id});
    }
    if(action==='DEACTIVATE'){
      const id=String(payload.id||'');
      const owned=await lib.sbJson(`/rest/v1/provider_service_rates?select=id&provider_id=eq.${encodeURIComponent(pid)}&id=eq.${encodeURIComponent(id)}&limit=1`);
      if(!owned?.length)return lib.json(404,{error:'Rate item not found.'});
      await lib.sbJson(`/rest/v1/provider_service_rates?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({active:false,updated_at:new Date().toISOString()})});
      return lib.json(200,{ok:true});
    }
    return lib.json(400,{error:'Unsupported rate action.'});
  }catch(e){console.error('provider-service-rate-action',e);return lib.json(e.status||400,{error:e.message||'Rate could not be saved.'});}
};
