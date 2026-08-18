const crypto=require('crypto');
const lib=require('./_admin-lib');
const security=require('./_security-lib');

const RESEND_ENDPOINT='https://api.resend.com/emails';
const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
const emailOk=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const FLEX=new Set(['EXACT','SAME_DAY','FLEXIBLE','ANYTIME']);
function ref(){return `PLS-REQ-${new Intl.DateTimeFormat('en-CA',{timeZone:'America/Edmonton',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;}
function hash(v){return crypto.createHash('sha256').update(v).digest('hex');}
function escapeHtml(value){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}
function friendlyDate(value){if(!value)return 'To be coordinated';try{return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Edmonton',month:'short',day:'numeric',year:'numeric'}).format(new Date(`${value}T12:00:00-06:00`));}catch{return value;}}
function friendlyTime(value){if(!value)return 'To be coordinated';const m=String(value).match(/^(\d{2}):(\d{2})/);if(!m)return value;let h=Number(m[1]);const min=m[2],suffix=h>=12?'PM':'AM';h=h%12||12;return `${h}:${min} ${suffix}`;}
function baseUrl(event){const configured=clean(process.env.PLEASE_PUBLIC_SITE_URL||'',500).replace(/\/$/,'');if(configured)return configured;const origin=clean(event.headers?.origin||event.headers?.Origin||'',500).replace(/\/$/,'');if(origin)return origin;const host=clean(event.headers?.host||event.headers?.Host||'',300);return host?`https://${host}`:'https://pleasewebportal.netlify.app';}

async function sendResendEmail(apiKey,payload,idempotencyKey){
  const response=await fetch(RESEND_ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify(payload)});
  let body={};try{body=await response.json();}catch{}
  if(!response.ok)throw new Error(body?.message||body?.error||`Resend returned HTTP ${response.status}`);
  return body;
}

function trackingEmailHtml({firstName,reference,serviceName,preferredDate,preferredTime,trackingUrl}){
  return `<!doctype html><html><body style="margin:0;background:#f3f7fb;font-family:Arial,Helvetica,sans-serif;color:#15283b">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7fb;padding:28px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fff;border-radius:16px;overflow:hidden">
      <tr><td style="background:#0b5fa8;padding:28px 32px;color:#fff"><div style="font-size:12px;letter-spacing:1.6px;font-weight:700">PLEASE SERVICES</div><div style="font-size:27px;font-weight:700;margin-top:8px">We received your service request</div></td></tr>
      <tr><td style="padding:30px 32px">
        <p style="margin-top:0">Hi ${escapeHtml(firstName)},</p>
        <p>Your request has been received by PLEASE. Our operations team will review the details and coordinate the service, schedule, provider availability and pricing with you.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef6fc;border-radius:10px;margin:22px 0"><tr><td style="padding:18px 20px">
          <div style="font-size:12px;color:#59758f;text-transform:uppercase;letter-spacing:1px">Request reference</div>
          <div style="font-size:21px;font-weight:700;color:#0b5fa8;margin-top:5px">${escapeHtml(reference)}</div>
          <div style="margin-top:14px"><strong>Service:</strong> ${escapeHtml(serviceName)}</div>
          <div style="margin-top:7px"><strong>Preferred schedule:</strong> ${escapeHtml(friendlyDate(preferredDate))} · ${escapeHtml(friendlyTime(preferredTime))}</div>
        </td></tr></table>
        <p style="margin:26px 0"><a href="${escapeHtml(trackingUrl)}" style="background:#0b5fa8;color:#fff;text-decoration:none;padding:14px 20px;border-radius:8px;font-weight:700;display:inline-block">TRACK YOUR REQUEST →</a></p>
        <p>You can also return to <strong>Track Request</strong> on the PLEASE website at any time and recover access using your Request Reference and the same email address used when submitting the request.</p>
        <p style="font-size:13px;color:#657687">This request is not an automatic booking. No provider or time is reserved until PLEASE confirms your service.</p>
        <p style="margin-bottom:0">Need help? Reply to this email or contact PLEASE at 587-836-2866.<br><br>PLEASE Services<br><strong>ANY SERVICE IN ONE PLACE!</strong></p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}
function trackingEmailText({firstName,reference,serviceName,preferredDate,preferredTime,trackingUrl}){
  return `Hi ${firstName},\n\nWe received your PLEASE service request.\n\nRequest Reference: ${reference}\nService: ${serviceName}\nPreferred schedule: ${friendlyDate(preferredDate)} · ${friendlyTime(preferredTime)}\n\nTrack your request:\n${trackingUrl}\n\nYou can also return to Track Request on the PLEASE website and recover access using your Request Reference and the same email address used when submitting the request.\n\nThis is a service request, not an automatic booking. No provider or time is reserved until PLEASE confirms your service.\n\nPLEASE Services\n587-836-2866\ninfo@pleaseservice.ca`;
}

exports.handler=async event=>{
  try{
    if(event.httpMethod==='GET'){
      const services=await lib.sbJson('/rest/v1/services?select=id,name,short_description&active=eq.true&order=sort_order.asc,name.asc');
      return lib.json(200,{services:services||[]});
    }
    if(event.httpMethod!=='POST') return lib.json(405,{error:'Method not allowed'});
    if(!lib.sameOrigin(event)) return lib.json(403,{error:'Invalid request origin'});
    const rl=await security.checkRateLimit(event,{endpoint:'public-service-request',limit:10,windowSeconds:3600});
    if(!rl.allowed) return lib.json(429,{error:'Too many service requests were submitted from this connection. Please wait and try again.'},{'Retry-After':String(rl.retryAfter)});
    const p=JSON.parse(event.body||'{}');
    const first=clean(p.first_name,100), last=clean(p.last_name,100), email=clean(p.email,200).toLowerCase(), phone=clean(p.phone,80);
    const serviceId=clean(p.service_id,60), address=clean(p.street_address,300), city=clean(p.city||'Calgary',120), province=clean(p.province||'AB',80), postal=clean(p.postal_code,30);
    const desc=clean(p.work_description,4000), notes=clean(p.customer_notes,2000), flexibility=clean(p.scheduling_flexibility||'FLEXIBLE',30).toUpperCase();
    if(!first||!email||!phone||!serviceId||!address||!desc) return lib.json(400,{error:'Please complete all required fields.'});
    if(!emailOk(email)) return lib.json(400,{error:'Please enter a valid email address.'});
    if(!FLEX.has(flexibility)) return lib.json(400,{error:'Invalid scheduling flexibility.'});
    const services=await lib.sbJson(`/rest/v1/services?select=id,name&id=eq.${encodeURIComponent(serviceId)}&active=eq.true&limit=1`);
    const service=services?.[0]; if(!service) return lib.json(400,{error:'Selected service is not available.'});
    const token=crypto.randomBytes(24).toString('hex');
    const reference=ref();
    const row={reference,tracking_token_hash:hash(token),first_name:first,last_name:last||null,email,phone,service_id:service.id,service_name:service.name,street_address:address,city,province,postal_code:postal||null,work_description:desc,preferred_date:p.preferred_date||null,preferred_start_time:p.preferred_start_time||null,scheduling_flexibility:flexibility,customer_notes:notes||null,status:'NEW'};
    const created=await lib.sbJson('/rest/v1/service_requests?select=id,reference,status,created_at',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(row)});
    const item=created?.[0];
    await lib.sbJson('/rest/v1/service_request_status_history',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({service_request_id:item.id,old_status:null,new_status:'NEW',note:'Customer service request submitted'})});

    // STEP 10.4.3 token table. Keep request submission successful even if a legacy
    // deployment does not yet have this table; tracking_token_hash remains authoritative fallback.
    try{
      await security.issueTrackingToken({serviceRequestId:item.id,tokenHash:hash(token),source:'INITIAL'});
    }catch(e){console.error('public-service-request:tracking-token-table',e);}

    const trackingUrl=`${baseUrl(event)}/track-request.html?token=${encodeURIComponent(token)}`;
    let emailSent=false,emailWarning=null;
    const resendApiKey=process.env.RESEND_API_KEY;
    const emailFrom=process.env.PLEASE_EMAIL_FROM;
    const replyTo=process.env.PLEASE_EMAIL_REPLY_TO||'info@pleaseservice.ca';
    if(resendApiKey&&emailFrom){
      try{
        await sendResendEmail(resendApiKey,{
          from:emailFrom,to:[email],reply_to:replyTo,
          subject:`PLEASE — Request Received (${item.reference})`,
          html:trackingEmailHtml({firstName:first,reference:item.reference,serviceName:service.name,preferredDate:p.preferred_date,preferredTime:p.preferred_start_time,trackingUrl}),
          text:trackingEmailText({firstName:first,reference:item.reference,serviceName:service.name,preferredDate:p.preferred_date,preferredTime:p.preferred_start_time,trackingUrl}),
          tags:[{name:'type',value:'service_request_tracking'},{name:'reference',value:item.reference.replace(/[^a-zA-Z0-9_-]/g,'_')}]
        },`please-service-request-${item.id}`);
        emailSent=true;
      }catch(e){emailWarning=e.message||'Email delivery failed';console.error('public-service-request:tracking-email',e);}
    }else{
      emailWarning='Email delivery is not configured yet.';
      console.warn('public-service-request:tracking-email EMAIL_NOT_CONFIGURED');
    }

    return lib.json(201,{reference:item.reference,status:item.status,tracking_token:token,tracking_url:trackingUrl,email_sent:emailSent,email_warning:emailWarning,message:'Your request has been received by PLEASE.'});
  }catch(e){console.error('public-service-request',e);return lib.json(e.status||500,{error:e.message||'Unable to submit request.'});}
};
