const lib=require('./_admin-lib');
const notify=require('./_notify-lib');
const AGREEMENT_VERSION='CAL-LEGAL-1.0-2026-09-05';
const AGREEMENT_EFFECTIVE='2026-09-05';
const enc=v=>encodeURIComponent(String(v??''));
const clean=(v,n=1000)=>String(v??'').trim().slice(0,n);
exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  try{
    if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid origin'});
    const auth=await lib.requireAdmin(event);
    const body=JSON.parse(event.body||'{}');
    if(!body.agreementAccepted)return lib.json(400,{error:'Agreement acceptance is required.'});
    const signerName=clean(body.signerName,200),signerEmail=clean(body.signerEmail||auth.user.email,250),signatureText=clean(body.signatureText,250);
    if(!signerName||!signatureText)return lib.json(400,{error:'Signer name and signature are required.'});
    const payload={agreement_version:AGREEMENT_VERSION,agreement_effective_date:AGREEMENT_EFFECTIVE,external_user_id:auth.user.id,external_user_email:auth.user.email,legal_company_name:clean(body.legalCompanyName||'PLEASE Services',250),signer_name:signerName,signer_title:clean(body.signerTitle||'Authorized User',160),signer_email:signerEmail,signature_text:signatureText,acceptance_method:clean(body.acceptanceMethod||'ELECTRONIC_SIGNATURE',80),metadata:{source:'PLEASE_CAL_PORTAL',admin_user_id:auth.user.id,admin_user_email:auth.user.email,user_agent:lib.requestUserAgent(event),ip_address:lib.requestIp(event)}};
    const existing=await lib.sbJson(`/rest/v1/accounting_legal_acceptances?select=id&external_user_id=eq.${enc(auth.user.id)}&agreement_version=eq.${enc(AGREEMENT_VERSION)}&limit=1`).catch(()=>[]);
    let record;
    if(existing?.[0]){
      record=await lib.sbJson(`/rest/v1/accounting_legal_acceptances?id=eq.${enc(existing[0].id)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({...payload,accepted_at:new Date().toISOString()})});
    }else{
      record=await lib.sbJson('/rest/v1/accounting_legal_acceptances',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(payload)});
    }
    const legalCopy=process.env.CAL_LEGAL_COPY_EMAIL||'adrian.alberto.mora.sinning@gmail.com';
    const sent=await notify.send({to:legalCopy,subject:`CAL Agreement Accepted — ${payload.legal_company_name}`,title:'CAL Data Custody Agreement accepted',intro:'A CAL user accepted the current Disclaimer & Data Custody agreement.',details:[['Agreement',AGREEMENT_VERSION],['Company',payload.legal_company_name],['Signer',payload.signer_name],['Signer email',payload.signer_email],['Method',payload.acceptance_method],['Accepted at',new Date().toISOString()]],idempotencyKey:`cal-legal-${auth.user.id}-${AGREEMENT_VERSION}`});
    return lib.json(200,{ok:true,agreement_version:AGREEMENT_VERSION,notification_sent:!!sent?.sent,record:record?.[0]||null});
  }catch(e){console.error('cal-legal-acceptance',e);return lib.json(e.status||500,{error:e.message||'Legal acceptance could not be recorded. Run STEP16.0 SQL first if the accounting table is missing.'});}
};
