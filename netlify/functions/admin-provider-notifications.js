const lib = require('./_admin-lib');
const notify = require('./_notify-lib');
exports.handler = async event => {
  if (!['GET','POST'].includes(event.httpMethod)) return lib.json(405,{error:'Method not allowed'});
  try {
    const admin = await lib.requireAdmin(event);
    if (event.httpMethod === 'GET') {
      if (!process.env.RESEND_API_KEY) return lib.json(503,{error:'Email delivery is not configured.'});
      const r = await fetch('https://api.resend.com/emails?limit=100',{headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`},signal:AbortSignal.timeout(6000)});
      const d = await r.json();
      if (!r.ok) return lib.json(502,{error:r.status===403?'The email key can send messages but cannot read delivery records. Delivery could not be verified.':'Email delivery records are currently unavailable.'});
      const providers = await lib.sbJson('/rest/v1/providers?select=primary_email');
      const accounts = await lib.sbJson('/rest/v1/provider_portal_users?select=email');
      const known = new Set(notify.normalizeEmails([...providers.map(p=>p.primary_email),...accounts.map(p=>p.email)]));
      const emails = (d.data||[]).filter(e=>(e.to||[]).some(a=>known.has(a.toLowerCase()))).map(e=>({id:e.id,to:e.to,subject:e.subject,created_at:e.created_at,last_event:e.last_event}));
      return lib.json(200,{emails,has_more:!!d.has_more});
    }
    if (!lib.sameOrigin(event)) return lib.json(403,{error:'Invalid request origin'});
    const b = JSON.parse(event.body||'{}');
    const id = String(b.provider_id||'');
    const email = String(b.email||'').trim().toLowerCase();
    if (!/^[0-9a-f-]{36}$/i.test(id)||!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(email)||email.length>254) return lib.json(400,{error:'Valid Provider and notification email are required.'});
    const before = (await lib.sbJson(`/rest/v1/providers?select=id,display_name,primary_email&id=eq.${id}&limit=1`))[0];
    if (!before) return lib.json(404,{error:'Provider not found.'});
    const now = new Date().toISOString();
    const changed = await lib.sbJson(`/rest/v1/providers?id=eq.${id}&select=id,primary_email`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({primary_email:email,updated_at:now})});
    if (changed?.[0]?.primary_email!==email) throw Error('Notification email was not saved.');
    await lib.sbJson('/rest/v1/provider_technical_history',{method:'POST',body:JSON.stringify({provider_id:id,event_type:'ADMIN_NOTIFICATION_EMAIL_CHANGED',event_label:'Notification contact email updated',details:{old_email:before.primary_email,new_email:email},actor_type:'ADMIN',actor_admin_user_id:admin.user.id})});
    const notification = await notify.sendProvider(id,{subject:'PLEASE — Notification email verification',title:'Your notification email was updated',intro:`Hello ${before.display_name}, service assignment notifications will now be sent to this email.`,message:'Your existing portal login and password have not changed.',ctaLabel:'OPEN PROVIDER PORTAL',ctaUrl:`${notify.baseUrl()}/provider-login.html`,idempotencyKey:`provider-notification-email-${id}-${now}`});
    return lib.json(200,{ok:true,email,notification});
  } catch(e) { return lib.json(e.status===401?401:500,{error:e.status===401?'Unauthorized':'Unable to update or inspect provider notifications.'}); }
};
