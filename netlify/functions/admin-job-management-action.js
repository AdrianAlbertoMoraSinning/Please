const lib=require('./_admin-lib');
exports.handler=async event=>{
  if(event.httpMethod!=='POST') return lib.json(405,{error:'Method not allowed'});
  try{
    if(!lib.sameOrigin(event)) return lib.json(403,{error:'Forbidden'});
    const auth=await lib.requireAdmin(event);
    let body={}; try{body=JSON.parse(event.body||'{}')}catch{return lib.json(400,{error:'Invalid JSON'})}
    const jobId=String(body.job_id||'').trim(), action=String(body.action||'').trim().toUpperCase(), note=String(body.note||'').trim();
    if(!jobId||!action) return lib.json(400,{error:'Job and action are required'});
    if(note.length>1000) return lib.json(400,{error:'Note cannot exceed 1000 characters'});
    const result=await lib.sbJson('/rest/v1/rpc/please_portal_manage_job',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_actor:auth.user.id,p_job_id:jobId,p_action:action,p_note:note||null})});
    return lib.json(200,Array.isArray(result)?result[0]:result);
  }catch(e){console.error('admin-job-management-action',e);return lib.json(e.status||400,{error:e.message||'Job action failed.'});}
};
