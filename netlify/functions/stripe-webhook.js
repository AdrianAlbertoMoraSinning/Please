const crypto=require('crypto');
const lib=require('./_admin-lib');
const notify=require('./_notify-lib');
const pay=require('./_stripe-payment-lib');

function safeEqual(a,b){try{return crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'))}catch{return false}}
function verify(raw,header,secret){
  const parts=String(header||'').split(',').map(x=>x.split('='));
  const ts=parts.find(x=>x[0]==='t')?.[1],sigs=parts.filter(x=>x[0]==='v1').map(x=>x[1]);
  if(!ts||!sigs.length) return false;
  if(Math.abs(Date.now()/1000-Number(ts))>300) return false;
  const expected=crypto.createHmac('sha256',secret).update(`${ts}.${raw}`,'utf8').digest('hex');
  return sigs.some(s=>safeEqual(expected,s));
}

async function markPaidFromCheckout(evt,obj){
  const invoiceId=obj.metadata?.invoice_id;
  const inv=(await pay.invoiceById(invoiceId))||(await pay.invoiceBySession(obj.id));
  if(!inv) throw new Error(`Invoice not found for Stripe Checkout session ${obj.id}.`);
  if(pay.paid(inv)){
    await pay.addHistory(inv,{status:inv.status,payment_status:inv.payment_status},`Duplicate Stripe webhook received after invoice was already paid. Event ${evt.id}.`,'STRIPE');
    return;
  }
  const amount=pay.MONEY(Number(obj.amount_total||0)/100);
  const expected=pay.balance(inv);
  const stripeCurrency=String(obj.currency||'').toUpperCase(),invoiceCurrency=String(inv.currency||'CAD').toUpperCase();
  if(Math.abs(amount-expected)>0.001) throw new Error(`Stripe amount mismatch for ${inv.invoice_number}: expected ${expected.toFixed(2)}, received ${amount.toFixed(2)}.`);
  if(stripeCurrency!==invoiceCurrency) throw new Error(`Stripe currency mismatch for ${inv.invoice_number}.`);

  const details=await pay.stripePaymentDetails(obj).catch(()=>({payment_intent:obj.payment_intent||null}));
  const paidAt=new Date().toISOString();
  const patch={
    status:'PAID',
    payment_status:'PAID',
    amount_paid:pay.MONEY(Number(inv.amount_paid||0)+amount),
    payment_method:'STRIPE',
    payment_reference:details.payment_intent||obj.payment_intent||obj.id,
    stripe_checkout_session_id:obj.id,
    stripe_payment_intent_id:details.payment_intent||obj.payment_intent||null,
    paid_at:paidAt,
    updated_at:paidAt
  };
  await lib.sbJson(`/rest/v1/invoices?id=eq.${encodeURIComponent(inv.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(patch)});
  const note=pay.detailsNote({eventId:evt.id,session:obj,details,invoice:inv});
  try{
    await lib.sbJson('/rest/v1/payment_transactions',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({
      invoice_id:inv.id,
      amount,
      currency:invoiceCurrency,
      provider:'STRIPE',
      status:'SUCCEEDED',
      external_reference:details.payment_intent||obj.payment_intent||obj.id,
      stripe_checkout_session_id:obj.id,
      stripe_payment_intent_id:details.payment_intent||obj.payment_intent||null,
      note:note||'Stripe Checkout payment confirmed by verified webhook'
    })});
  }catch(e){
    if(!String(e.message||'').toLowerCase().includes('duplicate')) throw e;
  }
  await lib.sbJson('/rest/v1/invoice_status_history',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({
    invoice_id:inv.id,
    old_status:inv.status,
    new_status:'PAID',
    old_payment_status:inv.payment_status,
    new_payment_status:'PAID',
    note:`Verified Stripe webhook posted payment. Event ${evt.id}.`,
    source:'STRIPE'
  })}).catch(async()=>pay.addHistory(inv,patch,`Verified Stripe webhook posted payment. Event ${evt.id}.`,'STRIPE'));

  await notify.send({
    to:inv.client_email,
    subject:`PLEASE — Payment Received (${inv.invoice_number})`,
    title:'Payment received — thank you',
    intro:`Hi ${inv.client_name||'there'}, your online payment to PLEASE was confirmed successfully.`,
    details:[['Invoice',inv.invoice_number],['Amount',`${amount.toFixed(2)} ${invoiceCurrency}`],['Payment method','Online card payment'],['Status','PAID'],['Payment reference',details.payment_intent||obj.payment_intent||obj.id]],
    ctaLabel:'View Paid Invoice',
    ctaUrl:`${notify.baseUrl()}/invoice.html?token=${encodeURIComponent(inv.public_token||'')}`,
    idempotencyKey:`please-stripe-customer-${evt.id}`
  });
  await notify.sendAdmins({
    subject:`PLEASE — Stripe Payment Received (${inv.invoice_number})`,
    title:'Customer payment received',
    intro:'Stripe confirmed an online invoice payment through the live Checkout webhook.',
    details:[['Invoice',inv.invoice_number],['Customer',inv.client_name||inv.client_email],['Amount',`${amount.toFixed(2)} ${invoiceCurrency}`],['Payment Intent',details.payment_intent||obj.payment_intent||'—'],['Charge ID',details.charge_id||'—'],['Stripe fee',details.fee_amount!=null?`${details.fee_amount.toFixed(2)} ${invoiceCurrency}`:'Available in Stripe'],['Net after Stripe fee',details.net_amount!=null?`${details.net_amount.toFixed(2)} ${invoiceCurrency}`:'Available in Stripe']],
    ctaLabel:'Open Invoices',
    ctaUrl:`${notify.baseUrl()}/admin-invoices.html`,
    idempotencyKey:`please-stripe-admin-${evt.id}`,
    replyToOverride:inv.client_email
  });
}

async function markExpired(evt,obj){
  const invoiceId=obj.metadata?.invoice_id;
  const inv=(await pay.invoiceById(invoiceId))||(await pay.invoiceBySession(obj.id));
  if(!inv||pay.paid(inv))return;
  if(inv.payment_status==='PENDING'&&String(inv.stripe_checkout_session_id||'')===String(obj.id||'')){
    const patch={payment_status:'UNPAID',stripe_checkout_session_id:null,updated_at:new Date().toISOString()};
    await lib.sbJson(`/rest/v1/invoices?id=eq.${encodeURIComponent(inv.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(patch)});
    await pay.addHistory(inv,patch,`Stripe Checkout session expired without payment. Event ${evt.id}.`,'STRIPE');
  }
}

exports.handler=async event=>{
  if(event.httpMethod!=='POST') return {statusCode:405,body:'Method not allowed'};
  try{
    const whsec=process.env.STRIPE_WEBHOOK_SECRET;
    if(!whsec) return {statusCode:503,body:'Webhook not configured'};
    const raw=event.isBase64Encoded?Buffer.from(event.body||'','base64').toString('utf8'):String(event.body||'');
    if(!verify(raw,event.headers['stripe-signature']||event.headers['Stripe-Signature'],whsec)) return {statusCode:400,body:'Invalid signature'};
    const evt=JSON.parse(raw),obj=evt.data?.object||{};
    if(evt.type==='checkout.session.completed'&&obj.payment_status==='paid') await markPaidFromCheckout(evt,obj);
    if(evt.type==='checkout.session.expired') await markExpired(evt,obj);
    return {statusCode:200,body:'ok'};
  }catch(e){console.error('stripe-webhook',e);return {statusCode:500,body:'Webhook processing failed'}}
};
