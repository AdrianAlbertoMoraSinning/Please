const lib=require('./_admin-lib');
const money=n=>Math.round((Number(n)||0)*100)/100;
async function validateBillingItems(providerId,items,allowNonpositiveMargin=false){
  if(!Array.isArray(items)||!items.length)throw Object.assign(new Error('Add at least one Customer Billing item for every provider.'),{status:400});
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
    if(x.customerRate<=providerRate&&!allowNonpositiveMargin)throw Object.assign(new Error(`${r.rate_name}: PLEASE Customer Rate (${money(x.customerRate)}) must be reviewed because it is not above the Provider Rate (${money(providerRate)}). Confirm the financial warning in Administration if this margin is intentional.`),{status:409});
    return{provider_service_rate_id:r.id,service_id:r.service_id,service_name:serviceNames.get(r.service_id)||null,description:r.rate_name,quantity:x.qty,unit:r.billing_unit,customer_unit_rate:x.customerRate,customer_line_total:money(x.qty*x.customerRate),provider_compensation_method:method,provider_compensation_value:money(value),provider_unit_rate:providerRate,provider_line_total:money(x.qty*providerRate),gross_profit:money(x.qty*(x.customerRate-providerRate)),sort_order:(i+1)*10};
  });
}
async function sourceRequestFromPayload(payload){
  const requestId=String(payload?.service_request_id||'').trim();if(!requestId)return null;
  const reqs=await lib.sbJson(`/rest/v1/service_requests?select=id,reference,status,job_id,city,province,postal_code,moving_bedrooms,moving_square_feet,moving_inventory&id=eq.${encodeURIComponent(requestId)}&limit=1`),r=reqs?.[0];
  if(!r)throw Object.assign(new Error('Source Service Request not found.'),{status:404});
  if(r.status!=='READY_TO_ASSIGN'||r.job_id)throw Object.assign(new Error(`${r.reference} is no longer Ready to Assign.`),{status:409});
  payload.customer_city=payload.customer_city||r.city||'';payload.customer_province=payload.customer_province||r.province||'AB';payload.customer_postal_code=payload.customer_postal_code||r.postal_code||'';
  payload.moving_bedrooms=payload.moving_bedrooms??r.moving_bedrooms??null;payload.moving_square_feet=payload.moving_square_feet??r.moving_square_feet??null;payload.moving_inventory=payload.moving_inventory??r.moving_inventory??null;
  return r;
}
exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  try{
    if(!lib.sameOrigin(event))return lib.json(403,{error:'Forbidden'});
    const auth=await lib.requireAdmin(event);let body={};try{body=JSON.parse(event.body||'{}');}catch{return lib.json(400,{error:'Invalid JSON'});}const action=String(body.action||'').trim().toUpperCase();if(!action)return lib.json(400,{error:'Action is required'});
    let sourceRequest=null;
    if(action==='CREATE_MULTI_ASSIGN'){
      const payload=body.payload||{};sourceRequest=await sourceRequestFromPayload(payload);
      if(!Array.isArray(payload.assignments)||!payload.assignments.length)return lib.json(400,{error:'Add at least one provider assignment.'});
      const seen=new Set();
      for(let i=0;i<payload.assignments.length;i++){
        const a=payload.assignments[i]||{},pid=String(a.provider_id||'').trim();if(!/^[0-9a-f-]{36}$/i.test(pid))return lib.json(400,{error:`Select Provider ${i+1}.`});if(seen.has(pid))return lib.json(400,{error:'The same Provider cannot be added twice to one Job.'});seen.add(pid);
        a.billing_items=await validateBillingItems(pid,a.billing_items,Boolean(payload.allow_nonpositive_margin));
      }
      const result=await lib.sbJson('/rest/v1/rpc/please_create_multi_provider_job',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_actor:auth.user.id,p_payload:payload})});
      const value=Array.isArray(result)?result[0]:result;
      if(sourceRequest&&value?.job_id){const linked=await lib.sbJson('/rest/v1/rpc/please_link_service_request_to_job',{method:'POST',body:JSON.stringify({p_actor:auth.user.id,p_request_id:sourceRequest.id,p_job_id:value.job_id})});value.service_request_assigned=true;value.service_request_reference=sourceRequest.reference;value.service_request=Array.isArray(linked)?linked[0]:linked;}
      return lib.json(200,value||{ok:true});
    }

    let validatedBilling=null;
    if(action==='CREATE_AND_ASSIGN'){
      sourceRequest=await sourceRequestFromPayload(body.payload||{});
      validatedBilling=await validateBillingItems(String(body.payload?.provider_id||''),body.payload?.billing_items,Boolean(body.payload?.allow_nonpositive_margin));
    }
    const result=await lib.sbJson('/rest/v1/rpc/please_portal_job_action',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_actor:auth.user.id,p_action:action,p_payload:body.payload||{}})});
    const value=Array.isArray(result)?result[0]:result;
    if(action==='CREATE_AND_ASSIGN'&&value?.job_id){
      const rows=validatedBilling.map(x=>({...x,job_id:value.job_id,assignment_id:value.assignment_id,provider_id:body.payload.provider_id}));
      await lib.sbJson('/rest/v1/job_billing_items',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(rows)});
      const subtotal=money(rows.reduce((n,x)=>n+x.customer_line_total,0));
      await lib.sbJson(`/rest/v1/jobs?id=eq.${encodeURIComponent(value.job_id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({quoted_subtotal:subtotal,moving_bedrooms:sourceRequest?.moving_bedrooms??null,moving_square_feet:sourceRequest?.moving_square_feet??null,moving_inventory:sourceRequest?.moving_inventory??null,updated_at:new Date().toISOString()})});
      if(sourceRequest){const linked=await lib.sbJson('/rest/v1/rpc/please_link_service_request_to_job',{method:'POST',body:JSON.stringify({p_actor:auth.user.id,p_request_id:sourceRequest.id,p_job_id:value.job_id})});value.service_request_assigned=true;value.service_request_reference=sourceRequest.reference;value.service_request=Array.isArray(linked)?linked[0]:linked;}
    }
    return lib.json(200,value||{ok:true});
  }catch(e){console.error('admin-job-action',e);let message=e.message||'Job action failed.';if(/exclusion|job_assignments_no_provider_overlap|conflict/i.test(message))message='One of the selected providers already has an assignment overlapping the selected time.';return lib.json(e.status||400,{error:message});}
};
