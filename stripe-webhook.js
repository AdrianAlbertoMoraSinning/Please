const crypto=require('crypto');
const lib=require('./_admin-lib');
const notify=require('./_notify-lib');
function safeEqual(a,b){try{return crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'))}catch{return false}}
function verify(raw,header,secret){
  const parts=String(header||'').split(',').map(x=>x.split('='));
  const ts=parts.find(x=>x[0]==='t')?.[1],sigs=parts.filter(x=>x[0]==='v1').map(x=>x[1]);
  if(!ts||!sigs.length) return false;
  if(Math.abs(Date.now()/1000-Number(ts))>300) return false;
  const expected=crypto.createHmac('sha256',secret).update(`${ts}.${raw}`,'utf8').digest('hex');
  return sigs.some(s=>safeEqual(expected,s));
}
exports.handler=async event=>{
  if(event.httpMethod!=='POST') return {statusCode:405,body:'Method not allowed'};
  try{
    const whsec=process.env.STRIPE_WEBHOOK_SECRET;
    if(!whsec) return {statusCode:503,body:'Webhook not configured'};
    const raw=event.isBase64Encoded?Buffer.from(event.body||'','base64').toString('utf8'):String(event.body||'');
    if(!verify(raw,event.headers['stripe-signature']||event.headers['Stripe-Signature'],whsec)) return {statusCode:400,body:'Invalid signature'};
    const evt=JSON.parse(raw),obj=evt.data?.object||{};
    if(evt.type==='checkout.session.completed' && obj.payment_status==='paid'){
      const invoiceId=obj.metadata?.invoice_id;
      if(invoiceId){
        const rows=await lib.sbJson(`/rest/v1/invoices?select=*&id=eq.${encodeURIComponent(invoiceId)}&limit=1`),inv=rows?.[0];
        if(inv && inv.payment_status!=='PAID'){
          const amount=Math.round((Number(obj.amount_total||0)/100)*100)/100;
          const expected=Math.round(Math.max(0,Number(inv.total_amount)-Number(inv.amount_paid||0))*100)/100;
          const stripeCurrency=String(obj.currency||'').toUpperCase(),invoiceCurrency=String(inv.currency||'CAD').toUpperCase();
          if(inv.stripe_checkout_session_id && inv.stripe_checkout_session_id!==obj.id) throw new Error('Stripe session does not match the active invoice checkout session.');
          if(Math.abs(amount-expected)>0.001) throw new Error(`Stripe amount mismatch for ${inv.invoice_number}: expected ${expected.toFixed(2)}, received ${amount.toFixed(2)}.`);
          if(stripeCurrency!==invoiceCurrency) throw new Error(`Stripe currency mismatch for ${inv.invoice_number}.`);
          const patch={status:'PAID',payment_status:'PAID',amount_paid:Math.round((Number(inv.amount_paid||0)+amount)*100)/100,payment_method:'STRIPE',payment_reference:obj.payment_intent||obj.id,stripe_checkout_session_id:obj.id,stripe_payment_intent_id:obj.payment_intent||null,paid_at:new Date().toISOString(),updated_at:new Date().toISOString()};
          await lib.sbJson(`/rest/v1/invoices?id=eq.${invoiceId}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(patch)});
          try{await lib.sbJson('/rest/v1/payment_transactions',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({invoice_id:invoiceId,amount,currency:String(obj.currency||inv.currency||'CAD').toUpperCase(),provider:'STRIPE',status:'SUCCEEDED',external_reference:obj.payment_intent||obj.id,stripe_checkout_session_id:obj.id,stripe_payment_intent_id:obj.payment_intent||null,note:'Stripe Checkout payment'})})}catch(e){if(!String(e.message).toLowerCase().includes('duplicate')) throw e}
          await lib.sbJson('/rest/v1/invoice_status_history',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({invoice_id:invoiceId,old_status:inv.status,new_status:'PAID',old_payment_status:inv.payment_status,new_payment_status:'PAID',note:'Payment confirmed by Stripe webhook',source:'STRIPE'})});
          await notify.send({to:inv.client_email,subject:`PLEASE — Payment Received (${inv.invoice_number})`,title:'Payment received — thank you',intro:`Hi ${inv.client_name||'there'}, your online payment to PLEASE was confirmed successfully.`,details:[['Invoice',inv.invoice_number],['Amount',`${amount.toFixed(2)} ${invoiceCurrency}`],['Payment method','Online card payment'],['Status','PAID']],ctaLabel:'View Invoice',ctaUrl:`${notify.baseUrl()}/invoice.html?token=${encodeURIComponent(inv.public_token||'')}`,idempotencyKey:`please-stripe-customer-${evt.id}`});
          await notify.sendAdmins({subject:`PLEASE — Stripe Payment Received (${inv.invoice_number})`,title:'Customer payment received',intro:'Stripe confirmed an online invoice payment.',details:[['Invoice',inv.invoice_number],['Customer',inv.client_name||inv.client_email],['Amount',`${amount.toFixed(2)} ${invoiceCurrency}`],['Payment reference',obj.payment_intent||obj.id]],ctaLabel:'Open Invoices',ctaUrl:`${notify.baseUrl()}/admin-invoices.html`,idempotencyKey:`please-stripe-admin-${evt.id}`,replyToOverride:inv.client_email});
        }
      }
    }
    if(evt.type==='checkout.session.expired'){
      const invoiceId=obj.metadata?.invoice_id;
      if(invoiceId){
        const rows=await lib.sbJson(`/rest/v1/invoices?select=id,status,payment_status&id=eq.${encodeURIComponent(invoiceId)}&limit=1`),inv=rows?.[0];
        if(inv&&inv.payment_status==='PENDING') await lib.sbJson(`/rest/v1/invoices?id=eq.${invoiceId}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({payment_status:'UNPAID',updated_at:new Date().toISOString()})});
      }
    }
    return {statusCode:200,body:'ok'};
  }catch(e){console.error('stripe-webhook',e);return {statusCode:500,body:'Webhook processing failed'}}
};
