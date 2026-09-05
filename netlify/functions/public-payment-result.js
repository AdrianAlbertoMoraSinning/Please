const lib=require('./_admin-lib');
const pay=require('./_stripe-payment-lib');

exports.handler=async event=>{
  if(event.httpMethod!=='GET') return lib.json(405,{error:'Method not allowed'});
  try{
    const token=String(event.queryStringParameters?.token||'').trim();
    const session_id=String(event.queryStringParameters?.session_id||'').trim();
    if(!pay.validToken(token)&&!pay.validSessionId(session_id)) return lib.json(400,{error:'Payment result link is incomplete.'});
    const inv=await pay.resolveInvoice({token,session_id});
    if(!inv) return lib.json(404,{error:'Payment result is not available yet. Please open the original invoice link or contact PLEASE Services.'});
    if(inv.status==='DRAFT') return lib.json(404,{error:'This invoice is not available yet.'});
    if(inv.status==='VOID') return lib.json(410,{error:'This invoice has been voided. Please contact PLEASE Services.'});
    const [items,tx]=await Promise.all([pay.invoiceItems(inv.id),pay.latestTransaction(inv.id)]);
    const payload=pay.publicPayload(inv,items,tx);
    payload.payment_result={
      requested_session_id:session_id||null,
      invoice_status:inv.status,
      payment_status:inv.payment_status,
      paid:pay.paid(inv),
      pending:String(inv.payment_status||'').toUpperCase()==='PENDING',
      balance:pay.balance(inv),
      session_matches:session_id?String(inv.stripe_checkout_session_id||'')===session_id:null
    };
    return lib.json(200,payload);
  }catch(e){console.error('public-payment-result',e);return lib.json(500,{error:'Unable to confirm payment result right now.'})}
};
