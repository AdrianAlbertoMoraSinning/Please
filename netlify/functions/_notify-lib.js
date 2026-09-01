const adminLib=require('./_admin-lib');

const RESEND_ENDPOINT='https://api.resend.com/emails';
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean=(v,n=1000)=>String(v??'').trim().slice(0,n);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>`${Number(n||0).toFixed(2)} CAD`;

function extractAddress(value){const m=String(value||'').trim().match(/<([^<>]+)>\s*$/);return (m?m[1]:String(value||'')).trim().toLowerCase();}
function isPleaseSender(value){const d=(extractAddress(value).split('@')[1]||'');return d==='pleaseservice.ca'||d.endsWith('.pleaseservice.ca');}
function normalizeEmails(value){
  const arr=Array.isArray(value)?value:String(value||'').split(/[;,]/);
  const seen=new Set(),out=[];
  for(const raw of arr){const e=extractAddress(raw);if(EMAIL_RE.test(e)&&!seen.has(e)){seen.add(e);out.push(e);}}
  return out;
}
function baseUrl(){return clean(process.env.PLEASE_PUBLIC_SITE_URL||'https://pleaseservice.ca',500).replace(/\/$/,'');}
function replyTo(){return clean(process.env.PLEASE_EMAIL_REPLY_TO||'info@pleaseservice.ca',250);}
function fromAddress(){return clean(process.env.PLEASE_EMAIL_FROM||'',300);}
function configured(){return Boolean(process.env.RESEND_API_KEY&&fromAddress());}
function adminFallback(){return normalizeEmails(process.env.PLEASE_ADMIN_NOTIFY_EMAIL||process.env.PLEASE_APPLICATION_NOTIFY_EMAIL||'info@pleaseservice.ca');}

async function roleEmails(role){
  try{
    const rows=await adminLib.sbJson(`/rest/v1/admin_portal_users?select=email&active=eq.true&role=eq.${encodeURIComponent(role)}`);
    return normalizeEmails((rows||[]).map(x=>x.email));
  }catch(e){console.warn(`notify:role-emails:${role}`,e?.message||e);return[];}
}
async function adminEmails(){return normalizeEmails([...adminFallback(),...(await roleEmails('PLEASE_ADMIN'))]);}
async function developerEmails(){
  const env=normalizeEmails(process.env.PLEASE_DEVELOPER_NOTIFY_EMAIL||'');
  return normalizeEmails([...env,...(await roleEmails('DEVELOPER_ADMIN')),...adminFallback()]);
}
async function providerEmails(providerId){
  if(!providerId)return[];
  try{
    const q=encodeURIComponent(providerId);
    const [users,providers]=await Promise.all([
      adminLib.sbJson(`/rest/v1/provider_portal_users?select=email&provider_id=eq.${q}&active=eq.true`).catch(()=>[]),
      adminLib.sbJson(`/rest/v1/providers?select=primary_email&id=eq.${q}&limit=1`).catch(()=>[])
    ]);
    return normalizeEmails([...(users||[]).map(x=>x.email),providers?.[0]?.primary_email]);
  }catch(e){console.warn('notify:provider-emails',e?.message||e);return[];}
}
async function assignmentContext(assignmentId){
  if(!assignmentId)return null;
  const rows=await adminLib.sbJson(`/rest/v1/job_assignments?select=id,job_id,provider_id,status,scheduled_start,scheduled_end,assignment_message,providers(display_name,primary_email),jobs(id,reference,service_name,work_address,work_description,status,customers(first_name,last_name,email,phone))&id=eq.${encodeURIComponent(assignmentId)}&limit=1`);
  return rows?.[0]||null;
}
async function jobContext(jobId){
  if(!jobId)return null;
  const rows=await adminLib.sbJson(`/rest/v1/jobs?select=id,reference,service_name,work_address,work_description,status,estimated_duration_minutes,customers(first_name,last_name,email,phone)&id=eq.${encodeURIComponent(jobId)}&limit=1`);
  return rows?.[0]||null;
}
async function requestContext(requestId){
  if(!requestId)return null;
  const rows=await adminLib.sbJson(`/rest/v1/service_requests?select=id,reference,first_name,last_name,email,phone,service_name,status,preferred_date,preferred_start_time,job_id,cancellation_reason& id=eq.${encodeURIComponent(requestId)}&limit=1`.replace('reason& id','reason&id'));
  return rows?.[0]||null;
}
async function invoiceContext(invoiceId){
  if(!invoiceId)return null;
  const rows=await adminLib.sbJson(`/rest/v1/invoices?select=id,invoice_number,job_id,client_name,client_email,client_phone,total_amount,amount_paid,currency,status,payment_status,public_token,due_date,paid_at& id=eq.${encodeURIComponent(invoiceId)}&limit=1`.replace('paid_at& id','paid_at&id'));
  return rows?.[0]||null;
}
async function extensionContext(id){
  if(!id)return null;
  const rows=await adminLib.sbJson(`/rest/v1/job_extension_requests?select=id,job_id,assignment_id,provider_id,extra_minutes,reason,proposed_end,customer_addition,provider_addition,status,customer_approval_method,admin_note& id=eq.${encodeURIComponent(id)}&limit=1`.replace('admin_note& id','admin_note&id'));
  return rows?.[0]||null;
}
async function scheduleChangeContext(id){
  if(!id)return null;
  const rows=await adminLib.sbJson(`/rest/v1/assignment_schedule_change_requests?select=id,assignment_id,job_id,provider_id,current_start,current_end,proposed_start,proposed_end,provider_reason,status,admin_note& id=eq.${encodeURIComponent(id)}&limit=1`.replace('admin_note& id','admin_note&id'));
  return rows?.[0]||null;
}
async function providerPaymentContext(id){
  if(!id)return null;
  const rows=await adminLib.sbJson(`/rest/v1/provider_payments?select=id,payment_reference,job_id,provider_id,status,amount,currency,paid_at,payment_method,payment_reference_external,providers(display_name,primary_email),jobs(reference,service_name)&id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows?.[0]||null;
}
async function providerContext(providerId){
  if(!providerId)return null;
  const rows=await adminLib.sbJson(`/rest/v1/providers?select=id,reference,display_name,company_name,primary_email,status&id=eq.${encodeURIComponent(providerId)}&limit=1`);
  return rows?.[0]||null;
}
async function applicationContext(applicationId){
  if(!applicationId)return null;
  const rows=await adminLib.sbJson(`/rest/v1/provider_applications?select=id,reference,full_name,company_name,email,phone,service_trade,other_service_description,status,submitted_at,activated_provider_id&id=eq.${encodeURIComponent(applicationId)}&limit=1`);
  return rows?.[0]||null;
}

function formatDateTime(v){if(!v)return 'To be coordinated';try{return new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Edmonton'}).format(new Date(v));}catch{return String(v);}}
function detailRows(details=[]){return details.filter(x=>x&&x[1]!=null&&String(x[1]).trim()!=='').map(([k,v])=>`<tr><td style="padding:7px 10px;color:#59758f;font-size:12px;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e5eef6">${esc(k)}</td><td style="padding:7px 10px;font-weight:700;border-bottom:1px solid #e5eef6">${esc(v)}</td></tr>`).join('');}
function emailHtml({title,intro,details=[],message='',ctaLabel='',ctaUrl='',footer=''}){
  return `<!doctype html><html><body style="margin:0;background:#f3f7fb;font-family:Arial,Helvetica,sans-serif;color:#15283b"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:26px 12px;background:#f3f7fb"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:650px;background:#fff;border-radius:16px;overflow:hidden"><tr><td style="background:#075cb4;color:#fff;padding:26px 30px"><div style="font-size:12px;letter-spacing:1.5px;font-weight:700">PLEASE SERVICES</div><div style="font-size:25px;font-weight:800;margin-top:7px">${esc(title)}</div></td></tr><tr><td style="padding:28px 30px"><p style="margin-top:0">${esc(intro||'PLEASE notification')}</p>${details.length?`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f9fd;border-radius:10px;margin:20px 0">${detailRows(details)}</table>`:''}${message?`<p style="white-space:pre-line">${esc(message)}</p>`:''}${ctaUrl&&ctaLabel?`<p style="margin:24px 0"><a href="${esc(ctaUrl)}" style="display:inline-block;background:#075cb4;color:#fff;text-decoration:none;padding:13px 18px;border-radius:8px;font-weight:700">${esc(ctaLabel)} →</a></p>`:''}<p style="font-size:13px;color:#60758a;margin-bottom:0">${esc(footer||'Need help? Reply to this email or contact PLEASE at 587-836-2866.')}<br><br>PLEASE Services<br><strong>ANY SERVICE IN ONE PLACE!</strong></p></td></tr></table></td></tr></table></body></html>`;
}
function emailText({title,intro,details=[],message='',ctaLabel='',ctaUrl='',footer=''}){
  return [title,'',intro,...details.filter(x=>x&&x[1]!=null&&String(x[1]).trim()!=='').map(([k,v])=>`${k}: ${v}`),message?'\n'+message:'',ctaUrl?`\n${ctaLabel||'Open'}: ${ctaUrl}`:'',`\n${footer||'Need help? Reply to this email or contact PLEASE at 587-836-2866.'}`,'PLEASE Services','ANY SERVICE IN ONE PLACE!'].filter(Boolean).join('\n');
}

async function send({to,subject,title,intro,details=[],message='',ctaLabel='',ctaUrl='',footer='',idempotencyKey,replyToOverride}){
  const recipients=normalizeEmails(to);
  if(!recipients.length)return{sent:false,skipped:true,reason:'No valid recipient.'};
  const apiKey=process.env.RESEND_API_KEY,from=fromAddress(),reply=clean(replyToOverride||replyTo(),250);
  if(!apiKey||!from)return{sent:false,skipped:true,reason:'Email delivery is not configured.'};
  if(!isPleaseSender(from))return{sent:false,skipped:true,reason:'PLEASE_EMAIL_FROM must use pleaseservice.ca.'};
  const payload={from,to:recipients,subject:clean(subject,300),html:emailHtml({title,intro,details,message,ctaLabel,ctaUrl,footer}),text:emailText({title,intro,details,message,ctaLabel,ctaUrl,footer})};
  if(EMAIL_RE.test(extractAddress(reply)))payload.reply_to=extractAddress(reply);
  try{
    const headers={Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'};
    if(idempotencyKey)headers['Idempotency-Key']=clean(idempotencyKey,240);
    const controller=new AbortController();
    const timeoutMs=Math.max(1200,Math.min(6000,Number(process.env.PLEASE_EMAIL_FETCH_TIMEOUT_MS||2500)));
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    let r;
    try{r=await fetch(RESEND_ENDPOINT,{method:'POST',headers,body:JSON.stringify(payload),signal:controller.signal});}
    finally{clearTimeout(timer);}
    let data={};try{data=await r.json();}catch{}
    if(!r.ok)throw new Error(data?.message||data?.error||`Resend returned HTTP ${r.status}`);
    return{sent:true,id:data?.id||null,to:recipients};
  }catch(e){console.error('notify:send',subject,e);return{sent:false,error:e?.message||String(e),to:recipients};}
}
async function sendAdmins(opts){return send({...opts,to:await adminEmails()});}
async function sendDevelopers(opts){return send({...opts,to:await developerEmails()});}
async function sendProvider(providerId,opts){return send({...opts,to:await providerEmails(providerId)});}
async function sendCustomerByJob(jobId,opts){const j=await jobContext(jobId);const email=j?.customers?.email;return send({...opts,to:email});}

module.exports={
  clean,esc,money,normalizeEmails,isPleaseSender,baseUrl,replyTo,configured,formatDateTime,
  adminEmails,developerEmails,providerEmails,assignmentContext,jobContext,requestContext,invoiceContext,extensionContext,scheduleChangeContext,providerPaymentContext,providerContext,applicationContext,
  send,sendAdmins,sendDevelopers,sendProvider,sendCustomerByJob
};
