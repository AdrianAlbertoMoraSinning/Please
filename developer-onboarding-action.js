const lib=require('./_admin-lib');
const notify=require('./_notify-lib');
exports.handler=async function(event){
  if(event.httpMethod!=='POST') return lib.json(405,{error:'Method not allowed'});
  if(!lib.sameOrigin(event)) return lib.json(403,{error:'Invalid request origin'});
  try{
    const auth=await lib.requireDeveloper(event),body=JSON.parse(event.body||'{}'),applicationId=String(body.application_id||'').trim(),action=String(body.action||'').trim().toUpperCase(),payload=(body.payload&&typeof body.payload==='object')?body.payload:{};
    if(!/^[0-9a-f-]{36}$/i.test(applicationId)) return lib.json(400,{error:'Invalid application id'});
    if(!['START_ONBOARDING','SAVE_ONBOARDING','APPROVE','ACTIVATE'].includes(action)) return lib.json(400,{error:'Invalid action'});
    const result=await lib.sbJson('/rest/v1/rpc/developer_portal_onboarding_action',{method:'POST',body:JSON.stringify({p_actor:auth.user.id,p_application_id:applicationId,p_action:action,p_payload:payload})});
    const app=await notify.applicationContext(applicationId).catch(()=>null),notices=[];
    if(app&&action!=='SAVE_ONBOARDING'){
      let title='PLEASE onboarding update',intro=`Hi ${app.full_name||'there'}, your PLEASE onboarding status was updated.`;
      if(action==='START_ONBOARDING'){title='PLEASE onboarding started';intro=`Hi ${app.full_name||'there'}, PLEASE has started your provider onboarding process.`;}
      if(action==='APPROVE'){title='PLEASE provider onboarding approved';intro=`Hi ${app.full_name||'there'}, your provider onboarding has been approved. Activation is the final step before the Provider Portal becomes active.`;}
      if(action==='ACTIVATE'){title='Your PLEASE Provider account is active';intro=`Hi ${app.full_name||'there'}, your PLEASE Provider profile and portal account are now active.`;}
      notices.push(await notify.send({to:app.email,subject:`PLEASE — ${title} (${app.reference||'Application'})`,title,intro,details:[['Application',app.reference],['Status',app.status]],message:action==='ACTIVATE'?'Use the Provider Portal login email established during onboarding. For security, passwords are not included in email.': '',ctaLabel:action==='ACTIVATE'?'Provider Portal':'PLEASE Website',ctaUrl:action==='ACTIVATE'?`${notify.baseUrl()}/provider-login.html`:notify.baseUrl(),idempotencyKey:`please-onboarding-${applicationId}-${action}`}));
      notices.push(await notify.sendAdmins({subject:`PLEASE — Onboarding ${action.replaceAll('_',' ')} (${app.reference||'Application'})`,title:'Provider onboarding workflow updated',intro:`Developer completed ${action.replaceAll('_',' ').toLowerCase()} for ${app.full_name||'Applicant'}.`,details:[['Application',app.reference],['Status',app.status]],ctaLabel:'Open Administration',ctaUrl:`${notify.baseUrl()}/admin-providers.html`,idempotencyKey:`please-admin-onboarding-${applicationId}-${action}`,replyToOverride:app.email}));
    }
    return lib.json(200,{ok:true,result,notifications_sent:notices.filter(n=>n?.sent).length});
  }catch(error){console.error('developer-onboarding-action',error);return lib.json(error.status===401?401:400,{error:error.status===401?'Unauthorized':(error.message||'Developer action failed')});}
};
