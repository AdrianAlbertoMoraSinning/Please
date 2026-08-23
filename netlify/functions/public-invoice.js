const lib=require('./_admin-lib');
exports.handler=async event=>{
  if(event.httpMethod!=='GET') return lib.json(405,{error:'Method not allowed'});
  try{
    const token=String(event.queryStringParameters?.token||'').trim();
    if(!/^[a-f0-9]{20,80}$/i.test(token)) return lib.json(400,{error:'Invalid invoice link.'});
    const rows=await lib.sbJson(`/rest/v1/invoices?select=id,invoice_number,public_token,client_name,invoice_date,due_date,subtotal,gst_rate,gst_amount,total_amount,currency,amount_paid,status,payment_status,note,issued_at,sent_at,paid_at&public_token=eq.${encodeURIComponent(token)}&limit=1`);
    const inv=Array.isArray(rows)?rows[0]:null;
    if(!inv||inv.status==='DRAFT'||inv.status==='VOID') return lib.json(404,{error:'Invoice is not available.'});
    const items=await lib.sbJson(`/rest/v1/invoice_items?select=id,description,qty,unit,unit_rate,line_total,sort_order&invoice_id=eq.${inv.id}&order=sort_order.asc,id.asc`);
    // STEP 15.4: defensive customer-only projection. Never expose Job/Provider compensation fields through a public invoice link.
    const customerItems=(items||[]).map(x=>({id:x.id,description:x.description,qty:x.qty,unit:x.unit,unit_rate:x.unit_rate,line_total:x.line_total,sort_order:x.sort_order}));
    return lib.json(200,{invoice:inv,items:customerItems,stripe_enabled:Boolean(process.env.STRIPE_SECRET_KEY)});
  }catch(e){console.error('public-invoice',e);return lib.json(500,{error:'Unable to load invoice.'})}
};
