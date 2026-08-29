const lib=require('./_admin-lib');
const notify=require('./_notify-lib');
exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
  try{
    const a=await lib.requireAdmin(event),b=JSON.parse(event.body||'{}'),pid=String(b.provider_id||''),action=String(b.action||'').toUpperCase();
    if(!/^[0-9a-f-]{36}$/i.test(pid))return lib.json(400,{error:'Invalid provider id'});
    if(!['CHANGE_LOGIN_EMAIL','RESET_PASSWORD','DEACTIVATE','REACTIVATE','SET_WORKER_TYPE'].includes(action))return lib.json(400,{error:'Invalid action'});
    const d=await lib.sbJson('/rest/v1/rpc/admin_provider_account_action',{method:'POST',body:JSON.stringify({p_actor:a.user.id,p_provider_id:pid,p_action:action,p_payload:b.payload||{}})});
    const pr=await notify.providerContext(pid).catch(()=>null),labels={CHANGE_LOGIN_EMAIL:'Login email changed',RESET_PASSWORD:'Portal password reset',DEACTIVATE:'Provider account deactivated',REACTIVATE:'Provider account reactivated',SET_WORKER_TYPE:'Provider account classification updated'};
    const n=await notify.sendProvider(pid,{subject:`PLEASE — ${labels[action]||'Provider account update'}`,title:labels[action]||'Provider account update',intro:`Hello ${pr?.display_name||'Provider'}, PLEASE Administration updated your Provider account.`,details:[['Provider',pr?.display_name],['Account action',action.replaceAll('_',' ')],['Status',pr?.status]],message:action==='RESET_PASSWORD'?'For security, temporary or reset passwords are never included in email. Use the credential provided through the approved secure channel.':'',ctaLabel:'Provider Portal',ctaUrl:`${notify.baseUrl()}/provider-login.html`,idempotencyKey:`please-provider-account-admin-${pid}-${action}-${Date.now()}`});
    return lib.json(200,{ok:true,result:d,notification_sent:!!n?.sent});
  }catch(e){console.error('admin-provider-account-action',e);return lib.json(e.status||400,{error:e.status===401?'Unauthorized':(e.message||'Provider account action failed.')});}
};
