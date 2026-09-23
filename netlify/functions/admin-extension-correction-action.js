const lib=require('./_admin-lib');
const notify=require('./_notify-lib');

exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
  try{
    const auth=await lib.requireAdmin(event),body=JSON.parse(event.body||'{}');
    const requestId=String(body.request_id||'').trim();
    const hoursRaw=body.hours,minutesRaw=body.minutes;
    if(hoursRaw==null||minutesRaw==null||String(hoursRaw).trim()===''||String(minutesRaw).trim()==='')
      return lib.json(400,{error:'Enter both corrected hours and minutes.'});
    const hours=Number(hoursRaw),minutes=Number(minutesRaw);
    if(!requestId)return lib.json(400,{error:'Extension request is required.'});
    if(!Number.isInteger(hours)||!Number.isInteger(minutes)||hours<0||minutes<0||minutes>=60)
      return lib.json(400,{error:'Enter corrected time as whole hours and minutes.'});
    const total=hours*60+minutes;
    if(total<15||total>480||total%15!==0)
      return lib.json(400,{error:'Corrected time must use exact 15-minute increments.'});
    const reason=String(body.reason||'').trim();
    if(!reason)return lib.json(400,{error:'Correction reason is required.'});

    const before=await notify.extensionContext(requestId);
    if(!before)return lib.json(404,{error:'Extension request not found.'});
    const result=await lib.sbJson('/rest/v1/rpc/admin_correct_approved_extension',{method:'POST',body:JSON.stringify({
      p_actor:auth.user.id,p_request_id:requestId,p_corrected_minutes:total,p_note:reason
    })});
    const d=Array.isArray(result)?result[0]:result;
    const assignment=await notify.assignmentContext(before.assignment_id).catch(()=>null);
    const job=assignment?.jobs||await notify.jobContext(before.job_id).catch(()=>null)||{};
    const provider=assignment?.providers?.display_name||'Provider';
    const details=[['Job',job.reference],['Service',job.service_name],['Provider',provider],
      ['Previous extension',`${Number(before.extra_minutes||0)} minutes`],['Corrected extension',`${total} minutes`],
      ['Corrected customer addition',notify.money(d?.customer_addition)],['Corrected Provider addition',notify.money(d?.provider_addition)]];
    const notices=[];
    notices.push(await notify.sendAdmins({subject:`PLEASE — Extension corrected (${job.reference||'Job'})`,title:'Approved extension corrected',
      intro:'Administration corrected an approved service extension before financial close.',details,message:reason,
      ctaLabel:'Open Live Operations',ctaUrl:`${notify.baseUrl()}/admin-live-operations.html`,idempotencyKey:`please-admin-extension-correction-${requestId}-${total}`}));
    notices.push(await notify.sendProvider(before.provider_id,{subject:`PLEASE — Service extension corrected (${job.reference||'Job'})`,
      title:'Service extension corrected',intro:'PLEASE Administration corrected the approved additional service time.',details,message:reason,
      ctaLabel:'Open Provider Portal',ctaUrl:`${notify.baseUrl()}/provider.html#history`,idempotencyKey:`please-provider-extension-correction-${requestId}-${total}`}));
    return lib.json(200,{ok:true,result:d,notifications_sent:notices.filter(x=>x?.sent).length});
  }catch(e){console.error('admin-extension-correction-action',e);return lib.json(e.status||400,{error:e.message||'Unable to correct extension.'});}
};