const lib=require('./_provider-lib');
const notify=require('./_notify-lib');

async function confirmedTeam(jobId){
  if(!jobId)return null;
  const rows=await lib.sbJson(`/rest/v1/job_assignments?select=id,job_id,status,is_primary,sequence_no,scheduled_start,scheduled_end,providers(display_name)&job_id=eq.${encodeURIComponent(jobId)}&status=in.(PENDING,CONFIRMED)&order=sequence_no.asc,assigned_at.asc`).catch(()=>[]);
  if(!rows?.length||rows.some(x=>x.status!=='CONFIRMED'))return null;
  return rows;
}
function confirmationSchedule(team,fallbackStart,fallbackEnd){
  const starts=(team||[]).map(x=>new Date(x.scheduled_start).getTime()).filter(Number.isFinite);
  const ends=(team||[]).map(x=>new Date(x.scheduled_end).getTime()).filter(Number.isFinite);
  const start=starts.length?new Date(Math.min(...starts)).toISOString():fallbackStart;
  const end=ends.length?new Date(Math.max(...ends)).toISOString():fallbackEnd;
  return `${notify.formatDateTime(start)} → ${notify.formatDateTime(end)}`;
}

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
    // STEP 19.2: a Provider confirmation is still an internal operational event until
    // every active Provider assignment required for the Job is CONFIRMED. At that point
    // the customer receives one Service Confirmed email for the whole Job, not one email
    // per Provider. Resend idempotency is keyed to the Job so later retries cannot duplicate it.
    if(accepted&&j?.customers?.email){
      const jobId=after?.job_id||before?.job_id||j.id;
      const team=await confirmedTeam(jobId);
      if(team){
        const names=team.map(x=>x.providers?.display_name).filter(Boolean);
        const teamLabel=names.length?names.join(', '):(team.length>1?'PLEASE service team':'PLEASE professional');
        customerNotice=await notify.send({
          to:j.customers.email,
          subject:`PLEASE — Your service is confirmed (${j.reference})`,
          title:'Your PLEASE service is confirmed',
          intro:`Hi ${j.customers.first_name||'there'}, your service, schedule and PLEASE professional${team.length>1?'s are':' is'} confirmed.`,
          details:[['Service Job',j.reference],['Service',j.service_name],['Schedule',confirmationSchedule(team,after?.scheduled_start||before?.scheduled_start,after?.scheduled_end||before?.scheduled_end)],['Professional'+(team.length>1?'s':''),teamLabel],['Status','CONFIRMED']],
          message:'You can use Track Your Request at any time to view the current service details.',
          ctaLabel:'Track Your Request',
          ctaUrl:`${notify.baseUrl()}/track-request.html`,
          idempotencyKey:`please-customer-service-confirmed-${jobId}`
        });
      }
    }
    return lib.json(200,{...(d||{ok:true}),customer_service_confirmed:!!customerNotice?.sent,notifications_sent:[adminNotice,customerNotice].filter(x=>x?.sent).length});
  }catch(e){console.error('provider-assignment-action',e);return lib.json(e.status||400,{error:e.message||'Assignment could not be updated.'});}
};
