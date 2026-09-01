const lib = require('./_admin-lib');
function isoDate(value){const d=value?new Date(value):new Date();if(Number.isNaN(d.getTime()))return null;return d.toISOString().slice(0,10);}
const ASSIGN_SELECT='id,job_id,provider_id,sequence_no,is_primary,scheduled_start,scheduled_end,status,assignment_message,provider_response_note,assigned_at,responded_at,jobs(id,reference,service_id,service_name,work_address,work_description,estimated_duration_minutes,status,customer_id,customers(first_name,last_name,phone,email))';
async function activeServices(){
  try{return await lib.sbJson('/rest/v1/services?select=id,name,short_description,active&active=eq.true&order=sort_order.asc,name.asc');}
  catch(primaryError){console.warn('admin-calendar-data:services-primary',primaryError?.message||primaryError);return lib.sbJson('/rest/v1/services?select=id,name,active&active=eq.true&order=name.asc');}
}
async function activeProviderRates(){
  try{return await lib.sbJson('/rest/v1/provider_service_rates?select=id,provider_id,service_id,rate_name,description,billing_unit,customer_rate,provider_compensation_method,provider_compensation,active,sort_order&active=eq.true&order=provider_id.asc,sort_order.asc,rate_name.asc');}
  catch(primaryError){console.warn('admin-calendar-data:rates-primary',primaryError?.message||primaryError);return lib.sbJson('/rest/v1/provider_service_rates?select=id,provider_id,service_id,rate_name,description,billing_unit,customer_rate,provider_compensation_method,provider_compensation,active&active=eq.true&order=provider_id.asc,rate_name.asc');}
}
async function optional(label,work,warnings){
  try{return await work();}
  catch(e){console.warn(`admin-calendar-data:${label}`,e?.message||e);warnings.push(`${label}${e?.status?`:${e.status}`:''}`);return [];}
}
exports.handler=async event=>{
  if(event.httpMethod!=='GET')return lib.json(405,{error:'Method not allowed'});
  const started=Date.now();
  try{
    await lib.requireAdmin(event);
    const qs=event.queryStringParameters||{},from=isoDate(qs.from),to=isoDate(qs.to);if(!from||!to)return lib.json(400,{error:'Valid from/to dates are required'});
    const fromWide=new Date(`${from}T00:00:00Z`);fromWide.setUTCDate(fromWide.getUTCDate()-1);const toWide=new Date(`${to}T00:00:00Z`);toWide.setUTCDate(toWide.getUTCDate()+2);
    const fromEnc=encodeURIComponent(from),toEnc=encodeURIComponent(to),startEnc=encodeURIComponent(fromWide.toISOString()),endEnc=encodeURIComponent(toWide.toISOString());
    const warnings=[];

    // STEP 15.8.6.2: all independent calendar reads execute in one parallel wave.
    // A slow/missing auxiliary table now returns a warning instead of holding the whole
    // Netlify function until the gateway emits an opaque HTTP 502.
    let [providers,providerServices,services,availability,exceptions,assignments,needsAssignment,providerRates,scheduleChanges]=await Promise.all([
      optional('providers',()=>lib.sbJson('/rest/v1/providers?select=id,reference,display_name,company_name,public_title,service_area,status,public_visible,slug&status=eq.ACTIVE&order=display_name.asc'),warnings),
      optional('provider-services',()=>lib.sbJson('/rest/v1/provider_services?select=provider_id,service_id,active&active=eq.true'),warnings),
      optional('services',()=>activeServices(),warnings),
      optional('availability',()=>lib.sbJson('/rest/v1/provider_availability?select=id,provider_id,weekday,start_time,end_time,active&active=eq.true&order=provider_id.asc,weekday.asc,start_time.asc'),warnings),
      optional('availability-exceptions',()=>lib.sbJson(`/rest/v1/provider_availability_exceptions?select=id,provider_id,exception_date,start_time,end_time,exception_type,reason&exception_date=gte.${fromEnc}&exception_date=lte.${toEnc}&order=exception_date.asc,start_time.asc`),warnings),
      optional('assignments',()=>lib.sbJson(`/rest/v1/job_assignments?select=${ASSIGN_SELECT}&scheduled_start=gte.${startEnc}&scheduled_start=lt.${endEnc}&status=in.(PENDING,CONFIRMED)&order=scheduled_start.asc`),warnings),
      optional('needs-assignment',()=>lib.sbJson('/rest/v1/jobs?select=id,reference,service_id,service_name,work_address,work_description,estimated_duration_minutes,status,customer_id,created_at,customers(first_name,last_name,phone,email)&status=eq.NEEDS_ASSIGNMENT&order=created_at.asc'),warnings),
      optional('provider-rates',()=>activeProviderRates(),warnings),
      optional('schedule-changes',()=>lib.sbJson('/rest/v1/assignment_schedule_change_requests?select=id,assignment_id,job_id,provider_id,current_start,current_end,proposed_start,proposed_end,provider_reason,status,admin_note,created_at,updated_at&status=eq.PENDING&order=created_at.asc'),warnings)
    ]);

    const have=new Set((assignments||[]).map(x=>x.id));
    const missing=[...new Set((scheduleChanges||[]).map(x=>x.assignment_id).filter(id=>id&&!have.has(id)))];
    let extraPromise=Promise.resolve([]),billingPromise=Promise.resolve([]);
    if(missing.length){const ids=missing.map(encodeURIComponent).join(',');extraPromise=optional('schedule-change-assignments',()=>lib.sbJson(`/rest/v1/job_assignments?select=${ASSIGN_SELECT}&id=in.(${ids})`),warnings);}
    const jobIds=[...new Set([...(assignments||[]).map(a=>a.job_id),...(needsAssignment||[]).map(j=>j.id)].filter(Boolean))];
    if(jobIds.length){const list=jobIds.map(x=>encodeURIComponent(x)).join(',');billingPromise=optional('job-billing',()=>lib.sbJson(`/rest/v1/job_billing_items?select=id,job_id,assignment_id,provider_id,provider_service_rate_id,service_id,service_name,description,quantity,unit,customer_unit_rate,customer_line_total,provider_unit_rate,provider_line_total,gross_profit,unit_rate,line_total,sort_order&job_id=in.(${list})&order=sort_order.asc,id.asc`),warnings);}
    const [extra,billing]=await Promise.all([extraPromise,billingPromise]);
    if(extra?.length)assignments=[...(assignments||[]),...extra];
    return lib.json(200,{from,to,providers:providers||[],provider_services:providerServices||[],services:services||[],availability:availability||[],exceptions:exceptions||[],assignments:assignments||[],needs_assignment:needsAssignment||[],provider_rates:providerRates||[],job_billing_items:billing||[],schedule_changes:scheduleChanges||[],warnings,duration_ms:Date.now()-started});
  }catch(e){
    console.error('admin-calendar-data',e);
    const status=e.status||500;
    const message=status===401?'Unauthorized':status===504?'The secure calendar backend timed out while contacting Supabase. Please retry.':`Unable to load the Master Calendar${e.message?`: ${e.message}`:'.'}`;
    return lib.json(status,{error:message,duration_ms:Date.now()-started});
  }
};
