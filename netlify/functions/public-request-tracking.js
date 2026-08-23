const crypto=require('crypto');
const lib=require('./_admin-lib');

function hash(v){return crypto.createHash('sha256').update(String(v||'')).digest('hex');}
function iso(v){return v||null;}
function safePublicUrl(v){try{const u=new URL(String(v||''));return ['http:','https:'].includes(u.protocol)?u.href:null}catch{return null;}}
async function signed(path,expires=1800){if(!path)return null;try{const enc=String(path).split('/').map(encodeURIComponent).join('/');const d=await lib.sbJson(`/storage/v1/object/sign/provider-applications/${enc}`,{method:'POST',body:JSON.stringify({expiresIn:expires})});const u=d?.signedURL||d?.signedUrl;return u?`${process.env.PLEASE_SUPABASE_URL.replace(/\/$/,'')}/storage/v1${u}`:null;}catch{return null;}}
function publicRequestStatus(status){
  return ({
    NEW:['REQUEST_RECEIVED','Request received'],
    REVIEWING:['UNDER_REVIEW','Under review'],
    READY_TO_ASSIGN:['SCHEDULING','Scheduling service'],
    ASSIGNED:['ASSIGNED','Provider assignment in progress'],
    CANCELLED:['CANCELLED','Request cancelled']
  })[status]||['REQUEST_RECEIVED','Request received'];
}
function publicJobStatus(status){
  return ({
    PENDING_PROVIDER:['PROVIDER_CONFIRMATION','Awaiting provider confirmation'],
    NEEDS_ASSIGNMENT:['SCHEDULING','Scheduling service'],
    CONFIRMED:['SERVICE_CONFIRMED','Service confirmed'],
    SCHEDULED:['SERVICE_CONFIRMED','Service confirmed'],
    IN_PROGRESS:['IN_PROGRESS','Service in progress'],
    COMPLETED:['SERVICE_COMPLETED','Service completed'],
    CANCELLED:['CANCELLED','Service cancelled']
  })[status]||null;
}

async function requestFromToken(token){
  const tokenHash=hash(token);
  // STEP 10.4.3 supports multiple valid links per request. Fall back to the
  // original service_requests.tracking_token_hash for backwards compatibility.
  try{
    const links=await lib.sbJson(`/rest/v1/service_request_tracking_tokens?select=service_request_id&token_hash=eq.${encodeURIComponent(tokenHash)}&revoked_at=is.null&or=(expires_at.is.null,expires_at.gt.${encodeURIComponent(new Date().toISOString())})&limit=1`);
    if(links?.[0]?.service_request_id){
      const rows=await lib.sbJson(`/rest/v1/service_requests?select=id,reference,first_name,service_id,service_name,street_address,city,province,postal_code,moving_bedrooms,moving_square_feet,moving_inventory,preferred_date,preferred_start_time,scheduling_flexibility,status,job_id,created_at,reviewed_at,ready_to_assign_at,assigned_at,cancelled_at,cancellation_reason&id=eq.${encodeURIComponent(links[0].service_request_id)}&limit=1`);
      if(rows?.[0]) return rows[0];
    }
  }catch(e){console.error('public-request-tracking:token-table',e);}
  const rows=await lib.sbJson(`/rest/v1/service_requests?select=id,reference,first_name,service_id,service_name,street_address,city,province,postal_code,moving_bedrooms,moving_square_feet,moving_inventory,preferred_date,preferred_start_time,scheduling_flexibility,status,job_id,created_at,reviewed_at,ready_to_assign_at,assigned_at,cancelled_at,cancellation_reason&tracking_token_hash=eq.${encodeURIComponent(tokenHash)}&limit=1`);
  return rows?.[0]||null;
}

exports.handler=async event=>{
  if(event.httpMethod!=='GET') return lib.json(405,{error:'Method not allowed'});
  try{
    const token=String(event.queryStringParameters?.token||'').trim();
    if(!/^[a-f0-9]{48}$/i.test(token)) return lib.json(400,{error:'Invalid tracking link.'});
    const req=await requestFromToken(token);
    if(!req) return lib.json(404,{error:'Tracking link not found.'});

    let job=null, assignment=null, provider=null, team=[], scheduleChange=null, invoice=null, serviceEvents=[], extensionRequest=null,evidence=[];
    if(req.job_id){
      const jobs=await lib.sbJson(`/rest/v1/jobs?select=id,reference,service_name,status,work_address,estimated_duration_minutes,actual_arrived_at,actual_started_at,actual_completed_at,approved_extension_minutes,created_at,updated_at,completed_at,cancelled_at&id=eq.${encodeURIComponent(req.job_id)}&limit=1`);
      job=jobs?.[0]||null;
      if(job){
        const assignments=await lib.sbJson(`/rest/v1/job_assignments?select=id,provider_id,sequence_no,is_primary,scheduled_start,scheduled_end,status,assigned_at,responded_at,updated_at&job_id=eq.${encodeURIComponent(job.id)}&status=in.(PENDING,CONFIRMED,COMPLETED,CANCELLED,DECLINED)&order=sequence_no.asc,assigned_at.asc`);
        const providerIds=[...new Set((assignments||[]).map(a=>a.provider_id).filter(Boolean))];
        let providerRows=[];if(providerIds.length){providerRows=await lib.sbJson(`/rest/v1/providers?select=id,display_name,public_title,status,profile_image_path,profile_image_url&id=in.(${providerIds.map(encodeURIComponent).join(',')})`);}const pmap=new Map((providerRows||[]).map(x=>[x.id,x]));
        team=[];for(const a of assignments||[]){const pr=pmap.get(a.provider_id)||null;if(pr)pr.profile_photo_url=pr.profile_image_path?await signed(pr.profile_image_path):safePublicUrl(pr.profile_image_url);team.push({...a,provider_name:pr?.display_name||null,provider_title:pr?.public_title||null,provider_photo_url:pr?.profile_photo_url||null});}
        assignment=team.find(a=>a.is_primary)||team[0]||null;provider=assignment?{display_name:assignment.provider_name,public_title:assignment.provider_title,profile_photo_url:assignment.provider_photo_url}:null;
        if(assignment?.id){
          const changes=await lib.sbJson(`/rest/v1/assignment_schedule_change_requests?select=id,status,proposed_start,proposed_end,created_at,reviewed_at&assignment_id=eq.${encodeURIComponent(assignment.id)}&order=created_at.desc&limit=1`);
          scheduleChange=changes?.[0]||null;
        }
        const invoices=await lib.sbJson(`/rest/v1/invoices?select=id,invoice_number,public_token,invoice_date,due_date,status,payment_status,total_amount,currency,issued_at,sent_at,paid_at&job_id=eq.${encodeURIComponent(job.id)}&status=not.in.(DRAFT,VOID)&order=created_at.desc&limit=1`);
        invoice=invoices?.[0]||null;
        try{evidence=await lib.sbJson(`/rest/v1/job_service_evidence?select=id,assignment_id,provider_id,evidence_type,storage_path,created_at&job_id=eq.${encodeURIComponent(job.id)}&order=created_at.asc`);for(const x of evidence){x.url=await signed(x.storage_path);const t=team.find(a=>a.id===x.assignment_id)||team.find(a=>a.provider_id===x.provider_id);x.provider_name=t?.provider_name||null;}}catch(_){}
        try{serviceEvents=await lib.sbJson(`/rest/v1/job_service_events?select=assignment_id,provider_id,event_type,event_note,customer_message,created_at&job_id=eq.${encodeURIComponent(job.id)}&order=created_at.asc`);}catch(_){}
        try{const ex=await lib.sbJson(`/rest/v1/job_extension_requests?select=id,extra_minutes,reason,proposed_end,customer_addition,status,customer_approval_method,created_at&job_id=eq.${encodeURIComponent(job.id)}&status=eq.PENDING&order=created_at.desc&limit=1`);extensionRequest=ex?.[0]||null;}catch(_){}
      }
    }

    let [code,label]=publicRequestStatus(req.status);
    if(job){const js=publicJobStatus(job.status);if(js){code=js[0];label=js[1];}}
    if(scheduleChange?.status==='PENDING'){code='SCHEDULE_CHANGE_REVIEW';label='Schedule change under review';}
    if(invoice&&job?.status==='COMPLETED'){
      if(invoice.payment_status==='PAID'){code='PAYMENT_RECEIVED';label='Payment received';}
      else{code='INVOICE_AVAILABLE';label='Invoice available';}
    }
    if(req.status==='CANCELLED'){code='CANCELLED';label='Request cancelled';}

    const timeline=[];
    const push=(when,title,detail)=>{if(when)timeline.push({when,title,detail:detail||null});};
    push(req.created_at,'Request received',`Reference ${req.reference}`);
    push(req.reviewed_at,'PLEASE review started');
    push(req.ready_to_assign_at,'Scheduling started');
    push(req.assigned_at,'Provider assignment created');
    if(assignment?.responded_at&&assignment.status==='CONFIRMED')push(assignment.responded_at,'Provider confirmed the service');
    if(scheduleChange?.created_at)push(scheduleChange.created_at,'Schedule change proposed',scheduleChange.status==='PENDING'?'Awaiting PLEASE review':`Status: ${scheduleChange.status}`);
    if(scheduleChange?.reviewed_at)push(scheduleChange.reviewed_at,`Schedule change ${String(scheduleChange.status||'').toLowerCase()}`);
    for(const e of serviceEvents||[]){const labels={ARRIVED:'PLEASE professional arrived',STARTED:'Service started',EXTENSION_REQUESTED:'Additional time requested',EXTENSION_APPROVED:'Additional time approved',EXTENSION_REJECTED:'Additional time not approved',COMPLETED:'Primary professional completed work',JOB_COMPLETED:'Service team completed'};if(labels[e.event_type]&&(e.assignment_id===assignment?.id||e.event_type==='JOB_COMPLETED'))push(e.created_at,labels[e.event_type],e.customer_message||e.event_note);}
    push(job?.completed_at,'Service completed');
    push(invoice?.issued_at,'Invoice issued',invoice?.invoice_number);
    push(invoice?.sent_at,'Invoice sent');
    push(invoice?.paid_at,'Payment received',invoice?.invoice_number);
    push(req.cancelled_at,'Request cancelled');
    timeline.sort((a,b)=>new Date(a.when)-new Date(b.when));

    return lib.json(200,{
      request:{reference:req.reference,first_name:req.first_name,service_name:req.service_name,status:req.status,moving_bedrooms:req.moving_bedrooms,moving_square_feet:req.moving_square_feet,moving_inventory:req.moving_inventory,preferred_date:req.preferred_date,preferred_start_time:req.preferred_start_time,scheduling_flexibility:req.scheduling_flexibility,created_at:req.created_at},
      public_status:{code,label},
      job:job?{reference:job.reference,status:job.status,service_name:job.service_name,work_address:job.work_address,estimated_duration_minutes:job.estimated_duration_minutes,actual_arrived_at:iso(job.actual_arrived_at),actual_started_at:iso(job.actual_started_at),actual_completed_at:iso(job.actual_completed_at),approved_extension_minutes:job.approved_extension_minutes||0,completed_at:iso(job.completed_at)}:null,
      assignment:assignment?{id:assignment.id,status:assignment.status,scheduled_start:assignment.scheduled_start,scheduled_end:assignment.scheduled_end,provider_name:assignment.provider_name||null,provider_title:assignment.provider_title||null,provider_photo_url:assignment.provider_photo_url||null}:null,
      team:team.map(a=>({id:a.id,status:a.status,sequence_no:a.sequence_no,is_primary:a.is_primary,scheduled_start:a.scheduled_start,scheduled_end:a.scheduled_end,provider_name:a.provider_name,provider_title:a.provider_title,provider_photo_url:a.provider_photo_url})),
      schedule_change:scheduleChange?{status:scheduleChange.status,proposed_start:scheduleChange.proposed_start,proposed_end:scheduleChange.proposed_end}:null,
      extension_request:extensionRequest,
      evidence:evidence.map(x=>({assignment_id:x.assignment_id,provider_id:x.provider_id,provider_name:x.provider_name,type:x.evidence_type,url:x.url,created_at:x.created_at})),
      invoice:invoice?{invoice_number:invoice.invoice_number,status:invoice.status,payment_status:invoice.payment_status,total_amount:invoice.total_amount,currency:invoice.currency||'CAD',public_token:invoice.public_token,due_date:invoice.due_date}:null,
      timeline
    });
  }catch(e){console.error('public-request-tracking',e);return lib.json(e.status||500,{error:'Unable to load request tracking.'});}
};
