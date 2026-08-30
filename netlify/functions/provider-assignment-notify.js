const lib=require('./_admin-lib');

function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function emailAddress(value){const m=String(value||'').trim().match(/<([^<>]+)>\s*$/);return (m?m[1]:String(value||'')).trim().toLowerCase();}
function isPleaseEmail(value){const d=(emailAddress(value).split('@')[1]||'');return d==='pleaseservice.ca'||d.endsWith('.pleaseservice.ca');}

exports.handler=async event=>{
  if(event.httpMethod!=='POST') return lib.json(405,{error:'Method not allowed'});
  try{
    if(!lib.sameOrigin(event)) return lib.json(403,{error:'Forbidden'});
    await lib.requireAdmin(event);
    const {assignment_id}=JSON.parse(event.body||'{}');
    if(!assignment_id) return lib.json(400,{error:'Assignment ID is required'});

    const apiKey=process.env.RESEND_API_KEY;
    const emailFrom=process.env.PLEASE_EMAIL_FROM;
    const replyTo=process.env.PLEASE_EMAIL_REPLY_TO||'info@pleaseservice.ca';
    if(!apiKey||!emailFrom) return lib.json(200,{ok:true,skipped:true,reason:'Email delivery is not configured yet.'});
    if(!isPleaseEmail(emailFrom)||!isPleaseEmail(replyTo)) return lib.json(503,{error:'Email delivery blocked because PLEASE email settings do not use the pleaseservice.ca domain.',code:'EMAIL_DOMAIN_MISMATCH'});

    const id=encodeURIComponent(assignment_id);
    const rows=await lib.sbJson(`/rest/v1/job_assignments?select=id,scheduled_start,scheduled_end,assignment_message,status,providers(display_name,primary_email),jobs(reference,service_name,work_address,work_description,estimated_duration_minutes)&id=eq.${id}&limit=1`);
    const a=rows?.[0]; if(!a) return lib.json(404,{error:'Assignment not found'});
    const email=a.providers?.primary_email; if(!email) return lib.json(200,{ok:true,skipped:true,reason:'Provider email is unavailable.'});
    const j=a.jobs||{};
    const html=`<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto"><h2>New PLEASE Service Assignment</h2><p>Hello ${esc(a.providers?.display_name||'Service Provider')},</p><p>PLEASE has assigned a service request for your confirmation.</p><p><strong>${esc(j.reference||'')}</strong><br>${esc(j.service_name||'')}<br>${esc(new Date(a.scheduled_start).toLocaleString('en-CA',{timeZone:'America/Edmonton'}))} – ${esc(new Date(a.scheduled_end).toLocaleTimeString('en-CA',{timeZone:'America/Edmonton'}))}<br>${esc(j.work_address||'')}</p><p>${esc(j.work_description||'')}</p>${a.assignment_message?`<p><strong>PLEASE note:</strong> ${esc(a.assignment_message)}</p>`:''}<p>Please sign in to your Provider Portal to confirm or decline this assignment.</p><p style="margin:24px 0"><a href="${esc((process.env.PLEASE_PUBLIC_SITE_URL||'https://pleaseservice.ca').replace(/\/$/,'')+'/provider-login.html?next=assignments')}" style="display:inline-block;background:#075cb4;color:#fff;text-decoration:none;padding:13px 18px;border-radius:8px;font-weight:700">OPEN PROVIDER PORTAL →</a></p><p style="font-size:13px;color:#60758a">Portal link: ${esc((process.env.PLEASE_PUBLIC_SITE_URL||'https://pleaseservice.ca').replace(/\/$/,'')+'/provider-login.html?next=assignments')}</p></div>`;
    const payload={from:emailFrom,to:[email],subject:`PLEASE Assignment — ${j.reference||'Service Request'}`,html,reply_to:replyTo};
    const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':`please-assignment-${assignment_id}`},body:JSON.stringify(payload)});
    const t=await r.text(); if(!r.ok) throw new Error(`Email provider error (${r.status}): ${t.slice(0,300)}`);
    return lib.json(200,{ok:true,sent:true});
  }catch(e){console.error('provider-assignment-notify',e);return lib.json(e.status||500,{error:e.message||'Unable to send provider notification.'});}
};
