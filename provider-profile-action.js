const lib=require('./_provider-lib');
const notify=require('./_notify-lib');
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
 try{
  const a=await lib.requireProvider(event),b=JSON.parse(event.body||'{}');
  const result=await lib.sbJson('/rest/v1/rpc/provider_portal_profile_action',{method:'POST',body:JSON.stringify({p_actor:a.user.id,p_payload:b.payload||{}})});
  const n=await notify.sendAdmins({subject:`PLEASE — Provider Profile Updated (${a.provider.reference||a.provider.display_name})`,title:'Provider profile updated',intro:`${a.provider.display_name} updated profile information in the Provider Portal.`,details:[['Provider',a.provider.display_name],['Provider Reference',a.provider.reference]],ctaLabel:'Review Providers',ctaUrl:`${notify.baseUrl()}/admin-providers.html`,idempotencyKey:`please-provider-profile-${a.provider.id}-${Date.now()}`});
  return lib.json(200,{ok:true,result,admin_notified:!!n?.sent});
 }
 catch(e){console.error('provider-profile-action',e);return lib.json(e.status===401?401:400,{error:e.status===401?'Unauthorized':(e.message||'Profile could not be updated.')});}
};
