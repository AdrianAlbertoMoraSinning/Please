const lib=require('./_admin-lib');
const money=n=>Math.round((Number(n)||0)*100)/100;
async function validateBillingItems(providerId,items){
  if(!Array.isArray(items)||!items.length)throw Object.assign(new Error('Add at least one Customer Billing item.'),{status:400});
  const clean=items.map((x,i)=>{const rateId=String(x?.provider_service_rate_id||''),qty=Number(x?.quantity),customerRate=Number(x?.customer_unit_rate??x?.unit_rate);if(!/^[0-9a-f-]{36}$/i.test(rateId)||!Number.isFinite(qty)||qty<=0||!Number.isFinite(customerRate)||customerRate<0)throw Object.assign(new Error(`Invalid Customer Billing item ${i+1}.`),{status:400});return{rateId,qty:money(qty),customerRate:money(customerRate)};});
  const ids=[...new Set(clean.map(x=>x.rateId))],list=ids.map(x=>encodeURIComponent(x)).join(',');
  const rates=await lib.sbJson(`/rest/v1/provider_service_rates?select=id,provider_id,service_id,rate_name,description,billing_unit,customer_rate,provider_compensation_method,provider_compensation,active&id=in.(${list})&provider_id=eq.${encodeURIComponent(providerId)}&active=eq.true`);
  if((rates||[]).length!==ids.length)throw Object.assign(new Error('One or more selected rate items are no longer active for this provider.'),{status:409});
  const serviceIds=[...new Set(rates.map(r=>r.service_id))],serviceList=serviceIds.map(x=>encodeURIComponent(x)).join(',');
  const services=serviceIds.length?await lib.sbJson(`/rest/v1/services?select=id,name&id=in.(${serviceList})`):[];
  const serviceNames=new Map((services||[]).map(x=>[x.id,x.name])),map=new Map(rates.map(r=>[r.id,r]));
  return clean.map((x,i)=>{
    const r=map.get(x.rateId),method=String(r.provider_compensation_method||'NONE').toUpperCase(),value=r.provider_compensation==null?null:Number(r.provider_compensation);
    if(method==='NONE'||!Number.isFinite(value))throw Object.assign(new Error(`${r.rate_name} does not have a Provider Charge configured. The provider must set the rate before PLEASE can assign it.`),{status:409});
    const providerRate=method==='FIXED_CAD'?money(value):money(x.customerRate*value/100);
    return{provider_service_rate_id:r.id,service_id:r.service_id,service_name:serviceNames.get(r.service_id)||null,description:r.rate_name,quantity:x.qty,unit:r.billing_unit,customer_unit_rate:x.customerRate,customer_line_total:money(x.qty*x.customerRate),unit_rate:x.customerRate,line_total:money(x.qty*x.customerRate),provider_compensation_method:method,provider_compensation_value:money(value),provider_unit_rate:providerRate,provider_line_total:money(x.qty*providerRate),gross_profit:money(x.qty*(x.customerRate-providerRate)),sort_order:(i+1)*10};
  });
}
exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  try{
    if(!lib.sameOrigin(event))return lib.json(403,{error:'Forbidden'});
    const auth=await lib.requireAdmin(event);let body={};try{body=JSON.parse(event.body||'{}');}catch{return lib.json(400,{error:'Invalid JSON'});}const action=String(body.action||'').trim().toUpperCase();if(!action)return lib.json(400,{error:'Action is required'});
    let validatedBilling=null,sourceRequest=null;
    if(action==='CREATE_AND_ASSIGN'){
      const requestId=String(body.payload?.service_request_id||'').trim();
      if(requestId){
        const reqs=await lib.sbJson(`/rest/v1/service_requests?select=id,reference,status,job_id,city,province,postal_code,moving_bedrooms,moving_square_feet,moving_inventory&id=eq.${encodeURIComponent(requestId)}&limit=1`);sourceRequest=reqs?.[0];
        if(!sourceRequest)throw Object.assign(new Error('Source Service Request not found.'),{status:404});
        if(sourceRequest.status!=='READY_TO_ASSIGN'||sourceRequest.job_id)throw Object.assign(new Error(`${sourceRequest.reference} is no longer Ready to Assign.`),{status:409});
        body.payload.customer_city=body.payload.customer_city||sourceRequest.city||'';body.payload.customer_province=body.payload.customer_province||sourceRequest.province||'AB';body.payload.customer_postal_code=body.payload.customer_postal_code||sourceRequest.postal_code||'';
      }
      validatedBilling=await validateBillingItems(String(body.payload?.provider_id||''),body.payload?.billing_items);
    }
    const result=await lib.sbJson('/rest/v1/rpc/please_portal_job_action',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_actor:auth.user.id,p_action:action,p_payload:body.payload||{}})});
    const value=Array.isArray(result)?result[0]:result;
    if(action==='CREATE_AND_ASSIGN'&&value?.job_id){
      const rows=validatedBilling.map(x=>({...x,job_id:value.job_id}));
      await lib.sbJson('/rest/v1/job_billing_items',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(rows)});
      const subtotal=money(rows.reduce((n,x)=>n+x.line_total,0));
      await lib.sbJson(`/rest/v1/jobs?id=eq.${encodeURIComponent(value.job_id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({quoted_subtotal:subtotal,moving_bedrooms:sourceRequest?.moving_bedrooms??null,moving_square_feet:sourceRequest?.moving_square_feet??null,moving_inventory:sourceRequest?.moving_inventory??null,updated_at:new Date().toISOString()})});
      if(sourceRequest){
        const linked=await lib.sbJson('/rest/v1/rpc/please_link_service_request_to_job',{method:'POST',body:JSON.stringify({p_actor:auth.user.id,p_request_id:sourceRequest.id,p_job_id:value.job_id})});
        value.service_request_assigned=true;value.service_request_reference=sourceRequest.reference;value.service_request=Array.isArray(linked)?linked[0]:linked;
      }
    }
    return lib.json(200,value||{ok:true});
  }catch(e){console.error('admin-job-action',e);let message=e.message||'Job action failed.';if(/exclusion|job_assignments_no_provider_overlap|conflict/i.test(message))message='That provider already has an assignment overlapping the selected time.';return lib.json(e.status||400,{error:message});}
};
