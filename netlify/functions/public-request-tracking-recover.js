const crypto=require('crypto');
const lib=require('./_admin-lib');
const security=require('./_security-lib');

const clean=(v,n=240)=>String(v??'').trim().slice(0,n);
const hash=v=>crypto.createHash('sha256').update(String(v||'')).digest('hex');
const newTrackingToken=()=>crypto.randomBytes(24).toString('hex');
const emailOk=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const refOk=v=>/^PLS-REQ-\d{8}-[A-F0-9]{6}$/i.test(v);

async function audit(event,reference,email,successful){
  try{
    await lib.sbJson('/rest/v1/service_request_tracking_recovery_audit',{
      method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({
        request_reference:reference||null,
        email_hash:email?hash(email.toLowerCase()):null,
        successful:!!successful,
        ip_address:lib.requestIp(event)||null,
        user_agent:lib.requestUserAgent(event)||null
      })
    });
  }catch(e){console.error('tracking-recovery-audit',e);}
}

exports.handler=async event=>{
  if(event.httpMethod!=='POST') return lib.json(405,{error:'Method not allowed'});
  try{
    if(!lib.sameOrigin(event)) return lib.json(403,{error:'Invalid request origin'});
    const p=JSON.parse(event.body||'{}');
    const reference=clean(p.reference,40).toUpperCase();
    const email=clean(p.email,200).toLowerCase();
    const rl=await security.checkRateLimit(event,{endpoint:'tracking-recovery',limit:20,windowSeconds:900,identity:reference});
    if(!rl.allowed) return lib.json(429,{error:'Too many tracking recovery attempts. Please wait a few minutes and try again.'},{'Retry-After':String(rl.retryAfter)});
    const generic='We could not find a matching request. Check the reference and email and try again.';
    if(!refOk(reference)||!emailOk(email)){
      await audit(event,reference,email,false);
      return lib.json(404,{error:generic});
    }
    const rows=await lib.sbJson(`/rest/v1/service_requests?select=id,reference,email&reference=eq.${encodeURIComponent(reference)}&limit=1`);
    const req=rows?.[0];
    if(!req||String(req.email||'').trim().toLowerCase()!==email){
      await audit(event,reference,email,false);
      return lib.json(404,{error:generic});
    }
    const token=newTrackingToken();
    await security.issueTrackingToken({serviceRequestId:req.id,tokenHash:hash(token),source:'CUSTOMER_RECOVERY'});
    await audit(event,reference,email,true);
    return lib.json(200,{reference:req.reference,tracking_token:token});
  }catch(e){
    console.error('public-request-tracking-recover',e);
    return lib.json(e.status||500,{error:'Unable to recover request tracking right now.'});
  }
};
