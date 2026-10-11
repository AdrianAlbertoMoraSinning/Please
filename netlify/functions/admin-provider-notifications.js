const lib = require('./_admin-lib');
const notify = require('./_notify-lib');
exports.handler = async event => {
  if (!['GET','POST'].includes(event.httpMethod)) return lib.json(405,{error:'Method not allowed'});
  try {
    const admin = await lib.requireAdmin(event);
    if (event.httpMethod === 'GET') {
      if (!process.env.RESEND_API_KEY) return lib.json(503,{error:'Email delivery is not configured.'});
      const after=String(event.queryStringParameters?.after||'');
      if(after&&!/^[0-9a-f-]{36}$/i.test(after))return lib.json(400,{error:'Invalid email cursor.'});
      const r = await fetch('https://api.resend.com/emails?limit=100'+(after?'&after='+encodeURIComponent(after):''),{headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`},signal:AbortSignal.timeout(6000)});
      const d = await r.json();
      if (!r.ok) return lib.json(502,{error:r.status===403?'The email key can send messages but cannot read delivery records. Delivery could not be verified.':'Email delivery records are currently unavailable.'});
      const providers = await lib.sbJson('/rest/v1/providers?select=primary_email');
      const accounts = await lib.sbJson('/rest/v1/provider_portal_users?select=email');
      const known = new Set(notify.normalizeEmails([...providers.map(p=>p.primary_email),...accounts.map(p=>p.email)]));
      const emails = (d.data||[]).filter(e=>(e.to||[]).some(a=>known.has(a.toLowerCase()))).map(e=>({id:e.id,to:e.to,subject:e.subject,created_at:e.created_at,last_event:e.last_event}));
      const suppressed=notify.normalizeEmails(emails.filter(e=>e.last_event==='suppressed').flatMap(e=>e.to));
      const suppressions=[];
      // Bound diagnostic requests to avoid exhausting the delivery service rate limit.
      for(const email of suppressed.slice(0,3)){
        try{const response=await fetch('https://api.resend.com/suppressions/'+encodeURIComponent(email),{headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`},signal:AbortSignal.timeout(2000)});if(response.ok){const x=await response.json();suppressions.push({email:x.email,origin:x.origin,created_at:x.created_at});}}catch{}
      }
      return lib.json(200,{emails,suppressions,has_more:!!d.has_more,next_cursor:d.has_more?d.data?.at(-1)?.id||null:null});
    }
    if (!lib.sameOrigin(event)) return lib.json(403,{error:'Invalid request origin'});
    const b = JSON.parse(event.body||'{}');
    const id = String(b.provider_id||'');
    const email = String(b.email||'').trim().toLowerCase();
    if (!/^[0-9a-f-]{36}$/i.test(id)||!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(email)||email.length>254) return lib.json(400,{error:'Valid Provider and notification email are required.'});
    const before = (await lib.sbJson(`/rest/v1/providers?select=id,display_name,primary_email&id=eq.${id}&limit=1`))[0];
    if (!before) return lib.json(404,{error:'Provider not found.'});
    if(b.action==='RESTORE_BOUNCED_EMAIL'){
      const permitted=notify.normalizeEmails([before.primary_email,...await notify.adminEmails()]);
      if(!permitted.includes(email))return lib.json(403,{error:'This email is not a current Provider or Administration notification recipient.'});
      const headers={Authorization:`Bearer ${process.env.RESEND_API_KEY}`};
      const url='https://api.resend.com/suppressions/'+encodeURIComponent(email);
      const response=await fetch(url,{headers,signal:AbortSignal.timeout(3000)});
      if(!response.ok)return lib.json(409,{error:'No verifiable bounce suppression was found.'});
      const suppression=await response.json();
      if(suppression.origin!=='bounce')return lib.json(409,{error:'Only bounce suppressions can be restored here. Complaint and manual blocks are preserved.'});
      await lib.sbJson('/rest/v1/provider_technical_history',{method:'POST',body:JSON.stringify({provider_id:id,event_type:'ADMIN_BOUNCE_RESTORATION_REQUESTED',event_label:'Notification delivery restoration requested',details:{email,suppression_id:suppression.id,origin:suppression.origin,blocked_at:suppression.created_at},actor_type:'ADMIN',actor_admin_user_id:admin.user.id})});
      await new Promise(resolve=>setTimeout(resolve,600));
      const removed=await fetch(url,{method:'DELETE',headers,signal:AbortSignal.timeout(3000)});
      if(!removed.ok)return lib.json(502,{error:'The bounce block could not be restored.'});
      await new Promise(resolve=>setTimeout(resolve,600));
      const notification=await notify.send({to:email,subject:'PLEASE — Email delivery verification',title:'Notification delivery restored',intro:'PLEASE Administration restored notification delivery after a previous mailbox bounce.',message:'This email verifies that PLEASE service notifications can reach this mailbox again.',idempotencyKey:`please-bounce-restored-${suppression.id}`});
      return lib.json(200,{ok:true,email,restored:true,notification});
    }
    const now = new Date().toISOString();
    const changed = await lib.sbJson(`/rest/v1/providers?id=eq.${id}&select=id,primary_email`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({primary_email:email,updated_at:now})});
    if (changed?.[0]?.primary_email!==email) throw Error('Notification email was not saved.');
    await lib.sbJson('/rest/v1/provider_technical_history',{method:'POST',body:JSON.stringify({provider_id:id,event_type:'ADMIN_NOTIFICATION_EMAIL_CHANGED',event_label:'Notification contact email updated',details:{old_email:before.primary_email,new_email:email},actor_type:'ADMIN',actor_admin_user_id:admin.user.id})});
    const notification = await notify.sendProvider(id,{subject:'PLEASE — Notification email verification',title:'Your notification email was updated',intro:`Hello ${before.display_name}, service assignment notifications will now be sent to this email.`,message:'Your existing portal login and password have not changed.',ctaLabel:'OPEN PROVIDER PORTAL',ctaUrl:`${notify.baseUrl()}/provider-login.html`,idempotencyKey:`provider-notification-email-${id}-${now}`});
    return lib.json(200,{ok:true,email,notification});
  } catch(e) { return lib.json(e.status===401?401:500,{error:e.status===401?'Unauthorized':'Unable to update or inspect provider notifications.'}); }
};
