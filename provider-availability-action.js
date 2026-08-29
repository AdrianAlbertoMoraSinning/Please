const lib=require('./_provider-lib');
const notify=require('./_notify-lib');
exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
  function quarter(v){return !v||/^\d{2}:(00|15|30|45)(?::00)?$/.test(String(v));}
  try{
    const a=await lib.requireProvider(event),b=JSON.parse(event.body||'{}'),payload=b.payload||{},action=String(b.action||'').toUpperCase();
    if(action==='SAVE_WEEKLY'&&Array.isArray(payload.availability)&&payload.availability.some(x=>!quarter(x.start_time)||!quarter(x.end_time)))return lib.json(400,{error:'Availability must use 15-minute increments.'});
    if(action==='ADD_EXCEPTION'&&(!quarter(payload.start_time)||!quarter(payload.end_time)))return lib.json(400,{error:'Availability must use 15-minute increments.'});
    const d=await lib.sbJson('/rest/v1/rpc/provider_portal_availability_action',{method:'POST',body:JSON.stringify({p_actor:a.user.id,p_action:action,p_payload:payload})});
    const labels={SAVE_WEEKLY:'Weekly availability updated',ADD_EXCEPTION:'Availability exception added',DELETE_EXCEPTION:'Availability exception removed'};
    const n=await notify.sendAdmins({subject:`PLEASE — Provider Availability Update (${a.provider.reference||a.provider.display_name})`,title:'Provider availability updated',intro:`${a.provider.display_name} updated availability in the Provider Portal.`,details:[['Provider',a.provider.display_name],['Provider Reference',a.provider.reference],['Action',labels[action]||action],['Date',payload.exception_date||'']],message:payload.reason||'',ctaLabel:'Open Administration Calendar',ctaUrl:`${notify.baseUrl()}/admin-calendar.html`,idempotencyKey:`please-provider-availability-${a.provider.id}-${action}-${Date.now()}`});
    return lib.json(200,{...(d||{ok:true}),admin_notified:!!n?.sent});
  }catch(e){console.error('provider-availability-action',e);return lib.json(e.status||400,{error:e.message||'Availability could not be updated.'});}
};
