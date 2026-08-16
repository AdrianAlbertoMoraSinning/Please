const lib = require('./_admin-lib');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return lib.json(405,{error:'Method not allowed'});
  try {
    if (!lib.sameOrigin(event)) return lib.json(403,{error:'Forbidden'});
    const auth = await lib.requireAdmin(event);
    let body={}; try { body=JSON.parse(event.body||'{}'); } catch { return lib.json(400,{error:'Invalid JSON'}); }
    const action=String(body.action||'').trim().toUpperCase();
    if (!action) return lib.json(400,{error:'Action is required'});
    if(action==='CREATE_AND_ASSIGN'){
      const payload=body.payload||{};
      const billingType=String(payload.billing_type||'').toUpperCase();
      const customerRate=Number(payload.customer_rate);
      const qty=Number(payload.billable_quantity);
      const unit=String(payload.billing_unit||'').trim().toLowerCase();
      if(!['HOURLY','FLAT_RATE'].includes(billingType) || !Number.isFinite(customerRate) || customerRate<=0 || !Number.isFinite(qty) || qty<=0 || !['hour','service'].includes(unit)){
        return lib.json(400,{error:'Billing type and a customer rate greater than $0 are required.'});
      }
    }
    const result=await lib.sbJson('/rest/v1/rpc/please_portal_job_action',{
      method:'POST', headers:{Prefer:'return=representation'},
      body:JSON.stringify({p_actor:auth.user.id,p_action:action,p_payload:body.payload||{}})
    });
    const value=Array.isArray(result)?result[0]:result;
    if(action==='CREATE_AND_ASSIGN' && value?.job_id){
      const payload=body.payload||{};
      const billingType=String(payload.billing_type||'').toUpperCase();
      const customerRate=Math.round((Number(payload.customer_rate)||0)*100)/100;
      const qty=Math.round((Number(payload.billable_quantity)||0)*100)/100;
      const unit=String(payload.billing_unit||'').trim().toLowerCase();
      if(!['HOURLY','FLAT_RATE'].includes(billingType) || customerRate<=0 || qty<=0 || !['hour','service'].includes(unit)){
        return lib.json(400,{error:'Valid customer billing information is required.'});
      }
      await lib.sbJson(`/rest/v1/jobs?id=eq.${encodeURIComponent(value.job_id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({billing_type:billingType,customer_rate:customerRate,billable_quantity:qty,billing_unit:unit,quoted_subtotal:Math.round(customerRate*qty*100)/100,updated_at:new Date().toISOString()})});
    }
    return lib.json(200,value||{ok:true});
  } catch(e) {
    console.error('admin-job-action',e);
    let message=e.message||'Job action failed.';
    if (/exclusion|job_assignments_no_provider_overlap|conflict/i.test(message)) message='That provider already has an assignment overlapping the selected time.';
    return lib.json(e.status||400,{error:message});
  }
};
