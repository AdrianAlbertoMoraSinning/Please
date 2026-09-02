const TYPES=new Set(['CHECK_IN','ARRIVAL','COMPLETION','CHECK_OUT']);
const ACTION_LABEL={CHECK_IN:'Check In',ARRIVAL:"I've Arrived",COMPLETION:'Completion',CHECK_OUT:'Check Out'};
function validId(v){return /^[0-9a-f-]{36}$/i.test(String(v||''));}
function readyError(code,error,extra={}){return{ok:false,code,error,...extra};}
async function readiness(lib,providerId,assignmentId,type){
  type=String(type||'').toUpperCase();
  if(!validId(assignmentId)||!TYPES.has(type))return readyError('INVALID_REQUEST','Invalid evidence request.');
  const [assignments,providers,events]=await Promise.all([
    lib.sbJson(`/rest/v1/job_assignments?select=id,job_id,provider_id,status,scheduled_start,scheduled_end,jobs(status,reference,service_name)&id=eq.${encodeURIComponent(assignmentId)}&provider_id=eq.${encodeURIComponent(providerId)}&limit=1`),
    lib.sbJson(`/rest/v1/providers?select=id,worker_type&id=eq.${encodeURIComponent(providerId)}&limit=1`),
    lib.sbJson(`/rest/v1/job_service_events?select=event_type,created_at&assignment_id=eq.${encodeURIComponent(assignmentId)}&event_type=in.(CHECKED_IN,ARRIVED,STARTED,COMPLETED,CHECKED_OUT)`).catch(()=>[])
  ]);
  const a=assignments?.[0];if(!a)return readyError('ASSIGNMENT_NOT_FOUND','Assignment not found for this signed-in Provider.');
  const workerType=providers?.[0]?.worker_type||'INDEPENDENT_PROVIDER',staff=workerType==='PLEASE_STAFF',jobStatus=String(a.jobs?.status||''),has=x=>(events||[]).some(e=>String(e.event_type||'').toUpperCase()===x),opensAt=new Date(new Date(a.scheduled_start).getTime()-120*60000).toISOString(),tooEarly=Date.now()<new Date(opensAt).getTime();
  const base={worker_type:workerType,assignment_status:a.status,job_status:jobStatus,job_reference:a.jobs?.reference||null,service_name:a.jobs?.service_name||null,scheduled_start:a.scheduled_start,scheduled_end:a.scheduled_end,available_at:opensAt,server_time:new Date().toISOString(),evidence_type:type,label:ACTION_LABEL[type]};
  if(type==='CHECK_IN'){
    if(!staff)return readyError('NOT_STAFF','Check In photo is required only for PLEASE Staff.',base);
    if(a.status!=='CONFIRMED')return readyError('ASSIGNMENT_NOT_CONFIRMED','This assignment must be CONFIRMED before Check In.',base);
    if(!['CONFIRMED','IN_PROGRESS'].includes(jobStatus))return readyError('TEAM_NOT_READY','Your assignment is confirmed, but the full PLEASE service team is not ready to start yet.',base);
    if(has('CHECKED_IN'))return readyError('ALREADY_RECORDED','Check In has already been recorded for this assignment.',base);
    if(tooEarly)return readyError('TOO_EARLY',`CHECK IN becomes available at ${new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Edmonton'}).format(new Date(opensAt))}.`,base);
  }else if(type==='ARRIVAL'){
    if(a.status!=='CONFIRMED')return readyError('ASSIGNMENT_NOT_CONFIRMED',"This assignment must be CONFIRMED before I've Arrived.",base);
    if(!['CONFIRMED','IN_PROGRESS'].includes(jobStatus))return readyError('TEAM_NOT_READY','Your assignment is confirmed, but the full PLEASE service team is not ready to start yet.',base);
    if(staff&&!has('CHECKED_IN'))return readyError('CHECK_IN_REQUIRED',"PLEASE Staff must complete CHECK IN before I'VE ARRIVED.",base);
    if(has('ARRIVED'))return readyError('ALREADY_RECORDED','Arrival has already been recorded for this Provider.',base);
    if(tooEarly)return readyError('TOO_EARLY',`I'VE ARRIVED becomes available at ${new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Edmonton'}).format(new Date(opensAt))}.`,base);
  }else if(type==='COMPLETION'){
    if(a.status!=='CONFIRMED')return readyError('ASSIGNMENT_NOT_ACTIVE','This assignment is not in a state that accepts a completion photo.',base);
    if(!has('STARTED'))return readyError('START_REQUIRED','Start the service before taking the official Completion photo.',base);
    if(has('COMPLETED'))return readyError('ALREADY_RECORDED','This Provider has already completed the service.',base);
  }else if(type==='CHECK_OUT'){
    if(!staff)return readyError('NOT_STAFF','Check Out photo is required only for PLEASE Staff.',base);
    if(a.status!=='COMPLETED')return readyError('COMPLETE_REQUIRED','Complete the assigned service before Check Out.',base);
    if(!has('COMPLETED'))return readyError('COMPLETE_REQUIRED','Completion must be recorded before Check Out.',base);
    if(has('CHECKED_OUT'))return readyError('ALREADY_RECORDED','Check Out has already been recorded for this assignment.',base);
  }
  return{ok:true,code:'READY',...base,next_action:type};
}
function friendlyUploadError(e){
  const m=String(e?.message||e||'');
  if(/job_service_evidence_evidence_type_check|check constraint.*evidence_type|violates check constraint/i.test(m))return Object.assign(new Error('PLEASE photo database update is not active yet. Administration must apply the STEP 15.9 SQL migration before CHECK IN / CHECK OUT photos can be saved.'),{status:503,code:'EVIDENCE_SCHEMA_NOT_READY'});
  if(/job_service_events.*event_type|check constraint.*event_type/i.test(m))return Object.assign(new Error('PLEASE live-service database update is not active yet. Administration must apply the STEP 15.9 SQL migration.'),{status:503,code:'LIVE_SERVICE_SCHEMA_NOT_READY'});
  if(/bucket|storage|object/i.test(m)&&/not found|does not exist/i.test(m))return Object.assign(new Error('PLEASE secure photo storage is unavailable. Contact Administration and provide the Job Reference.'),{status:503,code:'STORAGE_NOT_READY'});
  return e instanceof Error?e:new Error(m||'Evidence upload failed.');
}
module.exports={TYPES,readiness,friendlyUploadError};
