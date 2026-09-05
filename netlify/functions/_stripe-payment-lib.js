const lib=require('./_admin-lib');

const TOKEN_RE=/^[a-f0-9]{20,80}$/i;
const SESSION_RE=/^cs_(?:test|live)_[A-Za-z0-9_\-]{12,}$/;
const MONEY=n=>Math.round((Number(n)||0)*100)/100;
const enc=v=>encodeURIComponent(String(v||''));

function clean(v,n=1000){return String(v??'').trim().slice(0,n)}
function validToken(v){return TOKEN_RE.test(clean(v,100))}
function validSessionId(v){return SESSION_RE.test(clean(v,300))}
function balance(inv){return MONEY(Math.max(0,Number(inv?.total_amount||0)-Number(inv?.amount_paid||0)))}
function paid(inv){return String(inv?.status||'').toUpperCase()==='PAID'||String(inv?.payment_status||'').toUpperCase()==='PAID'||balance(inv)<=0.001}
function invoiceSelect(){return 'id,invoice_number,public_token,client_name,client_email,client_phone,invoice_date,due_date,subtotal,gst_rate,gst_amount,total_amount,currency,amount_paid,status,payment_status,payment_method,payment_reference,stripe_checkout_session_id,stripe_payment_intent_id,note,issued_at,sent_at,paid_at,checkout_created_at,created_at,updated_at'}

async function invoiceByToken(token){
  if(!validToken(token))return null;
  const rows=await lib.sbJson(`/rest/v1/invoices?select=${invoiceSelect()}&public_token=eq.${enc(token)}&limit=1`);
  return Array.isArray(rows)?rows[0]||null:null;
}
async function invoiceBySession(sessionId){
  if(!validSessionId(sessionId))return null;
  const rows=await lib.sbJson(`/rest/v1/invoices?select=${invoiceSelect()}&stripe_checkout_session_id=eq.${enc(sessionId)}&limit=1`);
  return Array.isArray(rows)?rows[0]||null:null;
}
async function invoiceById(id){
  if(!id)return null;
  const rows=await lib.sbJson(`/rest/v1/invoices?select=${invoiceSelect()}&id=eq.${enc(id)}&limit=1`);
  return Array.isArray(rows)?rows[0]||null:null;
}
async function resolveInvoice({token,session_id,invoice_id}={}){
  return (await invoiceByToken(token))||(await invoiceBySession(session_id))||(await invoiceById(invoice_id));
}
async function invoiceItems(invoiceId){
  if(!invoiceId)return [];
  const items=await lib.sbJson(`/rest/v1/invoice_items?select=id,description,qty,unit,unit_rate,line_total,sort_order&invoice_id=eq.${enc(invoiceId)}&order=sort_order.asc,id.asc`);
  return (items||[]).map(x=>({id:x.id,description:x.description,qty:x.qty,unit:x.unit,unit_rate:x.unit_rate,line_total:x.line_total,sort_order:x.sort_order}));
}
async function latestTransaction(invoiceId){
  if(!invoiceId)return null;
  const rows=await lib.sbJson(`/rest/v1/payment_transactions?select=id,invoice_id,amount,currency,provider,status,external_reference,stripe_checkout_session_id,stripe_payment_intent_id,note,created_at&invoice_id=eq.${enc(invoiceId)}&order=created_at.desc&limit=1`).catch(()=>[]);
  return Array.isArray(rows)?rows[0]||null:null;
}
async function addHistory(invoice,patch,note,source='SYSTEM'){
  if(!invoice?.id)return;
  await lib.sbJson('/rest/v1/invoice_status_history',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({
    invoice_id:invoice.id,
    old_status:invoice.status,
    new_status:patch?.status||invoice.status,
    old_payment_status:invoice.payment_status,
    new_payment_status:patch?.payment_status||invoice.payment_status,
    note:clean(note,1000)||null,
    source
  })}).catch(e=>console.warn('stripe-payment-history',e?.message||e));
}
function publicPayload(inv,items=[],tx=null){
  const remaining=balance(inv);
  return {
    invoice:inv?{...inv,balance:remaining,is_paid:paid(inv)}:null,
    items,
    latest_transaction:tx,
    stripe_enabled:Boolean(process.env.STRIPE_SECRET_KEY)
  };
}
async function stripeGet(path){
  const secret=process.env.STRIPE_SECRET_KEY;
  if(!secret||!path)return null;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),4500);
  try{
    const r=await fetch(`https://api.stripe.com${path}`,{headers:{Authorization:`Bearer ${secret}`},signal:controller.signal});
    let data={};try{data=await r.json();}catch{}
    if(!r.ok){console.warn('stripe-get',path,data?.error?.message||r.status);return null;}
    return data;
  }catch(e){console.warn('stripe-get',path,e?.message||e);return null;}finally{clearTimeout(timer);}
}
async function stripePaymentDetails(session){
  const out={payment_intent:session?.payment_intent||null,charge_id:null,receipt_url:null,balance_transaction_id:null,fee_amount:null,net_amount:null};
  if(!out.payment_intent)return out;
  const pi=await stripeGet(`/v1/payment_intents/${enc(out.payment_intent)}?expand[]=latest_charge`);
  const charge=typeof pi?.latest_charge==='object'?pi.latest_charge:null;
  if(charge){
    out.charge_id=charge.id||null;
    out.receipt_url=charge.receipt_url||null;
    if(typeof charge.balance_transaction==='object'){
      out.balance_transaction_id=charge.balance_transaction.id||null;
      out.fee_amount=charge.balance_transaction.fee!=null?MONEY(Number(charge.balance_transaction.fee)/100):null;
      out.net_amount=charge.balance_transaction.net!=null?MONEY(Number(charge.balance_transaction.net)/100):null;
    }else if(charge.balance_transaction){out.balance_transaction_id=charge.balance_transaction;}
  }
  if(out.balance_transaction_id&&(out.fee_amount==null||out.net_amount==null)){
    const bt=await stripeGet(`/v1/balance_transactions/${enc(out.balance_transaction_id)}`);
    if(bt){out.fee_amount=bt.fee!=null?MONEY(Number(bt.fee)/100):out.fee_amount;out.net_amount=bt.net!=null?MONEY(Number(bt.net)/100):out.net_amount;}
  }
  return out;
}
function detailsNote({eventId,session,details,invoice}={}){
  const parts=[
    `Stripe webhook event: ${eventId||'unknown'}`,
    `Checkout Session: ${session?.id||'unknown'}`,
    `Payment Intent: ${details?.payment_intent||session?.payment_intent||'unknown'}`,
    details?.charge_id?`Charge ID: ${details.charge_id}`:null,
    details?.receipt_url?`Receipt URL: ${details.receipt_url}`:null,
    details?.fee_amount!=null?`Stripe fee: ${details.fee_amount.toFixed(2)} ${String(invoice?.currency||session?.currency||'CAD').toUpperCase()}`:null,
    details?.net_amount!=null?`Net after Stripe fee: ${details.net_amount.toFixed(2)} ${String(invoice?.currency||session?.currency||'CAD').toUpperCase()}`:null,
    session?.customer_email?`Stripe customer email: ${session.customer_email}`:null
  ].filter(Boolean);
  return parts.join('\n');
}

module.exports={MONEY,clean,validToken,validSessionId,balance,paid,invoiceByToken,invoiceBySession,invoiceById,resolveInvoice,invoiceItems,latestTransaction,addHistory,publicPayload,stripeGet,stripePaymentDetails,detailsNote};
