const TYPES=new Set(['CHECK_IN','ARRIVAL','COMPLETION','CHECK_OUT']);
const ACTION_LABEL={CHECK_IN:'Daily Check In',ARRIVAL:"I've Arrived",COMPLETION:'Completion',CHECK_OUT:'Daily Check Out'};
const TZ='America/Edmonton';
function validId(v){return /^[0-9a-f-]{36}$/i.test(String(v||''));}
function readyError(code,error,extra={}){return{ok:false,code,error,...extra};}
function localDate(iso){try{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso)),o={};for(const p of parts)if(p.type!=='literal')o[p.type]=p.value;return `${o.year}-${o.month}-${o.day}`;}catch{return'';}}
async function dayContext(lib,providerId,a){
  const day=localDate(a.scheduled_start),center=new Date(a.scheduled_start).getTime(),lo=new Date(center-30*3600000).toISOString(),hi=new Date(center+30*3600000).toISOString();
  const nearby=await lib.sbJson(`/rest/v1/job_assignments?select=id,job_id,status,scheduled_start,scheduled_end&provider_id=eq.${encodeURIComponent(providerId)}&scheduled_start=gte.${encodeURIComponent(lo)}&scheduled_start=lte.${encodeURIComponent(hi)}&order=scheduled_start.asc`).catch(()=>[]);
  const assignments=(nearby||[]).filter(x=>localDate(x.scheduled_start)===day&&!['DECLINED','CANCELLED'].includes(String(x.status||'').toUpperCase())).sort((x,y)=>new Date(x.scheduled_start)-new Date(y.scheduled_start));
  const ids=assignments.map(x=>x.id).filter(validId),events=ids.length?await lib.sbJson(`/rest/v1/job_service_events?select=assignment_id,event_type,created_at&assignment_id=in.(${ids.join(',')})&event_type=in.(CHECKED_IN,ARRIVED,STARTED,COMPLETED,CHECKED_OUT)&order=created_at.asc`).catch(()=>[]):[];
  const firstConfirmed=assignments.find(x=>String(x.status||'').toUpperCase()==='CONFIRMED')||null,last=assignments[assignments.length-1]||null;
  return{day,assignments,events,firstConfirmed,last};
}
async function readiness(lib,providerId,assignmentId,type){
  type=String(type||'').toUpperCase();
  if(!validId(assignmentId)||!TYPES.has(type))return readyError('INVALID_REQUEST','Invalid evidence request.');
  const [assignments,providers]=await Promise.all([
    lib.sbJson(`/rest/v1/job_assignments?select=id,job_id,provider_id,status,scheduled_start,scheduled_end,jobs(status,reference,service_name)&id=eq.${encodeURIComponent(assignmentId)}&provider_id=eq.${encodeURIComponent(providerId)}&limit=1`),
    lib.sbJson(`/rest/v1/providers?select=id,worker_type&id=eq.${encodeURIComponent(providerId)}&limit=1`)
  ]);
  const a=assignments?.[0];if(!a)return readyError('ASSIGNMENT_NOT_FOUND','Assignment not found for this signed-in Provider.');
  const workerType=providers?.[0]?.worker_type||'INDEPENDENT_PROVIDER',staff=workerType==='PLEASE_STAFF',jobStatus=String(a.jobs?.status||''),ctx=staff?await dayContext(lib,providerId,a):{assignments:[a],events:await lib.sbJson(`/rest/v1/job_service_events?select=assignment_id,event_type,created_at&assignment_id=eq.${encodeURIComponent(assignmentId)}&event_type=in.(CHECKED_IN,ARRIVED,STARTED,COMPLETED,CHECKED_OUT)&order=created_at.asc`).catch(()=>[]),firstConfirmed:a,last:a,day:localDate(a.scheduled_start)};
  const own=x=>(ctx.events||[]).some(e=>e.assignment_id===a.id&&String(e.event_type||'').toUpperCase()===x),daily=x=>(ctx.events||[]).some(e=>String(e.event_type||'').toUpperCase()===x),opensAt=new Date(new Date(a.scheduled_start).getTime()-120*60000).toISOString(),tooEarly=Date.now()<new Date(opensAt).getTime(),remaining=(ctx.assignments||[]).filter(x=>x.id!==a.id&&String(x.status||'').toUpperCase()!=='COMPLETED');
  const base={worker_type:workerType,assignment_status:a.status,job_status:jobStatus,job_reference:a.jobs?.reference||null,service_name:a.jobs?.service_name||null,scheduled_start:a.scheduled_start,scheduled_end:a.scheduled_end,work_date:ctx.day,available_at:opensAt,server_time:new Date().toISOString(),evidence_type:type,label:ACTION_LABEL[type],daily_check_in_recorded:staff?daily('CHECKED_IN'):false,is_last_service:staff?ctx.last?.id===a.id:false,remaining_services:remaining.length};
  if(type==='CHECK_IN'){
    if(!staff)return readyError('NOT_STAFF','Daily Check In photo is required only for PLEASE Staff.',base);
    if(a.status!=='CONFIRMED')return readyError('ASSIGNMENT_NOT_CONFIRMED','This assignment must be CONFIRMED before Daily Check In.',base);
    if(!['CONFIRMED','IN_PROGRESS'].includes(jobStatus))return readyError('TEAM_NOT_READY','Your assignment is confirmed, but the full PLEASE service team is not ready to start yet.',base);
    if(daily('CHECKED_IN'))return readyError('ALREADY_RECORDED','Daily Check In has already been recorded for this workday.',base);
    if(ctx.firstConfirmed&&ctx.firstConfirmed.id!==a.id)return readyError('FIRST_SERVICE_REQUIRED','Daily Check In must be recorded on your first confirmed PLEASE service of the day.',base);
    if(tooEarly)return readyError('TOO_EARLY',`DAILY CHECK IN becomes available at ${new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:TZ}).format(new Date(opensAt))}.`,base);
  }else if(type==='ARRIVAL'){
    if(a.status!=='CONFIRMED')return readyError('ASSIGNMENT_NOT_CONFIRMED',"This assignment must be CONFIRMED before I've Arrived.",base);
    if(!['CONFIRMED','IN_PROGRESS'].includes(jobStatus))return readyError('TEAM_NOT_READY','Your assignment is confirmed, but the full PLEASE service team is not ready to start yet.',base);
    if(staff&&!daily('CHECKED_IN'))return readyError('CHECK_IN_REQUIRED',"PLEASE Staff must complete one DAILY CHECK IN before I'VE ARRIVED on today's services.",base);
    if(own('ARRIVED'))return readyError('ALREADY_RECORDED','Arrival has already been recorded for this Provider.',base);
    if(tooEarly)return readyError('TOO_EARLY',`I'VE ARRIVED becomes available at ${new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:TZ}).format(new Date(opensAt))}.`,base);
  }else if(type==='COMPLETION'){
    if(a.status!=='CONFIRMED')return readyError('ASSIGNMENT_NOT_ACTIVE','This assignment is not in a state that accepts a completion photo.',base);
    if(!own('STARTED'))return readyError('START_REQUIRED','Start the service before taking the official Completion photo.',base);
    if(own('COMPLETED'))return readyError('ALREADY_RECORDED','This Provider has already completed the service.',base);
  }else if(type==='CHECK_OUT'){
    if(!staff)return readyError('NOT_STAFF','Daily Check Out photo is required only for PLEASE Staff.',base);
    if(a.status!=='COMPLETED'||!own('COMPLETED'))return readyError('COMPLETE_REQUIRED','Complete the assigned service before Daily Check Out.',base);
    if(ctx.last?.id!==a.id)return readyError('LAST_SERVICE_REQUIRED','Daily Check Out is available only on your last scheduled PLEASE service of the day.',base);
    if(remaining.length)return readyError('DAY_STILL_ACTIVE',`Daily Check Out is not available yet because ${remaining.length} other PLEASE service${remaining.length===1?' is':'s are'} still open today.`,base);
    if(own('CHECKED_OUT'))return readyError('ALREADY_RECORDED','Daily Check Out has already been recorded for this workday.',base);
  }
  return{ok:true,code:'READY',...base,next_action:type};
}
function friendlyUploadError(e){
  const m=String(e?.message||e||'');
  if(/job_service_evidence_evidence_type_check|check constraint.*evidence_type|violates check constraint/i.test(m))return Object.assign(new Error('PLEASE photo database update is not active yet. Administration must apply the operational photo migration before Daily Check In / Daily Check Out photos can be saved.'),{status:503,code:'EVIDENCE_SCHEMA_NOT_READY'});
  if(/job_service_events.*event_type|check constraint.*event_type/i.test(m))return Object.assign(new Error('PLEASE live-service database update is not active yet. Administration must apply the operational migration.'),{status:503,code:'LIVE_SERVICE_SCHEMA_NOT_READY'});
  if(/bucket|storage|object/i.test(m)&&/not found|does not exist/i.test(m))return Object.assign(new Error('PLEASE secure photo storage is unavailable. Contact Administration and provide the Job Reference.'),{status:503,code:'STORAGE_NOT_READY'});
  return e instanceof Error?e:new Error(m||'Evidence upload failed.');
}
module.exports={TYPES,readiness,friendlyUploadError};
