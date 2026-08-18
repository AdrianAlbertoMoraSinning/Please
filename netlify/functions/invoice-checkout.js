const lib=require('./_admin-lib');const security=require('./_security-lib');
exports.handler=async event=>{
  if(event.httpMethod!=='POST') return lib.json(405,{error:'Method not allowed'});
  try{
    if(!lib.sameOrigin(event)) return lib.json(403,{error:'Invalid origin'});
    const rl=await security.checkRateLimit(event,{endpoint:'invoice-checkout',limit:20,windowSeconds:900});if(!rl.allowed)return lib.json(429,{error:'Too many payment attempts. Please wait and try again.'},{'Retry-After':String(rl.retryAfter)});
    const secret=process.env.STRIPE_SECRET_KEY;
    if(!secret) return lib.json(503,{error:'Online card payment is not activated yet. Please contact PLEASE Services.'});
    const body=JSON.parse(event.body||'{}'),token=String(body.token||'').trim();
    if(!/^[a-f0-9]{20,80}$/i.test(token)) return lib.json(400,{error:'Invalid invoice link.'});
    const rows=await lib.sbJson(`/rest/v1/invoices?select=*&public_token=eq.${encodeURIComponent(token)}&limit=1`),inv=rows?.[0];
    if(!inv||!['ISSUED','SENT','OVERDUE'].includes(inv.status)) return lib.json(404,{error:'Invoice is not payable.'});
    if(inv.payment_status==='PAID') return lib.json(409,{error:'Invoice is already paid.'});
    if(inv.payment_status==='PENDING'&&inv.stripe_checkout_session_id) return lib.json(409,{error:'A payment session is already active for this invoice. Return to the invoice and try again later if needed.'});
    const balance=Math.max(0,Number(inv.total_amount)-Number(inv.amount_paid||0));
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
    form.set('cancel_url',`${origin}/invoice.html?token=${encodeURIComponent(token)}&payment=cancelled`);
    const r=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'content-type':'application/x-www-form-urlencoded'},body:form.toString()});
    const session=await r.json();
    if(!r.ok) throw new Error(session?.error?.message||'Stripe checkout could not be created.');
    await lib.sbJson(`/rest/v1/invoices?id=eq.${inv.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({stripe_checkout_session_id:session.id,payment_status:'PENDING',checkout_created_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
    return lib.json(200,{url:session.url});
  }catch(e){console.error('invoice-checkout',e);return lib.json(500,{error:e.message||'Unable to start payment.'})}
};
