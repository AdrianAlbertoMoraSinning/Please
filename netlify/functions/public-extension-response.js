const crypto=require('crypto');
const lib=require('./_admin-lib');
const notify=require('./_notify-lib');
const hash=v=>crypto.createHash('sha256').update(String(v||'')).digest('hex');

async function requestFromToken(token){
  const h=hash(token);
  try{
    const l=await lib.sbJson(`/rest/v1/service_request_tracking_tokens?select=service_request_id&token_hash=eq.${encodeURIComponent(h)}&revoked_at=is.null&limit=1`);
    if(l?.[0]?.service_request_id){
      const r=await lib.sbJson(`/rest/v1/service_requests?select=id,job_id&id=eq.${encodeURIComponent(l[0].service_request_id)}&limit=1`);
      if(r?.[0])return r[0];
    }
  }catch(_){}
  const r=await lib.sbJson(`/rest/v1/service_requests?select=id,job_id&tracking_token_hash=eq.${encodeURIComponent(h)}&limit=1`);
  return r?.[0]||null;
}

async function notifyDecision(x,action){
  try{
    const assignment=await notify.assignmentContext(x.assignment_id).catch(()=>null);
    const job=assignment?.jobs||await notify.jobContext(x.job_id).catch(()=>null)||{};
    const provider=assignment?.providers?.display_name||'Provider';
    const details=[['Job',job.reference],['Service',job.service_name],['Provider',provider],['Requested extension',`${Number(x.extra_minutes||0)} minutes`]];
    if(action==='APPROVE'){
      await notify.sendAdmins({subject:`PLEASE — Customer approved extension (${job.reference||'Job'})`,title:'Customer approval received',
        intro:'The customer approved the requested additional service time from PLEASE tracking. Administration must still finalize the extension.',details,
        ctaLabel:'Open Live Operations',ctaUrl:`${notify.baseUrl()}/admin-live-operations.html`,idempotencyKey:`please-admin-customer-extension-approved-${x.id}`});
    }else{
      await Promise.all([
        notify.sendAdmins({subject:`PLEASE — Customer declined extension (${job.reference||'Job'})`,title:'Customer declined additional time',
          intro:'The customer declined the requested service extension from PLEASE tracking.',details,
          ctaLabel:'Open Live Operations',ctaUrl:`${notify.baseUrl()}/admin-live-operations.html`,idempotencyKey:`please-admin-customer-extension-rejected-${x.id}`}),
        notify.sendProvider(x.provider_id,{subject:`PLEASE — Customer declined extension (${job.reference||'Job'})`,title:'Additional time declined',
          intro:'The customer declined the requested additional service time.',details,
          ctaLabel:'Open Provider Portal',ctaUrl:`${notify.baseUrl()}/provider.html`,idempotencyKey:`please-provider-customer-extension-rejected-${x.id}`})
      ]);
    }
  }catch(e){console.warn('public-extension-response:notification',e?.message||e);}
}

exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  try{
    const b=JSON.parse(event.body||'{}'),token=String(b.token||''),id=String(b.request_id||''),action=String(b.action||'').toUpperCase();
    if(!/^[a-f0-9]{48}$/i.test(token))return lib.json(400,{error:'Invalid tracking link'});
    const req=await requestFromToken(token);
    if(!req?.job_id)return lib.json(404,{error:'Request not found'});
    const rows=await lib.sbJson(`/rest/v1/job_extension_requests?select=id,job_id,assignment_id,provider_id,status,extra_minutes&id=eq.${encodeURIComponent(id)}&limit=1`);
    const x=rows?.[0];
    if(!x||x.job_id!==req.job_id||x.status!=='PENDING')return lib.json(409,{error:'Extension request is no longer pending.'});
    if(action==='APPROVE'){
      const changed=await lib.sbJson(`/rest/v1/job_extension_requests?id=eq.${encodeURIComponent(id)}&status=eq.PENDING&select=id`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({customer_approval_method:'TRACKING'})});
      if(!changed?.[0])return lib.json(409,{error:'Extension request changed in another session. Refresh tracking and try again.'});
      await notifyDecision(x,'APPROVE');
      return lib.json(200,{ok:true});
    }
    if(action==='REJECT'){
      const changed=await lib.sbJson(`/rest/v1/job_extension_requests?id=eq.${encodeURIComponent(id)}&status=eq.PENDING&select=id`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:'REJECTED',customer_approval_method:'TRACKING_REJECTED',reviewed_at:new Date().toISOString()})});
      if(!changed?.[0])return lib.json(409,{error:'Extension request changed in another session. Refresh tracking and try again.'});
      await lib.sbJson('/rest/v1/job_service_events',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({job_id:req.job_id,assignment_id:x.assignment_id,provider_id:x.provider_id,event_type:'EXTENSION_REJECTED',event_note:'Customer declined additional time from tracking.'})});
      await notifyDecision(x,'REJECT');
      return lib.json(200,{ok:true});
    }
    return lib.json(400,{error:'Invalid action'});
  }catch(e){console.error('public-extension-response',e);return lib.json(e.status||400,{error:e.message||'Unable to record extension response.'});}
};
