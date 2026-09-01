const lib=require('./_admin-lib');
const notify=require('./_notify-lib');
const money=n=>Math.round((Number(n)||0)*100)/100;
async function notifyAssignment(assignmentId,kind='NEW'){
  try{
    const a=await notify.assignmentContext(assignmentId);if(!a)return null;const j=a.jobs||{},p=a.providers||{};
    const cancelled=kind==='CANCELLED';
    return notify.sendProvider(a.provider_id,{subject:`PLEASE — ${cancelled?'Assignment Cancelled':'New Assignment'} (${j.reference||'Job'})`,title:cancelled?'PLEASE assignment cancelled':'New PLEASE service assignment',intro:cancelled?`Hello ${p.display_name||'Provider'}, this assignment has been cancelled by PLEASE Administration.`:`Hello ${p.display_name||'Provider'}, PLEASE has assigned a service for your confirmation.`,details:[['Job',j.reference],['Service',j.service_name],['Schedule',`${notify.formatDateTime(a.scheduled_start)} → ${notify.formatDateTime(a.scheduled_end)}`],['Address',j.work_address],['Status',a.status]],message:cancelled?'Do not proceed to the service unless PLEASE sends a new assignment.':(a.assignment_message||j.work_description||''),ctaLabel:'OPEN PROVIDER PORTAL',ctaUrl:`${notify.baseUrl()}/provider-login.html?next=assignments`,idempotencyKey:cancelled?`please-assignment-cancel-${assignmentId}`:`please-assignment-${assignmentId}`});
  }catch(e){console.error('admin-job-action:provider-notify',e);return null;}
}
async function notifyCustomerJob(jobId,kind='SCHEDULED'){
  try{
    const j=await notify.jobContext(jobId);if(!j?.customers?.email)return null;
    const c=j.customers,title=kind==='CANCELLED'?'PLEASE service update':'PLEASE is coordinating your service';
    let intro=kind==='CANCELLED'?`Hi ${c.first_name||'there'}, this PLEASE service has been cancelled or returned for service coordination.`:`Hi ${c.first_name||'there'}, PLEASE is coordinating your service team and schedule.`;
    return notify.send({to:c.email,subject:`PLEASE — ${title} (${j.reference})`,title,intro,details:[['Service Job',j.reference],['Service',j.service_name],['Status',kind==='CANCELLED'?'Cancelled':'Service coordination'],['Address',j.work_address]],message:kind==='CANCELLED'?'PLEASE Administration will contact you if a replacement schedule or service team is needed.':'Your secure tracking page shows only PLEASE professionals who have individually confirmed your service.',ctaLabel:'Track Your Request',ctaUrl:`${notify.baseUrl()}/track-request.html`,idempotencyKey:`please-job-${jobId}-${kind}`});
  }catch(e){console.error('admin-job-action:customer-notify',e);return null;}
}

function sameMoney(a,b){return Math.abs(Number(a)-Number(b))<0.005;}
function cleanRateChanges(changes){
  const map=new Map();
  for(const c of changes||[]){
    const prior=map.get(c.rate_id);
    if(prior&&!sameMoney(prior.new_value,c.new_value))throw Object.assign(new Error(`${c.rate_name}: the same Provider Rate item cannot be assigned two different values in one Job.`),{status:409});
    map.set(c.rate_id,c);
  }
  return [...map.values()];
}
async function applyProviderRateChanges(changes){
  const applied=[];
  try{
    for(const c of cleanRateChanges(changes)){
      await lib.sbJson(`/rest/v1/provider_service_rates?id=eq.${encodeURIComponent(c.rate_id)}&provider_id=eq.${encodeURIComponent(c.provider_id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({provider_compensation_method:c.method,provider_compensation:c.new_value,updated_at:new Date().toISOString()})});
      applied.push(c);
    }
    return applied;
  }catch(e){await rollbackProviderRateChanges(applied);throw Object.assign(new Error(`The Provider Rate could not be saved to the Provider profile. ${e.message||''}`.trim()),{status:e.status||409});}
}
async function rollbackProviderRateChanges(changes){
  for(const c of [...(changes||[])].reverse()){
    try{await lib.sbJson(`/rest/v1/provider_service_rates?id=eq.${encodeURIComponent(c.rate_id)}&provider_id=eq.${encodeURIComponent(c.provider_id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({provider_compensation_method:c.old_method,provider_compensation:c.old_value,updated_at:new Date().toISOString()})});}
    catch(e){console.error('admin-job-action:rate-rollback',c.rate_id,e);}
  }
}
async function recordProviderRateChanges(changes,actorId,jobReference){
  for(const c of cleanRateChanges(changes)){
    try{
      await lib.sbJson('/rest/v1/provider_technical_history',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({provider_id:c.provider_id,event_type:'ADMIN_RATE_CHANGED_DURING_ASSIGNMENT',event_label:'Provider Rate updated by PLEASE Administration',details:{rate_id:c.rate_id,rate_name:c.rate_name,billing_unit:c.billing_unit,old_method:c.old_method,old_value:c.old_value,new_method:c.method,new_value:c.new_value,job_reference:jobReference||null},actor_type:'ADMIN',actor_admin_user_id:actorId})});
    }catch(e){console.warn('admin-job-action:rate-history',e?.message||e);}
  }
}
async function notifyProviderRateChanges(changes,jobReference){
  const groups=new Map();
  for(const c of cleanRateChanges(changes)){if(!groups.has(c.provider_id))groups.set(c.provider_id,[]);groups.get(c.provider_id).push(c);}
  const sent=[];
  for(const [providerId,items] of groups){
    const lines=items.map(c=>[c.rate_name,c.method==='PERCENT'?`${Number(c.new_value).toFixed(2).replace(/\.00$/,'')}% of PLEASE customer price`:`${notify.money(c.new_value)} / ${String(c.billing_unit||'service').replace('_',' ')}`]);
    try{sent.push(await notify.sendProvider(providerId,{subject:`PLEASE — Provider Rate Updated${jobReference?` (${jobReference})`:''}`,title:'Your Provider Rate was updated',intro:'PLEASE Administration updated a Provider Rate while coordinating a service assignment.',details:[...(jobReference?[['Service Job',jobReference]]:[]),...lines],message:'This updated rate is now saved to your Provider profile for future assignments using this Rate Item. The financial snapshot on previously created Jobs is not changed.',ctaLabel:'Open Provider Portal',ctaUrl:`${notify.baseUrl()}/provider.html#rates`,idempotencyKey:`please-provider-rate-${providerId}-${jobReference||Date.now()}`}));}
    catch(e){console.warn('admin-job-action:rate-notify',e?.message||e);}
  }
  return sent;
}

async function validateBillingItems(providerId,items,allowNonpositiveMargin=false){
  if(!Array.isArray(items)||!items.length)throw Object.assign(new Error('Add at least one Customer Billing item for every provider.'),{status:400});
  const clean=items.map((x,i)=>{
    const rateId=String(x?.provider_service_rate_id||''),qty=Number(x?.quantity),customerRate=Number(x?.customer_unit_rate??x?.unit_rate);
    const overrideRaw=x?.provider_compensation_value;
    const hasOverride=overrideRaw!==undefined&&overrideRaw!==null&&String(overrideRaw).trim()!=='';
    const override=hasOverride?Number(overrideRaw):null;
    if(!/^[0-9a-f-]{36}$/i.test(rateId)||!Number.isFinite(qty)||qty<=0||!Number.isFinite(customerRate)||customerRate<0|| (hasOverride&&!Number.isFinite(override)))throw Object.assign(new Error(`Invalid Customer Billing item ${i+1}.`),{status:400});
    return{rateId,qty:money(qty),customerRate:money(customerRate),hasOverride,override:hasOverride?money(override):null,requestedMethod:String(x?.provider_compensation_method||'').trim().toUpperCase()};
  });
  const ids=[...new Set(clean.map(x=>x.rateId))],list=ids.map(x=>encodeURIComponent(x)).join(',');
  const rates=await lib.sbJson(`/rest/v1/provider_service_rates?select=id,provider_id,service_id,rate_name,description,billing_unit,customer_rate,provider_compensation_method,provider_compensation,active&id=in.(${list})&provider_id=eq.${encodeURIComponent(providerId)}&active=eq.true`);
  if((rates||[]).length!==ids.length)throw Object.assign(new Error('One or more selected rate items are no longer active for this provider.'),{status:409});
  const serviceIds=[...new Set(rates.map(r=>r.service_id))],serviceList=serviceIds.map(x=>encodeURIComponent(x)).join(',');
  const services=serviceIds.length?await lib.sbJson(`/rest/v1/services?select=id,name&id=in.(${serviceList})`):[];
  const serviceNames=new Map((services||[]).map(x=>[x.id,x.name])),map=new Map(rates.map(r=>[r.id,r])),rateChanges=[];
  const rows=clean.map((x,i)=>{
    const r=map.get(x.rateId),method=String(r.provider_compensation_method||'NONE').toUpperCase(),catalogValue=r.provider_compensation==null?null:Number(r.provider_compensation);
    if(method==='NONE'||!Number.isFinite(catalogValue))throw Object.assign(new Error(`${r.rate_name} does not have a Provider Charge configured. Set the Provider Rate in the Provider profile before assigning this Rate Item.`),{status:409});
    if(x.requestedMethod&&x.requestedMethod!==method)throw Object.assign(new Error(`${r.rate_name}: Provider compensation method changed while the Job was open. Refresh and try again.`),{status:409});
    const value=x.hasOverride?x.override:money(catalogValue);
    if(value<0||(method==='PERCENT'&&value>100))throw Object.assign(new Error(`${r.rate_name}: invalid Provider Rate.`),{status:400});
    if(x.hasOverride&&!sameMoney(value,catalogValue))rateChanges.push({rate_id:r.id,provider_id:r.provider_id,service_id:r.service_id,rate_name:r.rate_name,billing_unit:r.billing_unit,method,old_method:method,old_value:money(catalogValue),new_value:money(value)});
    const providerRate=method==='FIXED_CAD'?money(value):money(x.customerRate*value/100);
    if(x.customerRate<=providerRate&&!allowNonpositiveMargin)throw Object.assign(new Error(`${r.rate_name}: PLEASE Customer Rate (${money(x.customerRate)}) must be reviewed because it is not above the Provider Rate (${money(providerRate)}). Confirm the financial warning in Administration if this margin is intentional.`),{status:409});
    return{provider_service_rate_id:r.id,service_id:r.service_id,service_name:serviceNames.get(r.service_id)||null,description:r.rate_name,quantity:x.qty,unit:r.billing_unit,customer_unit_rate:x.customerRate,customer_line_total:money(x.qty*x.customerRate),provider_compensation_method:method,provider_compensation_value:money(value),provider_unit_rate:providerRate,provider_line_total:money(x.qty*providerRate),gross_profit:money(x.qty*(x.customerRate-providerRate)),sort_order:(i+1)*10};
  });
  return{rows,rateChanges:cleanRateChanges(rateChanges)};
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
async function linkSourceRequestSafely(authUserId,sourceRequest,jobId){
  if(!sourceRequest||!jobId)return {linked:false};
  try{
    const linked=await lib.sbJson('/rest/v1/rpc/please_link_service_request_to_job',{method:'POST',body:JSON.stringify({p_actor:authUserId,p_request_id:sourceRequest.id,p_job_id:jobId})});
    return{linked:true,request:Array.isArray(linked)?linked[0]:linked};
  }catch(primaryError){
    console.warn('admin-job-action:source-link-rpc',primaryError?.message||primaryError);
    try{
      const current=(await lib.sbJson(`/rest/v1/service_requests?select=id,reference,status,job_id&id=eq.${encodeURIComponent(sourceRequest.id)}&limit=1`))?.[0];
      if(current?.status==='ASSIGNED'&&current?.job_id===jobId)return{linked:true,request:current,recovered:true};
      const now=new Date().toISOString();
      await lib.sbJson(`/rest/v1/jobs?id=eq.${encodeURIComponent(jobId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({source_service_request_id:sourceRequest.id,updated_at:now})});
      const rows=await lib.sbJson(`/rest/v1/service_requests?id=eq.${encodeURIComponent(sourceRequest.id)}&select=*`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:'ASSIGNED',assigned_at:now,job_id:jobId,updated_at:now})});
      await lib.sbJson('/rest/v1/service_request_status_history',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({service_request_id:sourceRequest.id,old_status:sourceRequest.status||'READY_TO_ASSIGN',new_status:'ASSIGNED',note:'Converted to Job by PLEASE Administration (link recovery)',changed_by_admin_portal_user:authUserId})}).catch(()=>{});
      return{linked:true,request:rows?.[0]||current,recovered:true};
    }catch(fallbackError){
      console.error('admin-job-action:source-link-fallback',fallbackError);
      return{linked:false,warning:`Job created, but the customer request link needs review: ${fallbackError.message||primaryError.message||'link failed'}`};
    }
  }
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
      const seen=new Set(),rateChanges=[];
      for(let i=0;i<payload.assignments.length;i++){
        const a=payload.assignments[i]||{},pid=String(a.provider_id||'').trim();if(!/^[0-9a-f-]{36}$/i.test(pid))return lib.json(400,{error:`Select Provider ${i+1}.`});if(seen.has(pid))return lib.json(400,{error:'The same Provider cannot be added twice to one Job.'});seen.add(pid);
        const validated=await validateBillingItems(pid,a.billing_items,Boolean(payload.allow_nonpositive_margin));
        a.billing_items=validated.rows;rateChanges.push(...validated.rateChanges);
      }
      const appliedRates=await applyProviderRateChanges(rateChanges);
      let result;
      try{result=await lib.sbJson('/rest/v1/rpc/please_create_multi_provider_job',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_actor:auth.user.id,p_payload:payload})});}
      catch(createError){await rollbackProviderRateChanges(appliedRates);throw createError;}
      const value=Array.isArray(result)?result[0]:result;
      if(sourceRequest&&value?.job_id){const link=await linkSourceRequestSafely(auth.user.id,sourceRequest,value.job_id);value.service_request_assigned=link.linked;value.service_request_reference=sourceRequest.reference;value.service_request=link.request||null;if(link.warning)value.warning=link.warning;}
      if(value?.job_id&&appliedRates.length){await recordProviderRateChanges(appliedRates,auth.user.id,value.job_reference);value.provider_rates_updated=appliedRates.length;}
      const assignmentIds=value?.assignment_ids||[];const notices=[];for(const aid of assignmentIds)notices.push(await notifyAssignment(aid,'NEW'));if(value?.job_id)notices.push(await notifyCustomerJob(value.job_id,'SCHEDULED'));if(appliedRates.length)notices.push(...await notifyProviderRateChanges(appliedRates,value?.job_reference));value.notifications_sent=notices.filter(x=>x?.sent).length;
      return lib.json(200,value||{ok:true});
    }

    let validatedBilling=null,legacyRateChanges=[],legacyAppliedRates=[];
    if(action==='CREATE_AND_ASSIGN'){
      sourceRequest=await sourceRequestFromPayload(body.payload||{});
      const validated=await validateBillingItems(String(body.payload?.provider_id||''),body.payload?.billing_items,Boolean(body.payload?.allow_nonpositive_margin));validatedBilling=validated.rows;legacyRateChanges=validated.rateChanges;legacyAppliedRates=await applyProviderRateChanges(legacyRateChanges);
    }
    let result;try{result=await lib.sbJson('/rest/v1/rpc/please_portal_job_action',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_actor:auth.user.id,p_action:action,p_payload:body.payload||{}})});}catch(actionError){if(legacyAppliedRates.length)await rollbackProviderRateChanges(legacyAppliedRates);throw actionError;}
    const value=Array.isArray(result)?result[0]:result;
    if(action==='CREATE_AND_ASSIGN'&&value?.job_id){
      const rows=validatedBilling.map(x=>({...x,job_id:value.job_id,assignment_id:value.assignment_id,provider_id:body.payload.provider_id}));
      await lib.sbJson('/rest/v1/job_billing_items',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(rows)});
      const subtotal=money(rows.reduce((n,x)=>n+x.customer_line_total,0));
      await lib.sbJson(`/rest/v1/jobs?id=eq.${encodeURIComponent(value.job_id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({quoted_subtotal:subtotal,moving_bedrooms:sourceRequest?.moving_bedrooms??null,moving_square_feet:sourceRequest?.moving_square_feet??null,moving_inventory:sourceRequest?.moving_inventory??null,updated_at:new Date().toISOString()})});
      if(sourceRequest){const link=await linkSourceRequestSafely(auth.user.id,sourceRequest,value.job_id);value.service_request_assigned=link.linked;value.service_request_reference=sourceRequest.reference;value.service_request=link.request||null;if(link.warning)value.warning=link.warning;}
      if(legacyAppliedRates.length){await recordProviderRateChanges(legacyAppliedRates,auth.user.id,value.job_reference);value.provider_rates_updated=legacyAppliedRates.length;}
    }
    const notices=[];
    if(value?.assignment_id){if(action==='CANCEL_ASSIGNMENT')notices.push(await notifyAssignment(value.assignment_id,'CANCELLED'));else notices.push(await notifyAssignment(value.assignment_id,'NEW'));}
    if(value?.job_id){if(action==='CANCEL_ASSIGNMENT'||action==='CANCEL_JOB')notices.push(await notifyCustomerJob(value.job_id,'CANCELLED'));else if(['CREATE_AND_ASSIGN','ASSIGN_EXISTING'].includes(action))notices.push(await notifyCustomerJob(value.job_id,'SCHEDULED'));}
    if(action==='CANCEL_JOB'&&value?.job_id){try{const as=await lib.sbJson(`/rest/v1/job_assignments?select=id&job_id=eq.${encodeURIComponent(value.job_id)}&status=eq.CANCELLED`);for(const a of as||[])notices.push(await notifyAssignment(a.id,'CANCELLED'));}catch(_){} }
    if(legacyAppliedRates.length)notices.push(...await notifyProviderRateChanges(legacyAppliedRates,value?.job_reference));
    if(value&&typeof value==='object')value.notifications_sent=notices.filter(x=>x?.sent).length;
    return lib.json(200,value||{ok:true});
  }catch(e){console.error('admin-job-action',e);let message=e.message||'Job action failed.';if(/exclusion|job_assignments_no_provider_overlap|conflict/i.test(message))message='One of the selected providers already has an assignment overlapping the selected time.';return lib.json(e.status||400,{error:message});}
};
