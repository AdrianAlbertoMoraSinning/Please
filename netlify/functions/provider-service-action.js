const lib=require('./_provider-lib');
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
 try{const a=await lib.requireProvider(event),b=JSON.parse(event.body||'{}'),id=String(b.service_id||'').trim();if(!/^[0-9a-f-]{36}$/i.test(id))return lib.json(400,{error:'Invalid service'});const result=await lib.sbJson('/rest/v1/rpc/provider_portal_service_action',{method:'POST',body:JSON.stringify({p_actor:a.user.id,p_service_id:id,p_enabled:!!b.enabled})});return lib.json(200,{ok:true,result});}
 catch(e){console.error('provider-service-action',e);return lib.json(e.status===401?401:400,{error:e.status===401?'Unauthorized':(e.message||'Service could not be updated.')});}
};
