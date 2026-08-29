const crypto=require('crypto');
const lib=require('./_admin-lib');
const notify=require('./_notify-lib');
const hash=v=>crypto.createHash('sha256').update(String(v||'')).digest('hex');
async function requestFromToken(token){
  const h=hash(token);
  try{const l=await lib.sbJson(`/rest/v1/service_request_tracking_tokens?select=service_request_id&token_hash=eq.${encodeURIComponent(h)}&revoked_at=is.null&limit=1`);if(l?.[0]?.service_request_id){const r=await lib.sbJson(`/rest/v1/service_requests?select=id,job_id,reference,first_name,email&id=eq.${encodeURIComponent(l[0].service_request_id)}&limit=1`);if(r?.[0])return r[0];}}catch(_){}
  const r=await lib.sbJson(`/rest/v1/service_requests?select=id,job_id,reference,first_name,email&tracking_token_hash=eq.${encodeURIComponent(h)}&limit=1`);return r?.[0]||null;
}
exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  try{
    const b=JSON.parse(event.body||'{}'),token=String(b.token||''),id=String(b.request_id||''),action=String(b.action||'').toUpperCase();
    if(!/^[a-f0-9]{48}$/i.test(token))return lib.json(400,{error:'Invalid tracking link'});
    const req=await requestFromToken(token);if(!req?.job_id)return lib.json(404,{error:'Request not found'});
    const rows=await lib.sbJson(`/rest/v1/job_extension_requests?select=id,job_id,assignment_id,provider_id,status,extra_minutes,reason,customer_addition,provider_addition,proposed_end&id=eq.${encodeURIComponent(id)}&limit=1`),x=rows?.[0];
    if(!x||x.job_id!==req.job_id||x.status!=='PENDING')return lib.json(409,{error:'Extension request is no longer pending.'});
    const j=await notify.jobContext(req.job_id).catch(()=>null),details=[['Request',req.reference],['Job',j?.reference],['Service',j?.service_name],['Additional time',`${x.extra_minutes||0} minutes`],['Proposed end',notify.formatDateTime(x.proposed_end)],['Customer addition',notify.money(x.customer_addition)]];
    const notices=[];
    if(action==='APPROVE'){
      await lib.sbJson(`/rest/v1/job_extension_requests?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({customer_approval_method:'TRACKING'})});
      notices.push(await notify.sendAdmins({subject:`PLEASE — Customer Approved Extension (${j?.reference||req.reference})`,title:'Customer approved additional service time',intro:'The customer approved the pending extension from secure tracking. PLEASE Administration must now finalize the schedule and billing.',details,message:x.reason||'',ctaLabel:'Review Live Operations',ctaUrl:`${notify.baseUrl()}/admin-live-operations.html`,idempotencyKey:`please-admin-extension-customer-approved-${id}`,replyToOverride:req.email}));
      notices.push(await notify.sendProvider(x.provider_id,{subject:`PLEASE — Customer Approved Extension (${j?.reference||'Job'})`,title:'Customer approved requested additional time',intro:'The customer approved your extension request. PLEASE Administration must still finalize the schedule and billing before the extra time is official.',details,message:x.reason||'',ctaLabel:'Open Provider Portal',ctaUrl:`${notify.baseUrl()}/provider.html#assignments`,idempotencyKey:`please-provider-extension-customer-approved-${id}`}));
      notices.push(await notify.send({to:req.email,subject:`PLEASE — Extension Approval Received (${j?.reference||req.reference})`,title:'Your approval was recorded',intro:`Hi ${req.first_name||'there'}, PLEASE received your approval for the requested additional service time. Administration will finalize the schedule and billing.`,details,ctaLabel:'Track Your Request',ctaUrl:`${notify.baseUrl()}/track-request.html?token=${encodeURIComponent(token)}`,idempotencyKey:`please-customer-extension-approved-ack-${id}`}));
      return lib.json(200,{ok:true,notifications_sent:notices.filter(n=>n?.sent).length});
    }
    if(action==='REJECT'){
      await lib.sbJson(`/rest/v1/job_extension_requests?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'REJECTED',customer_approval_method:'TRACKING_REJECTED',reviewed_at:new Date().toISOString()})});
      await lib.sbJson('/rest/v1/job_service_events',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({job_id:req.job_id,event_type:'EXTENSION_REJECTED',event_note:'Customer declined additional time from tracking.'})});
      notices.push(await notify.sendAdmins({subject:`PLEASE — Customer Declined Extension (${j?.reference||req.reference})`,title:'Customer declined additional service time',intro:'The customer declined the pending extension from secure tracking.',details,message:x.reason||'',ctaLabel:'Open Live Operations',ctaUrl:`${notify.baseUrl()}/admin-live-operations.html`,idempotencyKey:`please-admin-extension-customer-rejected-${id}`,replyToOverride:req.email}));
      notices.push(await notify.sendProvider(x.provider_id,{subject:`PLEASE — Extension Declined (${j?.reference||'Job'})`,title:'Additional service time was declined',intro:'The customer declined your extension request. Continue only within the currently approved scope and schedule unless PLEASE Administration instructs otherwise.',details,message:x.reason||'',ctaLabel:'Open Provider Portal',ctaUrl:`${notify.baseUrl()}/provider.html#assignments`,idempotencyKey:`please-provider-extension-customer-rejected-${id}`}));
      notices.push(await notify.send({to:req.email,subject:`PLEASE — Extension Declined (${j?.reference||req.reference})`,title:'Your response was recorded',intro:`Hi ${req.first_name||'there'}, PLEASE recorded that you declined the additional service time request.`,details,ctaLabel:'Track Your Request',ctaUrl:`${notify.baseUrl()}/track-request.html?token=${encodeURIComponent(token)}`,idempotencyKey:`please-customer-extension-rejected-ack-${id}`}));
      return lib.json(200,{ok:true,notifications_sent:notices.filter(n=>n?.sent).length});
    }
    return lib.json(400,{error:'Invalid action'});
  }catch(e){console.error('public-extension-response',e);return lib.json(e.status||400,{error:e.message||'Unable to record extension response.'});}
};
