const lib=require('./_admin-lib');

exports.handler=async event=>{
  if(event.httpMethod!=='GET') return lib.json(405,{error:'Method not allowed'});
  try{
    await lib.requireAdmin(event);
    const [invoices,items,jobs,transactions,history]=await Promise.all([
      lib.sbJson('/rest/v1/invoices?select=id,invoice_number,job_id,customer_id,public_token,client_name,client_email,client_phone,invoice_date,subtotal,gst_rate,gst_amount,total_amount,currency,amount_paid,status,payment_status,payment_method,payment_reference,stripe_checkout_session_id,stripe_payment_intent_id,note,issued_at,sent_at,due_date,paid_at,voided_at,void_reason,created_at,updated_at&order=created_at.desc'),
      lib.sbJson('/rest/v1/invoice_items?select=id,invoice_id,description,qty,unit,unit_rate,line_total,sort_order&order=sort_order.asc,id.asc'),
      lib.sbJson('/rest/v1/jobs?select=id,reference,customer_id,service_id,service_name,work_address,work_description,estimated_duration_minutes,status,created_at,customers(id,first_name,last_name,email,phone)&order=created_at.desc'),
      lib.sbJson('/rest/v1/payment_transactions?select=id,invoice_id,amount,currency,provider,status,external_reference,stripe_checkout_session_id,stripe_payment_intent_id,note,created_at&order=created_at.desc'),
      lib.sbJson('/rest/v1/invoice_status_history?select=id,invoice_id,old_status,new_status,old_payment_status,new_payment_status,note,source,changed_at&order=changed_at.desc')
    ]);
    return lib.json(200,{invoices:invoices||[],items:items||[],jobs:jobs||[],transactions:transactions||[],history:history||[],stripe_enabled:Boolean(process.env.STRIPE_SECRET_KEY)});
  }catch(e){
    console.error('admin-invoices-data',e);
    return lib.json(e.status||500,{error:e.status===401?'Unauthorized':'Unable to load invoices.'});
  }
};
