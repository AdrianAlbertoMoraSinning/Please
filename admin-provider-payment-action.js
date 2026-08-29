const lib=require('./_admin-lib');
const notify=require('./_notify-lib');
const money=n=>Math.round((Number(n)||0)*100)/100;
const isSchemaMissing=e=>{
  const m=String(e?.message||e||'').toLowerCase();
  return e?.status===404 || m.includes('schema cache') || m.includes('could not find the table') || m.includes('could not find the') || m.includes('column');
};
exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  try{
    if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid origin'});
    const auth=await lib.requireAdmin(event),body=JSON.parse(event.body||'{}'),action=String(body.action||'').toUpperCase(),id=String(body.payment_id||'');
    if(!id)return lib.json(400,{error:'Provider payment is required.'});
    const rows=await lib.sbJson(`/rest/v1/provider_payments?select=*&id=eq.${encodeURIComponent(id)}&limit=1`),p=rows?.[0];
    if(!p)return lib.json(404,{error:'Provider payment not found.'});
    if(action==='MARK_PAID'){
      if(p.status==='PAID')return lib.json(200,{ok:true,status:'PAID',already_paid:true,amount:money(p.amount),advance_applied:money(p.advance_applied||0),cash_paid:money(p.cash_paid==null?p.amount:p.cash_paid)});
      if(p.needs_rate_review)return lib.json(409,{error:'Provider payment needs rate review before it can be marked paid.'});
      const method=String(body.payment_method||'E-TRANSFER').trim().slice(0,80)||'E-TRANSFER';
      const ref=String(body.payment_reference||'').trim().slice(0,250)||null;
      const note=String(body.payment_note ?? body.note ?? '').trim().slice(0,1000)||null;

      // STEP 14 advances are optional during staged deployments. If the table is not yet
      // available, marking a provider payment must still work and simply records the full
      // amount as cash/e-transfer paid.
      let remaining=money(p.amount),advanceApplied=0,advancesEnabled=true;
      let advances=[];
      try{
        advances=await lib.sbJson(`/rest/v1/provider_advances?select=id,amount,applied_amount,job_id,status&provider_id=eq.${encodeURIComponent(p.provider_id)}&status=eq.PAID&order=paid_at.asc.nullslast,created_at.asc`);
      }catch(e){
        if(!isSchemaMissing(e))throw e;
        advancesEnabled=false;
        console.warn('provider_advances unavailable; MARK_PAID continuing without advance reconciliation',e?.message||e);
      }
      if(advancesEnabled){
        for(const a of advances||[]){
          if(a.job_id&&a.job_id!==p.job_id)continue;
          const available=money(Number(a.amount||0)-Number(a.applied_amount||0));
          if(available<=0||remaining<=0)continue;
          const use=money(Math.min(available,remaining));
          await lib.sbJson(`/rest/v1/provider_advances?id=eq.${encodeURIComponent(a.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({applied_amount:money(Number(a.applied_amount||0)+use)})});
          advanceApplied=money(advanceApplied+use);remaining=money(remaining-use);
        }
      }

      const now=new Date().toISOString();
      const basePatch={status:'PAID',paid_at:now,payment_method:method,payment_reference_external:ref,payment_note:note,paid_by_admin_portal_user:auth.user.id,updated_at:now};
      const step14Patch={...basePatch,advance_applied:advanceApplied,cash_paid:remaining};
      try{
        await lib.sbJson(`/rest/v1/provider_payments?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(step14Patch)});
      }catch(e){
        if(!isSchemaMissing(e))throw e;
        console.warn('STEP14 provider payment columns unavailable; using legacy MARK_PAID patch',e?.message||e);
        await lib.sbJson(`/rest/v1/provider_payments?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(basePatch)});
        advanceApplied=0;remaining=money(p.amount);
      }
      const ctx=await notify.providerPaymentContext(id).catch(()=>null),n=await notify.sendProvider(p.provider_id,{subject:`PLEASE — Provider Payment Paid (${ctx?.payment_reference||p.payment_reference||'Payment'})`,title:'PLEASE provider payment completed',intro:`Hello ${ctx?.providers?.display_name||'Provider'}, PLEASE recorded your provider payment as paid.`,details:[['Payment',ctx?.payment_reference||p.payment_reference],['Job',ctx?.jobs?.reference||''],['Service',ctx?.jobs?.service_name||''],['Total provider payment',notify.money(p.amount)],['Advance applied',notify.money(advanceApplied)],['Paid now',notify.money(remaining)],['Method',method],['Reference',ref||'—']],message:note||'',ctaLabel:'Open Provider Portal',ctaUrl:`${notify.baseUrl()}/provider.html#history`,idempotencyKey:`please-provider-payment-paid-${id}`});
      return lib.json(200,{ok:true,status:'PAID',amount:money(p.amount),advance_applied:advanceApplied,cash_paid:remaining,advances_enabled:advancesEnabled,notification_sent:!!n?.sent});
    }
    return lib.json(400,{error:'Unknown action.'});
  }catch(e){console.error('admin-provider-payment-action',e);return lib.json(e.status||500,{error:e.message||'Provider payment action failed.'});}
};
