const crypto=require('crypto');
const lib=require('./_admin-lib');

function hash(v){return crypto.createHash('sha256').update(String(v||'')).digest('hex');}
function iso(v){return v||null;}
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

exports.handler=async event=>{
  if(event.httpMethod!=='GET') return lib.json(405,{error:'Method not allowed'});
  try{
    const token=String(event.queryStringParameters?.token||'').trim();
    if(!/^[a-f0-9]{48}$/i.test(token)) return lib.json(400,{error:'Invalid tracking link.'});
    const tokenHash=hash(token);
    const rows=await lib.sbJson(`/rest/v1/service_requests?select=id,reference,first_name,service_id,service_name,street_address,city,province,postal_code,preferred_date,preferred_start_time,scheduling_flexibility,status,job_id,created_at,reviewed_at,ready_to_assign_at,assigned_at,cancelled_at,cancellation_reason&tracking_token_hash=eq.${encodeURIComponent(tokenHash)}&limit=1`);
    const req=rows?.[0];
    if(!req) return lib.json(404,{error:'Tracking link not found.'});

    let job=null, assignment=null, provider=null, scheduleChange=null, invoice=null;
    if(req.job_id){
      const jobs=await lib.sbJson(`/rest/v1/jobs?select=id,reference,service_name,status,work_address,estimated_duration_minutes,created_at,updated_at,completed_at,cancelled_at& id=eq.${encodeURIComponent(req.job_id)}&limit=1`.replace('& id=','&id='));
      job=jobs?.[0]||null;
      if(job){
        const assignments=await lib.sbJson(`/rest/v1/job_assignments?select=id,provider_id,scheduled_start,scheduled_end,status,assigned_at,responded_at,updated_at&job_id=eq.${encodeURIComponent(job.id)}&status=in.(PENDING,CONFIRMED,COMPLETED,CANCELLED,DECLINED)&order=assigned_at.desc&limit=1`);
        assignment=assignments?.[0]||null;
        if(assignment?.provider_id){
          const providers=await lib.sbJson(`/rest/v1/providers?select=id,display_name,public_title,status&id=eq.${encodeURIComponent(assignment.provider_id)}&limit=1`);
          provider=providers?.[0]||null;
        }
        if(assignment?.id){
          const changes=await lib.sbJson(`/rest/v1/assignment_schedule_change_requests?select=id,status,proposed_start,proposed_end,created_at,resolved_at&assignment_id=eq.${encodeURIComponent(assignment.id)}&order=created_at.desc&limit=1`);
          scheduleChange=changes?.[0]||null;
        }
        const invoices=await lib.sbJson(`/rest/v1/invoices?select=id,invoice_number,public_token,invoice_date,due_date,status,payment_status,total_amount,currency,issued_at,sent_at,paid_at&job_id=eq.${encodeURIComponent(job.id)}&status=not.in.(DRAFT,VOID)&order=created_at.desc&limit=1`);
        invoice=invoices?.[0]||null;
      }
    }

    let [code,label]=publicRequestStatus(req.status);
    if(job){
      const js=publicJobStatus(job.status);
      if(js){code=js[0];label=js[1];}
    }
    if(scheduleChange?.status==='PENDING'){
      code='SCHEDULE_CHANGE_REVIEW'; label='Schedule change under review';
    }
    if(invoice && job?.status==='COMPLETED'){
      if(invoice.payment_status==='PAID') { code='PAYMENT_RECEIVED'; label='Payment received'; }
      else { code='INVOICE_AVAILABLE'; label='Invoice available'; }
    }
    if(req.status==='CANCELLED'){code='CANCELLED';label='Request cancelled';}

    const timeline=[];
    const push=(when,title,detail)=>{if(when) timeline.push({when,title,detail:detail||null});};
    push(req.created_at,'Request received',`Reference ${req.reference}`);
    push(req.reviewed_at,'PLEASE review started');
    push(req.ready_to_assign_at,'Scheduling started');
    push(req.assigned_at,'Provider assignment created');
    if(assignment?.responded_at && assignment.status==='CONFIRMED') push(assignment.responded_at,'Provider confirmed the service');
    if(scheduleChange?.created_at) push(scheduleChange.created_at,'Schedule change proposed',scheduleChange.status==='PENDING'?'Awaiting PLEASE review':`Status: ${scheduleChange.status}`);
    if(scheduleChange?.resolved_at) push(scheduleChange.resolved_at,`Schedule change ${String(scheduleChange.status||'').toLowerCase()}`);
    push(job?.completed_at,'Service completed');
    push(invoice?.issued_at,'Invoice issued',invoice?.invoice_number);
    push(invoice?.sent_at,'Invoice sent');
    push(invoice?.paid_at,'Payment received',invoice?.invoice_number);
    push(req.cancelled_at,'Request cancelled');
    timeline.sort((a,b)=>new Date(a.when)-new Date(b.when));

    return lib.json(200,{
      request:{reference:req.reference,first_name:req.first_name,service_name:req.service_name,status:req.status,preferred_date:req.preferred_date,preferred_start_time:req.preferred_start_time,scheduling_flexibility:req.scheduling_flexibility,created_at:req.created_at},
      public_status:{code,label},
      job:job?{reference:job.reference,status:job.status,service_name:job.service_name,work_address:job.work_address,estimated_duration_minutes:job.estimated_duration_minutes,completed_at:iso(job.completed_at)}:null,
      assignment:assignment?{status:assignment.status,scheduled_start:assignment.scheduled_start,scheduled_end:assignment.scheduled_end,provider_name:provider?.display_name||null,provider_title:provider?.public_title||null}:null,
      schedule_change:scheduleChange?{status:scheduleChange.status,proposed_start:scheduleChange.proposed_start,proposed_end:scheduleChange.proposed_end}:null,
      invoice:invoice?{invoice_number:invoice.invoice_number,status:invoice.status,payment_status:invoice.payment_status,total_amount:invoice.total_amount,currency:invoice.currency||'CAD',public_token:invoice.public_token,due_date:invoice.due_date}:null,
      timeline
    });
  }catch(e){
    console.error('public-request-tracking',e);
    return lib.json(e.status||500,{error:'Unable to load request tracking.'});
  }
};
