const lib=require('./_provider-lib');
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
 try{const a=await lib.requireProvider(event),b=JSON.parse(event.body||'{}');const result=await lib.sbJson('/rest/v1/rpc/provider_portal_profile_action',{method:'POST',body:JSON.stringify({p_actor:a.user.id,p_payload:b.payload||{}})});return lib.json(200,{ok:true,result});}
 catch(e){console.error('provider-profile-action',e);return lib.json(e.status===401?401:400,{error:e.status===401?'Unauthorized':(e.message||'Profile could not be updated.')});}
};
