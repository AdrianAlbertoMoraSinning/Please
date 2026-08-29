const lib=require('./_admin-lib');
const notify=require('./_notify-lib');
exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
  try{
    const a=await lib.requireAdmin(event),b=JSON.parse(event.body||'{}'),id=String(b.request_id||''),action=String(b.action||'').toUpperCase();
    const before=await notify.extensionContext(id).catch(()=>null);
    const d=await lib.sbJson('/rest/v1/rpc/admin_review_extension',{method:'POST',body:JSON.stringify({p_actor:a.user.id,p_request_id:id,p_action:action,p_note:b.note||null,p_customer_approval_method:b.customer_approval_method||null})});
    const x=(await notify.extensionContext(id).catch(()=>null))||before,j=await notify.jobContext(x?.job_id).catch(()=>null),approved=action==='APPROVE',notices=[];
    if(x){
      const details=[['Job',j?.reference],['Service',j?.service_name],['Additional time',`${x.extra_minutes||0} minutes`],['New end',notify.formatDateTime(x.proposed_end)],['Customer addition',notify.money(x.customer_addition)],['Provider addition',notify.money(x.provider_addition)],['Status',x.status]];
      notices.push(await notify.sendProvider(x.provider_id,{subject:`PLEASE — Extension ${approved?'Approved':'Rejected'} (${j?.reference||'Job'})`,title:`Additional service time ${approved?'approved':'rejected'}`,intro:approved?'PLEASE Administration finalized the requested additional time. Your assignment schedule and compensation snapshot were updated.':'PLEASE Administration rejected the requested additional time. Do not extend the service beyond the currently approved scope.',details,message:b.note||'',ctaLabel:'Open Provider Portal',ctaUrl:`${notify.baseUrl()}/provider.html#assignments`,idempotencyKey:`please-provider-extension-admin-${id}-${action}`}));
      if(j?.customers?.email)notices.push(await notify.send({to:j.customers.email,subject:`PLEASE — Extension ${approved?'Approved':'Not Approved'} (${j.reference})`,title:approved?'Additional service time approved':'Additional service time not approved',intro:approved?`Hi ${j.customers.first_name||'there'}, PLEASE finalized the additional service time you approved. The service schedule and billing have been updated.`:`Hi ${j.customers.first_name||'there'}, the additional service time request was not approved. Your existing service scope and schedule remain in effect.`,details:details.filter(r=>r[0]!=='Provider addition'),message:b.note||'',ctaLabel:'Track Your Request',ctaUrl:`${notify.baseUrl()}/track-request.html`,idempotencyKey:`please-customer-extension-admin-${id}-${action}`}));
    }
    return lib.json(200,{...(d||{ok:true}),notifications_sent:notices.filter(n=>n?.sent).length});
  }catch(e){console.error('admin-extension-action',e);return lib.json(e.status||400,{error:e.message||'Extension action failed.'});}
};
