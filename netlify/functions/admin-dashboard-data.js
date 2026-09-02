const lib=require('./_admin-lib');
const TZ='America/Edmonton';
async function optional(label,fn,fallback=[]){try{return await fn();}catch(e){console.warn('admin-dashboard-data:'+label,e?.message||e);return fallback;}}
function localDate(iso){if(!iso)return'';try{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso));const o={};for(const p of parts)if(p.type!=='literal')o[p.type]=p.value;return `${o.year}-${o.month}-${o.day}`;}catch{return'';}}
function todayYmd(){return localDate(new Date().toISOString());}
exports.handler=async event=>{
 if(event.httpMethod!=='GET')return lib.json(405,{error:'Method not allowed'});
 try{
  await lib.requireAdmin(event);
  const today=todayYmd(), end=new Date(`${today}T12:00:00Z`);end.setUTCDate(end.getUTCDate()+7);const endYmd=end.toISOString().slice(0,10);
  const fromIso=encodeURIComponent(new Date(`${today}T00:00:00-06:00`).toISOString()),toIso=encodeURIComponent(new Date(`${endYmd}T23:59:59-06:00`).toISOString());
  const [requests,jobs,assignments,providers,scheduleChanges,applications,pendingAll]=await Promise.all([
   optional('requests',()=>lib.sbJson('/rest/v1/service_requests?select=id,reference,status,first_name,last_name,service_name,preferred_date,preferred_start_time,created_at&status=in.(NEW,REVIEWING,READY_TO_ASSIGN)&order=created_at.asc'),[]),
   optional('jobs',()=>lib.sbJson('/rest/v1/jobs?select=id,reference,status,service_name,created_at,customers(first_name,last_name)&status=in.(NEEDS_ASSIGNMENT,PENDING_PROVIDER,CONFIRMED,IN_PROGRESS)&order=created_at.asc'),[]),
   optional('assignments',()=>lib.sbJson(`/rest/v1/job_assignments?select=id,job_id,provider_id,status,scheduled_start,scheduled_end,jobs(reference,service_name,status,customers(first_name,last_name)),providers(display_name)&scheduled_start=gte.${fromIso}&scheduled_start=lte.${toIso}&status=in.(PENDING,CONFIRMED,COMPLETED)&order=scheduled_start.asc`),[]),
   optional('providers',()=>lib.sbJson('/rest/v1/providers?select=id,display_name,status,worker_type&status=eq.ACTIVE&order=display_name.asc'),[]),
   optional('schedule-changes',()=>lib.sbJson('/rest/v1/assignment_schedule_change_requests?select=id,status&status=eq.PENDING'),[]),
   optional('applications',()=>lib.sbJson('/rest/v1/provider_applications?select=id,status&status=in.(NEW,UNDER_REVIEW)'),[]),
   optional('pending-all',()=>lib.sbJson('/rest/v1/job_assignments?select=id,status&status=eq.PENDING'),[])
  ]);
  const todays=(assignments||[]).filter(a=>localDate(a.scheduled_start)===today);
  const uniqueTodayJobs=new Set(todays.map(a=>a.job_id));
  const pendingProvider=pendingAll||[];
  const confirmedToday=todays.filter(a=>a.status==='CONFIRMED');
  const inProgressJobs=(jobs||[]).filter(j=>j.status==='IN_PROGRESS');
  const next7={};for(const a of assignments||[]){const d=localDate(a.scheduled_start);if(!d||d<today||d>endYmd)continue;const key=`${d}|${a.job_id}`;if(!next7[d])next7[d]={jobs:new Set(),pending:0,confirmed:0};if(!next7[d].jobs.has(key)){next7[d].jobs.add(key);}if(a.status==='PENDING')next7[d].pending++;if(a.status==='CONFIRMED')next7[d].confirmed++;}
  const days=Object.keys(next7).sort().map(d=>({date:d,services:next7[d].jobs.size,pending_assignments:next7[d].pending,confirmed_assignments:next7[d].confirmed}));
  const priorities=[
   {key:'new_requests',label:'New Service Requests',count:(requests||[]).filter(r=>r.status==='NEW').length,href:'admin-service-requests.html?status=NEW',tone:'danger'},
   {key:'ready_requests',label:'Ready to Assign',count:(requests||[]).filter(r=>r.status==='READY_TO_ASSIGN').length,href:'admin-service-requests.html?status=READY_TO_ASSIGN',tone:'warning'},
   {key:'needs_assignment',label:'Jobs Need Assignment',count:(jobs||[]).filter(j=>j.status==='NEEDS_ASSIGNMENT').length,href:'admin-calendar.html#needs-assignment',tone:'danger'},
   {key:'provider_pending',label:'Provider Responses Pending',count:pendingProvider.length,href:'admin-jobs.html',tone:'warning'},
   {key:'schedule_changes',label:'Schedule Changes Pending',count:(scheduleChanges||[]).length,href:'admin-calendar.html#pending-schedule-changes',tone:'warning'},
   {key:'applications',label:'Professional Applications',count:(applications||[]).length,href:'admin.html',tone:'info'}
  ];
  return lib.json(200,{today,priorities,summary:{services_today:uniqueTodayJobs.size,confirmed_assignments_today:confirmedToday.length,in_progress_jobs:inProgressJobs.length,active_providers:(providers||[]).length,please_staff:(providers||[]).filter(p=>p.worker_type==='PLEASE_STAFF').length},today_assignments:todays,next_7_days:days});
 }catch(e){console.error('admin-dashboard-data',e);return lib.json(e.status||500,{error:e.status===401?'Unauthorized':(e.message||'Unable to load dashboard.')});}
};
