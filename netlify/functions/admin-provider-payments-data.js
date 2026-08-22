const lib=require('./_admin-lib');
async function safe(path,fallback=[]){
  try{return await lib.sbJson(path)}catch(e){
    console.warn('admin-provider-payments-data optional query failed',path,e?.message||e);
    return fallback;
  }
}
exports.handler=async event=>{
  if(event.httpMethod!=='GET') return lib.json(405,{error:'Method not allowed'});
  try{
    await lib.requireAdmin(event);
    // Core data first. Use a legacy-compatible payments query if STEP 14 financial fields are not present yet.
    let payments;
    try{
      payments=await lib.sbJson('/rest/v1/provider_payments?select=id,payment_reference,job_id,assignment_id,provider_id,status,amount,currency,needs_rate_review,paid_at,payment_method,payment_reference_external,payment_note,advance_applied,cash_paid,created_at,updated_at,providers(id,display_name,company_name),jobs(id,reference,service_name,completed_at,customers(first_name,last_name,email,phone))&order=created_at.desc');
    }catch(e){
      console.warn('provider_payments STEP14 fields unavailable, using legacy query',e?.message||e);
      payments=await lib.sbJson('/rest/v1/provider_payments?select=id,payment_reference,job_id,assignment_id,provider_id,status,amount,currency,needs_rate_review,paid_at,payment_method,payment_reference_external,payment_note,created_at,updated_at,providers(id,display_name,company_name),jobs(id,reference,service_name,completed_at,customers(first_name,last_name,email,phone))&order=created_at.desc');
      payments=(payments||[]).map(x=>({...x,advance_applied:0,cash_paid:x.status==='PAID'?x.amount:null}));
    }
    const [items,providers,jobs,advances]=await Promise.all([
      safe('/rest/v1/provider_payment_items?select=id,provider_payment_id,job_billing_item_id,service_name,description,quantity,unit,provider_unit_rate,line_total,sort_order&order=sort_order.asc,id.asc'),
      lib.sbJson('/rest/v1/providers?select=id,display_name,company_name,status&order=display_name.asc'),
      lib.sbJson('/rest/v1/jobs?select=id,reference,status,completed_at&order=completed_at.desc.nullslast'),
      safe('/rest/v1/provider_advances?select=id,provider_id,job_id,amount,applied_amount,method,reference,note,status,paid_at,created_at&order=created_at.desc')
    ]);
    return lib.json(200,{payments:payments||[],items:items||[],providers:providers||[],jobs:jobs||[],advances:advances||[]});
  }catch(e){console.error('admin-provider-payments-data',e);return lib.json(e.status||500,{error:e.status===401?'Unauthorized':(e.message||'Unable to load provider payments.')});}
};
