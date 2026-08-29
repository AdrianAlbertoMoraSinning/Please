const lib=require('./_provider-lib');
const notify=require('./_notify-lib');
exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
  try{
    const a=await lib.requireProvider(event),b=JSON.parse(event.body||'{}');
    await lib.sbJson('/rest/v1/rpc/provider_portal_change_password',{method:'POST',body:JSON.stringify({p_actor:a.user.id,p_current_password:String(b.current_password||''),p_new_password:String(b.new_password||'')})});
    const n=await notify.sendProvider(a.provider.id,{subject:'PLEASE — Provider Portal Password Changed',title:'Your Provider Portal password was changed',intro:`Hello ${a.provider.display_name||a.user.display_name||'Provider'}, your PLEASE Provider Portal password was changed successfully.`,message:'If you did not make this change, contact PLEASE Administration immediately. For security, the password is not included in this email.',ctaLabel:'Provider Login',ctaUrl:`${notify.baseUrl()}/provider-login.html`,idempotencyKey:`please-provider-password-${a.user.id}-${Date.now()}`});
    return lib.json(200,{ok:true,notification_sent:!!n?.sent},{'Set-Cookie':lib.clearCookie()});
  }catch(e){console.error('provider-change-password',e);return lib.json(e.status||400,{error:e.message||'Unable to change password.'});}
};
