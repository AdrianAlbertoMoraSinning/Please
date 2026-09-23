const lib=require('./_admin-lib');
const notify=require('./_notify-lib');

exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
  try{
    const a=await lib.requireAdmin(event),b=JSON.parse(event.body||'{}');
    const action=String(b.action||'').toUpperCase();
    if(!['APPROVE','REJECT'].includes(action))return lib.json(400,{error:'Invalid extension action.'});

    // STEP 19.6: capture the extension before review so notifications keep the
    // original provider/job context after the RPC changes its status.
    const before=await notify.extensionContext(b.request_id);
    if(!before)return lib.json(404,{error:'Extension request not found.'});

    const d=await lib.sbJson('/rest/v1/rpc/admin_review_extension',{method:'POST',body:JSON.stringify({
      p_actor:a.user.id,p_request_id:b.request_id,p_action:action,p_note:b.note||null,
      p_customer_approval_method:b.customer_approval_method||null
    })});

    const assignment=await notify.assignmentContext(before.assignment_id).catch(()=>null);
    const j=assignment?.jobs||await notify.jobContext(before.job_id).catch(()=>null)||{};
    const providerName=assignment?.providers?.display_name||'Provider';
    const approved=action==='APPROVE';
    const status=approved?'Approved':'Rejected';
    const details=[
      ['Job',j.reference],['Service',j.service_name],['Provider',providerName],
      ['Additional time',`${Number(before.extra_minutes||0)} minutes`],
      ...(approved?[['New scheduled end',notify.formatDateTime(before.proposed_end)],['Customer addition',notify.money(before.customer_addition)],['Provider addition',notify.money(before.provider_addition)]]:[])
    ];
    const message=String(b.note||'').trim()||(approved?'The requested additional service time has been approved by PLEASE Administration.':'The requested additional service time was not approved.');

    const notices=[];
    notices.push(await notify.sendAdmins({
      subject:`PLEASE — Extension ${status} (${j.reference||'Job'})`,
      title:`Service extension ${status.toLowerCase()}`,
      intro:`${providerName}'s request for ${Number(before.extra_minutes||0)} additional minutes was ${status.toLowerCase()}.`,
      details,message,ctaLabel:'Open Live Operations',ctaUrl:`${notify.baseUrl()}/admin-live-operations.html`,
      idempotencyKey:`please-admin-extension-${before.id}-${action}`
    }));
    notices.push(await notify.sendProvider(before.provider_id,{
      subject:`PLEASE — Extension ${status} (${j.reference||'Job'})`,
      title:`Additional service time ${status.toLowerCase()}`,
      intro:approved?'PLEASE Administration approved your additional service time.':'PLEASE Administration did not approve the requested additional service time.',
      details,message,ctaLabel:'Open Provider Portal',ctaUrl:`${notify.baseUrl()}/provider.html#assignments`,
      idempotencyKey:`please-provider-extension-${before.id}-${action}`
    }));
    // Customer email is intentionally limited to the final decision, not routine
    // ARRIVE/START/COMPLETE operational events.
    if(j?.customers?.email)notices.push(await notify.send({
      to:j.customers.email,
      subject:`PLEASE — Service Time ${status} (${j.reference||'Service'})`,
      title:approved?'Your service time was extended':'Service time update',
      intro:approved?`Hi ${j.customers.first_name||'there'}, PLEASE approved ${Number(before.extra_minutes||0)} additional minutes for your service.`:`Hi ${j.customers.first_name||'there'}, the requested additional service time was not approved.`,
      details:details.filter(x=>!['Provider','Provider addition'].includes(x[0])),
      message:approved?'Your service schedule and approved billing have been updated.':'Your existing service schedule remains unchanged.',
      ctaLabel:'Track Your Request',ctaUrl:`${notify.baseUrl()}/track-request.html`,
      idempotencyKey:`please-customer-extension-${before.id}-${action}`
    }));

    return lib.json(200,{...(d||{ok:true}),notifications_sent:notices.filter(x=>x?.sent).length});
  }catch(e){
    console.error('admin-extension-action',e);
    return lib.json(e.status||400,{error:e.message||'Extension action failed.'});
  }
};
