const lib = require('./_admin-lib');

function isoDate(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0,10);
}

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return lib.json(405,{error:'Method not allowed'});
  try {
    await lib.requireAdmin(event);
    const qs = event.queryStringParameters || {};
    const from = isoDate(qs.from);
    const to = isoDate(qs.to);
    if (!from || !to) return lib.json(400,{error:'Valid from/to dates are required'});
    // Fetch a deliberately broad UTC window, then the browser renders/filter dates in America/Edmonton.
    // This avoids hard-coding Calgary's DST offset.
    const fromWide = new Date(`${from}T00:00:00Z`); fromWide.setUTCDate(fromWide.getUTCDate()-1);
    const toWide = new Date(`${to}T00:00:00Z`); toWide.setUTCDate(toWide.getUTCDate()+2);
    const fromIso = fromWide.toISOString();
    const toExclusive = toWide.toISOString();
    const fromEnc=encodeURIComponent(from), toEnc=encodeURIComponent(to), startEnc=encodeURIComponent(fromIso), endEnc=encodeURIComponent(toExclusive);

    const [providers, providerServices, services, availability, exceptions, assignments, needsAssignment] = await Promise.all([
      lib.sbJson('/rest/v1/providers?select=id,reference,display_name,company_name,public_title,service_area,status,public_visible,slug&status=eq.ACTIVE&order=display_name.asc'),
      lib.sbJson('/rest/v1/provider_services?select=provider_id,service_id,active&active=eq.true'),
      lib.sbJson('/rest/v1/services?select=id,name,short_description,active&active=eq.true&order=sort_order.asc,name.asc'),
      lib.sbJson('/rest/v1/provider_availability?select=id,provider_id,weekday,start_time,end_time,active&active=eq.true&order=provider_id.asc,weekday.asc,start_time.asc'),
      lib.sbJson(`/rest/v1/provider_availability_exceptions?select=id,provider_id,exception_date,start_time,end_time,exception_type,reason&exception_date=gte.${fromEnc}&exception_date=lte.${toEnc}&order=exception_date.asc,start_time.asc`),
      lib.sbJson(`/rest/v1/job_assignments?select=id,job_id,provider_id,scheduled_start,scheduled_end,status,assignment_message,provider_response_note,assigned_at,responded_at,jobs(id,reference,service_id,service_name,work_address,work_description,estimated_duration_minutes,billing_type,customer_rate,billable_quantity,billing_unit,status,customer_id,customers(first_name,last_name,phone,email))&scheduled_start=gte.${startEnc}&scheduled_start=lt.${endEnc}&status=in.(PENDING,CONFIRMED)&order=scheduled_start.asc`),
      lib.sbJson('/rest/v1/jobs?select=id,reference,service_id,service_name,work_address,work_description,estimated_duration_minutes,billing_type,customer_rate,billable_quantity,billing_unit,status,customer_id,created_at,customers(first_name,last_name,phone,email)&status=eq.NEEDS_ASSIGNMENT&order=created_at.asc')
    ]);

    return lib.json(200,{from,to,providers:providers||[],provider_services:providerServices||[],services:services||[],availability:availability||[],exceptions:exceptions||[],assignments:assignments||[],needs_assignment:needsAssignment||[]});
  } catch (e) {
    console.error('admin-calendar-data',e);
    return lib.json(e.status||500,{error:e.status===401?'Unauthorized':'Unable to load master calendar.'});
  }
};
