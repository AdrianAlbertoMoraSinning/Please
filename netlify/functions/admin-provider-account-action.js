const lib=require('./_admin-lib');
const notify=require('./_notify-lib');
const WORKER_TYPES=new Set(['INDEPENDENT_PROVIDER','PLEASE_STAFF']);
exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
  try{
    const a=await lib.requireAdmin(event),b=JSON.parse(event.body||'{}'),pid=String(b.provider_id||''),action=String(b.action||'').toUpperCase();
    if(!/^[0-9a-f-]{36}$/i.test(pid))return lib.json(400,{error:'Invalid provider id'});
    if(!['CHANGE_LOGIN_EMAIL','RESET_PASSWORD','DEACTIVATE','REACTIVATE','SET_WORKER_TYPE'].includes(action))return lib.json(400,{error:'Invalid action'});
    let d;
    if(action==='SET_WORKER_TYPE'){
      const workerType=String(b.payload?.worker_type||'').toUpperCase();
      if(!WORKER_TYPES.has(workerType))return lib.json(400,{error:'Worker Type must be Independent Provider or PLEASE Staff.'});
      const before=(await lib.sbJson(`/rest/v1/providers?select=id,display_name,worker_type&id=eq.${encodeURIComponent(pid)}&limit=1`))?.[0];
      if(!before)return lib.json(404,{error:'Provider not found.'});
      const rows=await lib.sbJson(`/rest/v1/providers?id=eq.${encodeURIComponent(pid)}&select=id,worker_type,updated_at`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({worker_type:workerType,updated_at:new Date().toISOString()})});
      const verified=rows?.[0];
      if(!verified||verified.worker_type!==workerType)throw new Error('Worker Type was not persisted. Please refresh and try again.');
      await lib.sbJson('/rest/v1/provider_technical_history',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({provider_id:pid,event_type:'ADMIN_WORKER_TYPE_CHANGED',event_label:'Worker Type updated by PLEASE Administration',details:{old_worker_type:before.worker_type||'INDEPENDENT_PROVIDER',new_worker_type:workerType,four_photo_rule:workerType==='PLEASE_STAFF'},actor_type:'ADMIN',actor_admin_user_id:a.user.id})}).catch(e=>console.warn('admin-provider-account-action:history',e?.message||e));
      d={ok:true,provider_id:pid,worker_type:workerType,verified_worker_type:verified.worker_type};
    }else{
      d=await lib.sbJson('/rest/v1/rpc/admin_provider_account_action',{method:'POST',body:JSON.stringify({p_actor:a.user.id,p_provider_id:pid,p_action:action,p_payload:b.payload||{}})});
    }
    const pr=await notify.providerContext(pid).catch(()=>null),labels={CHANGE_LOGIN_EMAIL:'Login email changed',RESET_PASSWORD:'Portal password reset',DEACTIVATE:'Provider account deactivated',REACTIVATE:'Provider account reactivated',SET_WORKER_TYPE:'Provider account classification updated'};
    const message=action==='RESET_PASSWORD'?'For security, temporary or reset passwords are never included in email. Use the credential provided through the approved secure channel.':action==='SET_WORKER_TYPE'?(d?.verified_worker_type==='PLEASE_STAFF'?'Your Worker Type is now PLEASE Staff. The four-photo service evidence sequence (Check In, I’ve Arrived, Completed, Check Out) applies to your live assignments.':'Your Worker Type is now Independent Provider. The standard arrival and completion evidence workflow applies.') : '';
    const n=await notify.sendProvider(pid,{subject:`PLEASE — ${labels[action]||'Provider account update'}`,title:labels[action]||'Provider account update',intro:`Hello ${pr?.display_name||'Provider'}, PLEASE Administration updated your Provider account.`,details:[['Provider',pr?.display_name],['Account action',action.replaceAll('_',' ')],['Worker Type',action==='SET_WORKER_TYPE'?(d?.verified_worker_type==='PLEASE_STAFF'?'PLEASE Staff':'Independent Provider'):null],['Status',pr?.status]],message,ctaLabel:'Provider Portal',ctaUrl:`${notify.baseUrl()}/provider-login.html`,idempotencyKey:`please-provider-account-admin-${pid}-${action}-${Date.now()}`});
    return lib.json(200,{ok:true,result:d,verified_worker_type:d?.verified_worker_type||null,notification_sent:!!n?.sent});
  }catch(e){console.error('admin-provider-account-action',e);return lib.json(e.status||400,{error:e.status===401?'Unauthorized':(e.message||'Provider account action failed.')});}
};
