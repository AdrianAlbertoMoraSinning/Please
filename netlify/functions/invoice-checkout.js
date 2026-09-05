const lib=require('./_admin-lib');
const security=require('./_security-lib');
const pay=require('./_stripe-payment-lib');

exports.handler=async event=>{
  if(event.httpMethod!=='POST') return lib.json(405,{error:'Method not allowed'});
  try{
    if(!lib.sameOrigin(event)) return lib.json(403,{error:'Invalid origin'});
    const rl=await security.checkRateLimit(event,{endpoint:'invoice-checkout',limit:20,windowSeconds:900});
    if(!rl.allowed)return lib.json(429,{error:'Too many payment attempts. Please wait and try again.'},{'Retry-After':String(rl.retryAfter)});
    const secret=process.env.STRIPE_SECRET_KEY;
    if(!secret) return lib.json(503,{error:'Online card payment is not activated yet. Please contact PLEASE Services.'});
    const body=JSON.parse(event.body||'{}'),token=String(body.token||'').trim();
    if(!pay.validToken(token)) return lib.json(400,{error:'Invalid invoice link.'});
    const inv=await pay.invoiceByToken(token);
    if(!inv||!['ISSUED','SENT','OVERDUE','PAID'].includes(inv.status)) return lib.json(404,{error:'Invoice is not payable.'});
    if(pay.paid(inv)) return lib.json(409,{error:'Invoice is already paid.'});
    const balance=pay.balance(inv);
    const cents=Math.round(balance*100);
    if(cents<50) return lib.json(409,{error:'No payable balance remains.'});
    const origin=event.headers.origin||`https://${event.headers.host}`;
    const form=new URLSearchParams();
    form.set('mode','payment');
    form.set('client_reference_id',inv.invoice_number);
    if(inv.client_email) form.set('customer_email',inv.client_email);
    form.set('line_items[0][quantity]','1');
    form.set('line_items[0][price_data][currency]',String(inv.currency||'CAD').toLowerCase());
    form.set('line_items[0][price_data][unit_amount]',String(cents));
    form.set('line_items[0][price_data][product_data][name]',`PLEASE Services — ${inv.invoice_number}`);
    form.set('metadata[invoice_id]',inv.id);
    form.set('metadata[invoice_number]',inv.invoice_number);
    form.set('success_url',`${origin}/payment-success.html?token=${encodeURIComponent(token)}&session_id={CHECKOUT_SESSION_ID}`);
    form.set('cancel_url',`${origin}/payment-cancelled.html?token=${encodeURIComponent(token)}&payment=cancelled`);
    const r=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'content-type':'application/x-www-form-urlencoded'},body:form.toString()});
    const session=await r.json();
    if(!r.ok) throw new Error(session?.error?.message||'Stripe checkout could not be created.');
    const patch={stripe_checkout_session_id:session.id,payment_status:'PENDING',checkout_created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
    await lib.sbJson(`/rest/v1/invoices?id=eq.${inv.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(patch)});
    await pay.addHistory(inv,patch,`Stripe Checkout session created for ${balance.toFixed(2)} ${String(inv.currency||'CAD').toUpperCase()}.`,'SYSTEM');
    return lib.json(200,{url:session.url,session_id:session.id});
  }catch(e){console.error('invoice-checkout',e);return lib.json(e.status||500,{error:e.message||'Unable to start payment.'})}
};
