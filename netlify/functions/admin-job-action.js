const lib = require('./_admin-lib');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return lib.json(405,{error:'Method not allowed'});
  try {
    if (!lib.sameOrigin(event)) return lib.json(403,{error:'Forbidden'});
    const auth = await lib.requireAdmin(event);
    let body={}; try { body=JSON.parse(event.body||'{}'); } catch { return lib.json(400,{error:'Invalid JSON'}); }
    const action=String(body.action||'').trim().toUpperCase();
    if (!action) return lib.json(400,{error:'Action is required'});
    const result=await lib.sbJson('/rest/v1/rpc/please_portal_job_action',{
      method:'POST', headers:{Prefer:'return=representation'},
      body:JSON.stringify({p_actor:auth.user.id,p_action:action,p_payload:body.payload||{}})
    });
    const value=Array.isArray(result)?result[0]:result;
    return lib.json(200,value||{ok:true});
  } catch(e) {
    console.error('admin-job-action',e);
    let message=e.message||'Job action failed.';
    if (/exclusion|job_assignments_no_provider_overlap|conflict/i.test(message)) message='That provider already has an assignment overlapping the selected time.';
    return lib.json(e.status||400,{error:message});
  }
};
