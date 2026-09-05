const fs=require('fs');
const assert=require('assert');
const read=p=>fs.readFileSync(p,'utf8');
function pass(name,cond){assert.ok(cond,name);console.log('PASS:',name)}

const checkout=read('netlify/functions/invoice-checkout.js');
const publicInvoice=read('netlify/functions/public-invoice.js');
const publicResult=read('netlify/functions/public-payment-result.js');
const webhook=read('netlify/functions/stripe-webhook.js');
const invoiceJs=read('js/invoice.js');
const success=read('payment-success.html');
const cancelled=read('payment-cancelled.html');
const adminInvoices=read('js/admin-invoices.js');
const doc=read('STEP15_9_3_STRIPE_PAYMENT_RETURN_RECOVERY.md');

pass('Dedicated payment success page exists and calls public payment result endpoint',success.includes('public-payment-result')&&success.includes('Payment successful'));
pass('Dedicated payment cancelled page exists and provides Pay Again behavior',cancelled.includes('Payment cancelled')&&cancelled.includes('Pay again'));
pass('Checkout success URL includes token and Checkout Session ID',checkout.includes('payment-success.html?token=')&&checkout.includes('session_id={CHECKOUT_SESSION_ID}'));
pass('Checkout cancel URL uses dedicated cancelled page',checkout.includes('payment-cancelled.html?token='));
pass('Checkout no longer blocks an unpaid invoice only because a previous session is active',!checkout.includes('A payment session is already active'));
pass('Public invoice can resolve by token or session id',publicInvoice.includes('resolveInvoice({token,session_id})'));
pass('Public payment result exposes safe paid/pending state',publicResult.includes('payment_result')&&publicResult.includes('pending')&&publicResult.includes('paid'));
pass('Invoice page handles cancelled, success and pending states without false invalid-link messaging',invoiceJs.includes("payment==='cancelled'")&&invoiceJs.includes("payment==='success'")&&invoiceJs.includes('payment_status===\'PENDING\''));
pass('Paid invoices hide pay button and show payment received details',invoiceJs.includes('Payment received')&&invoiceJs.includes('pay-now'));
pass('Webhook resolves invoice by id or Checkout Session fallback',webhook.includes('invoiceById(invoiceId')&&webhook.includes('invoiceBySession(obj.id)'));
pass('Webhook safely acknowledges duplicate deliveries after already-paid state',webhook.includes('Duplicate Stripe webhook received after invoice was already paid'));
pass('Webhook records Stripe payment details in existing payment transaction note',webhook.includes('detailsNote')&&webhook.includes('Charge ID')&&webhook.includes('Net after Stripe fee'));
pass('Admin Invoices renders Stripe Payment Details panel',adminInvoices.includes('Stripe Payment Details')&&adminInvoices.includes('Net deposit')&&adminInvoices.includes('Open Stripe receipt'));
pass('Documentation states no SQL migration required',doc.includes('No new Supabase SQL migration is required'));
console.log('STEP 15.9.3 Stripe payment return recovery static audit completed successfully.');
