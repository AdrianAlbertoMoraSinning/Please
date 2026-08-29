const lib = require('./_admin-lib');
const notify=require('./_notify-lib');
exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return lib.json(405, { error: 'Method not allowed' });
  if (!lib.sameOrigin(event)) return lib.json(403, { error: 'Invalid request origin' });
  try {
    const auth = await lib.requireAdmin(event);
    const body = JSON.parse(event.body || '{}');
    const applicationId = String(body.application_id || '').trim();
    const action = String(body.action || '').trim().toUpperCase();
    const value = body.value == null ? null : String(body.value);
    if (!/^[0-9a-f-]{36}$/i.test(applicationId)) return lib.json(400, { error: 'Invalid application id' });
    if (!['START_REVIEW','REFER_TO_DEVELOPER','DECLINE','SAVE_NOTES'].includes(action)) return lib.json(400, { error: 'Invalid action' });
    await lib.sbJson('/rest/v1/rpc/admin_portal_application_action', {method: 'POST',body: JSON.stringify({ p_actor: auth.user.id, p_application_id: applicationId, p_action: action, p_value: value })});
    const app=await notify.applicationContext(applicationId).catch(()=>null),notices=[];
    if(app&&action!=='SAVE_NOTES'){
      let title='Application update',intro=`Hi ${app.full_name||'there'}, your PLEASE professional application has been updated.`,message='';
      if(action==='START_REVIEW'){title='Your PLEASE application is under review';intro=`Hi ${app.full_name||'there'}, PLEASE Administration has started reviewing your application.`;}
      if(action==='REFER_TO_DEVELOPER'){title='Your application advanced to onboarding review';intro=`Hi ${app.full_name||'there'}, your application has advanced to the PLEASE Developer onboarding review.`;}
      if(action==='DECLINE'){title='PLEASE application status update';intro=`Hi ${app.full_name||'there'}, PLEASE has completed its review and will not move this application forward at this time.`;message=value||'';}
      notices.push(await notify.send({to:app.email,subject:`PLEASE — ${title} (${app.reference||'Application'})`,title,intro,details:[['Application',app.reference],['Status',app.status]],message,ctaLabel:'PLEASE Website',ctaUrl:notify.baseUrl(),idempotencyKey:`please-applicant-status-${applicationId}-${action}`}));
      if(action==='REFER_TO_DEVELOPER')notices.push(await notify.sendDevelopers({subject:`PLEASE — Application Referred (${app.reference||'Application'})`,title:'Professional application referred to Developer',intro:`PLEASE Administration referred ${app.full_name||'Applicant'} for onboarding review.`,details:[['Application',app.reference],['Applicant',app.full_name||'Applicant'],['Email',app.email],['Status',app.status]],ctaLabel:'Open Developer Portal',ctaUrl:`${notify.baseUrl()}/developer.html`,idempotencyKey:`please-developer-application-${applicationId}`,replyToOverride:app.email}));
    }
    return lib.json(200, { ok: true, notifications_sent:notices.filter(n=>n?.sent).length });
  } catch (error) {
    console.error('admin-application-action', error);
    const status = error.status === 401 ? 401 : 400;
    return lib.json(status, { error: error.status === 401 ? 'Unauthorized' : (error.message || 'Action failed') });
  }
};
