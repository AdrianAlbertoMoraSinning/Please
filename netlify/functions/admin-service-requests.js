const lib=require('./_admin-lib');
exports.handler=async event=>{
  if(event.httpMethod!=='GET') return lib.json(405,{error:'Method not allowed'});
  try{
    await lib.requireAdmin(event);
    const id=(event.queryStringParameters||{}).id;
    if(id){
      const rows=await lib.sbJson(`/rest/v1/service_requests?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
      if(!rows?.[0]) return lib.json(404,{error:'Service request not found'});
      const history=await lib.sbJson(`/rest/v1/service_request_status_history?select=id,old_status,new_status,note,created_at,admin_portal_users(display_name,email)&service_request_id=eq.${encodeURIComponent(id)}&order=created_at.asc`);
      const services=await lib.sbJson('/rest/v1/services?select=id,name&active=eq.true&order=sort_order.asc,name.asc');
      return lib.json(200,{request:rows[0],history:history||[],services:services||[]});
    }
    const requests=await lib.sbJson('/rest/v1/service_requests?select=id,reference,first_name,last_name,email,phone,service_id,service_name,city,preferred_date,preferred_start_time,scheduling_flexibility,status,job_id,created_at,updated_at&order=created_at.desc');
    const services=await lib.sbJson('/rest/v1/services?select=id,name&active=eq.true&order=sort_order.asc,name.asc');
    return lib.json(200,{requests:requests||[],services:services||[]});
  }catch(e){console.error('admin-service-requests',e);return lib.json(e.status||500,{error:e.status===401?'Unauthorized':(e.message||'Unable to load service requests.')});}
};
