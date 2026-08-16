const lib=require('./_admin-lib');
exports.handler=async event=>{
  if(event.httpMethod!=='GET') return lib.json(405,{error:'Method not allowed'});
  try{
    await lib.requireAdmin(event);
    const [payments,items,providers,jobs]=await Promise.all([
      lib.sbJson('/rest/v1/provider_payments?select=id,payment_reference,job_id,assignment_id,provider_id,status,amount,currency,needs_rate_review,paid_at,payment_method,payment_reference_external,payment_note,created_at,updated_at,providers(id,display_name,company_name),jobs(id,reference,service_name,completed_at,customers(first_name,last_name,email,phone))&order=created_at.desc'),
      lib.sbJson('/rest/v1/provider_payment_items?select=id,provider_payment_id,job_billing_item_id,service_name,description,quantity,unit,provider_unit_rate,line_total,sort_order&order=sort_order.asc,id.asc'),
      lib.sbJson('/rest/v1/providers?select=id,display_name,company_name,status&order=display_name.asc'),
      lib.sbJson('/rest/v1/jobs?select=id,reference,status,completed_at&order=completed_at.desc.nullslast')
    ]);
    return lib.json(200,{payments:payments||[],items:items||[],providers:providers||[],jobs:jobs||[]});
  }catch(e){console.error('admin-provider-payments-data',e);return lib.json(e.status||500,{error:e.status===401?'Unauthorized':'Unable to load provider payments.'});}
};
