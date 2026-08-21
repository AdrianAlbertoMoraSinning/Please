const lib=require('./_admin-lib');
const money=n=>Math.round((Number(n)||0)*100)/100;
exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  try{
    if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid origin'});
    const auth=await lib.requireAdmin(event),body=JSON.parse(event.body||'{}'),action=String(body.action||'').toUpperCase(),id=String(body.payment_id||'');
    if(!id)return lib.json(400,{error:'Provider payment is required.'});
    const rows=await lib.sbJson(`/rest/v1/provider_payments?select=*&id=eq.${encodeURIComponent(id)}&limit=1`),p=rows?.[0];
    if(!p)return lib.json(404,{error:'Provider payment not found.'});
    if(action==='MARK_PAID'){
      if(p.status==='PAID')return lib.json(409,{error:'Provider payment is already marked paid.'});
      if(p.needs_rate_review)return lib.json(409,{error:'Provider payment needs rate review before it can be marked paid.'});
      const method=String(body.payment_method||'E-TRANSFER').trim().slice(0,80)||'E-TRANSFER';
      const ref=String(body.payment_reference||'').trim().slice(0,250)||null;
      const note=String(body.note||'').trim().slice(0,1000)||null;
      // Apply available advances to this payable before recording the remaining cash/e-transfer amount.
      const advances=await lib.sbJson(`/rest/v1/provider_advances?select=id,amount,applied_amount,job_id,status&provider_id=eq.${encodeURIComponent(p.provider_id)}&status=eq.PAID&order=paid_at.asc.nullslast,created_at.asc`);
      let remaining=money(p.amount),advanceApplied=0;
      for(const a of advances||[]){if(a.job_id&&a.job_id!==p.job_id)continue;const available=money(Number(a.amount||0)-Number(a.applied_amount||0));if(available<=0||remaining<=0)continue;const use=money(Math.min(available,remaining));await lib.sbJson(`/rest/v1/provider_advances?id=eq.${encodeURIComponent(a.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({applied_amount:money(Number(a.applied_amount||0)+use)})});advanceApplied=money(advanceApplied+use);remaining=money(remaining-use);}
      const patch={status:'PAID',paid_at:new Date().toISOString(),payment_method:method,payment_reference_external:ref,payment_note:note,paid_by_admin_portal_user:auth.user.id,advance_applied:advanceApplied,cash_paid:remaining,updated_at:new Date().toISOString()};
      await lib.sbJson(`/rest/v1/provider_payments?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(patch)});
      return lib.json(200,{ok:true,status:'PAID',amount:money(p.amount),advance_applied:advanceApplied,cash_paid:remaining});
    }
    return lib.json(400,{error:'Unknown action.'});
  }catch(e){console.error('admin-provider-payment-action',e);return lib.json(e.status||500,{error:e.message||'Provider payment action failed.'});}
};
