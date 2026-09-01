const lib=require('./_admin-lib');

async function activeServices(){
  try{return await lib.sbJson('/rest/v1/services?select=id,name&active=eq.true&order=sort_order.asc,name.asc');}
  catch(primaryError){
    console.warn('admin-service-requests:service-list-primary',primaryError?.message||primaryError);
    return lib.sbJson('/rest/v1/services?select=id,name&active=eq.true&order=name.asc');
  }
}
async function addJobReferences(requests){
  const rows=Array.isArray(requests)?requests:[];
  const ids=[...new Set(rows.map(r=>r.job_id).filter(Boolean))];
  if(!ids.length)return rows;
  try{
    const list=ids.map(encodeURIComponent).join(',');
    const jobs=await lib.sbJson(`/rest/v1/jobs?select=id,reference&id=in.(${list})`);
    const map=new Map((jobs||[]).map(j=>[j.id,j.reference]));
    rows.forEach(r=>{r.job_reference=r.job_id?map.get(r.job_id)||null:null;});
  }catch(e){console.warn('admin-service-requests:job-reference-link',e?.message||e);}
  return rows;
}
async function optional(label,task,fallback){
  try{return await task();}
  catch(e){console.warn(`admin-service-requests:${label}`,e?.message||e);return fallback;}
}
exports.handler=async event=>{
  if(event.httpMethod!=='GET') return lib.json(405,{error:'Method not allowed'});
  try{
    await lib.requireAdmin(event);
    const id=(event.queryStringParameters||{}).id;
    if(id){
      const rows=await lib.sbJson(`/rest/v1/service_requests?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
      if(!rows?.[0]) return lib.json(404,{error:'Service request not found'});
      await addJobReferences(rows);
      // History and service catalog help the drawer but are not required to view or transition
      // the request. A temporary auxiliary-query problem must not collapse the whole drawer.
      const [history,services]=await Promise.all([
        optional('history',()=>lib.sbJson(`/rest/v1/service_request_status_history?select=id,old_status,new_status,note,created_at,admin_portal_users(display_name,email)&service_request_id=eq.${encodeURIComponent(id)}&order=created_at.asc`),[]),
        optional('services',()=>activeServices(),[])
      ]);
      return lib.json(200,{request:rows[0],history:history||[],services:services||[]});
    }
    const requests=await lib.sbJson('/rest/v1/service_requests?select=id,reference,first_name,last_name,email,phone,service_id,service_name,city,preferred_date,preferred_start_time,scheduling_flexibility,status,job_id,created_at,updated_at&order=created_at.desc');
    await addJobReferences(requests);
    // The list view does not need the service catalog. Avoid making the queue depend on it.
    return lib.json(200,{requests:requests||[],services:[]});
  }catch(e){console.error('admin-service-requests',e);return lib.json(e.status||500,{error:e.status===401?'Unauthorized':(e.message||'Unable to load service requests.')});}
};
