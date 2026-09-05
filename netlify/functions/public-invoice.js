const lib=require('./_admin-lib');
const pay=require('./_stripe-payment-lib');
// Customer-only item projection: invoice_items?select=id,description,qty,unit,unit_rate,line_total,sort_order

exports.handler=async event=>{
  if(event.httpMethod!=='GET') return lib.json(405,{error:'Method not allowed'});
  try{
    const token=String(event.queryStringParameters?.token||'').trim();
    const session_id=String(event.queryStringParameters?.session_id||'').trim();
    if(!pay.validToken(token)&&!pay.validSessionId(session_id)) return lib.json(400,{error:'This invoice link is invalid or incomplete.'});
    const inv=await pay.resolveInvoice({token,session_id});
    if(!inv) return lib.json(404,{error:'This invoice link is invalid, expired, or no longer attached to an available invoice.'});
    if(inv.status==='DRAFT') return lib.json(404,{error:'This invoice is not available yet.'});
    if(inv.status==='VOID') return lib.json(410,{error:'This invoice has been voided. Please contact PLEASE Services.'});
    const [items,tx]=await Promise.all([pay.invoiceItems(inv.id),pay.latestTransaction(inv.id)]);
    return lib.json(200,pay.publicPayload(inv,items,tx));
  }catch(e){console.error('public-invoice',e);return lib.json(500,{error:'Unable to load invoice right now. Please refresh or contact PLEASE Services.'})}
};
