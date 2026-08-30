const lib=require('./_provider-lib');
const notify=require('./_notify-lib');

exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
  try{
    const a=await lib.requireProvider(event),b=JSON.parse(event.body||'{}'),assignmentId=String(b.assignment_id||''),action=String(b.action||'').toUpperCase(),note=String(b.note||'').slice(0,1000);
    const before=await notify.assignmentContext(assignmentId).catch(()=>null);
    const d=await lib.sbJson('/rest/v1/rpc/provider_portal_assignment_action',{method:'POST',body:JSON.stringify({p_actor:a.user.id,p_assignment_id:assignmentId,p_action:action,p_note:note})});
    const after=await notify.assignmentContext(assignmentId).catch(()=>before),j=after?.jobs||before?.jobs||{},p=after?.providers||before?.providers||{};
    const accepted=action==='CONFIRM';
    const adminNotice=await notify.sendAdmins({subject:`PLEASE — Provider ${accepted?'Confirmed':'Declined'} (${j.reference||'Job'})`,title:`Provider ${accepted?'confirmed':'declined'} assignment`,intro:`${p.display_name||a.provider.display_name||'Provider'} ${accepted?'confirmed':'declined'} the PLEASE assignment.`,details:[['Job',j.reference],['Service',j.service_name],['Provider',p.display_name||a.provider.display_name],['Schedule',`${notify.formatDateTime(after?.scheduled_start||before?.scheduled_start)} → ${notify.formatDateTime(after?.scheduled_end||before?.scheduled_end)}`],['Status',after?.status||'']],message:note,ctaLabel:'Open Administration',ctaUrl:`${notify.baseUrl()}/admin-calendar.html`,idempotencyKey:`please-admin-assignment-response-${assignmentId}-${action}`,replyToOverride:a.user.email});
    let customerNotice=null;
    // A decline is an internal coordination event. Do not reveal a pending/declined
    // Pleaser to the customer. A customer notification is sent only after confirmation.
    if(accepted&&j?.customers?.email){
      customerNotice=await notify.send({to:j.customers.email,subject:`PLEASE — Service Team Update (${j.reference})`,title:'A PLEASE professional confirmed your service',intro:`Hi ${j.customers.first_name||'there'}, a PLEASE professional has confirmed this service assignment and is now available in your secure tracking page.`,details:[['Service Job',j.reference],['Service',j.service_name],['Schedule',`${notify.formatDateTime(after?.scheduled_start||before?.scheduled_start)} → ${notify.formatDateTime(after?.scheduled_end||before?.scheduled_end)}`],['Status','Confirmed professional added']],message:'PLEASE tracking displays only professionals who have confirmed their assignment.',ctaLabel:'Track Your Request',ctaUrl:`${notify.baseUrl()}/track-request.html`,idempotencyKey:`please-customer-assignment-response-${assignmentId}-${action}`});
    }
    return lib.json(200,{...(d||{ok:true}),notifications_sent:[adminNotice,customerNotice].filter(x=>x?.sent).length});
  }catch(e){console.error('provider-assignment-action',e);return lib.json(e.status||400,{error:e.message||'Assignment could not be updated.'});}
};
