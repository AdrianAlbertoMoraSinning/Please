'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');

test('STEP 19.1 adds controlled one-click invoice delivery without changing core payment engine',()=>{
  const ui=read('js/admin-invoices.js');
  const fn=read('netlify/functions/admin-invoice-delivery-action.js');
  assert.match(ui,/SEND INVOICE/);
  assert.match(ui,/SEND TO CUSTOMER/);
  assert.match(ui,/admin-invoice-delivery-action/);
  assert.match(ui,/draftPayload\('SAVE'\)/);
  assert.match(fn,/SEND_INVOICE/);
  assert.match(fn,/status:'ISSUED'/);
  assert.match(fn,/status:'SENT'/);
  assert.match(fn,/Invoice was issued, but the customer email was not delivered/);
  assert.equal(hash('netlify/functions/admin-invoice-action.js'),'8afe9a402e088da72f682c38f132f17e77d636c9b046358141ab1836e2ece9f4');
  assert.equal(hash('netlify/functions/invoice-checkout.js'),'570626097b70d025a30090df4c99dd00b325cb2b785010c3b75393a1a5fc98bc');
  assert.equal(hash('stripe-webhook.js'),'ae22531e33508826be005cb9d5dc9e0dabba1bef4ed2179af9d37dcc9a567812');
});

test('customer invoice email includes direct PAY NOW and e-Transfer instructions',()=>{
  const fn=read('netlify/functions/admin-invoice-delivery-action.js');
  assert.match(fn,/ctaLabel:'PAY NOW'/);
  assert.match(fn,/PLEASE_ETRANSFER_EMAIL/);
  assert.match(fn,/info@pleaseservice\.ca/);
  assert.match(fn,/e-Transfer: send payment to/);
  assert.match(fn,/transfer\?/);
  assert.match(fn,/invoice\.html\?token=/);
  assert.doesNotMatch(fn,/Request Reference.*email/i);
});

test('completed Jobs expose review-and-send entry point into the invoice center',()=>{
  const jobs=read('js/admin-jobs.js');
  const html=read('admin-jobs.html');
  assert.match(jobs,/REVIEW & SEND INVOICE/);
  assert.match(jobs,/admin-invoices\.html\?job_id=/);
  assert.match(html,/js\/admin-jobs\.js\?v=15\.19\.1/);
});

test('paid invoices expose selective review request with duplicate guard and configurable Google URL',()=>{
  const ui=read('js/admin-invoices.js');
  const fn=read('netlify/functions/admin-invoice-delivery-action.js');
  assert.match(ui,/SEND REVIEW REQUEST/);
  assert.match(ui,/REVIEW REQUEST SENT/);
  assert.match(fn,/SEND_REVIEW/);
  assert.match(fn,/PLEASE_GOOGLE_REVIEW_URL/);
  assert.match(fn,/11821370300392660033/);
  assert.match(fn,/0xa40df1a7e941dc41/);
  assert.match(fn,/payment_status==='PAID'/);
  assert.match(fn,/Google Review link is unavailable/);
  assert.match(fn,/A Google review request was already sent for this invoice/);
  assert.match(fn,/STEP19\.1 GOOGLE REVIEW REQUEST SENT/);
});

test('STEP 19.1 is additive and requires no SQL migration',()=>{
  const doc=read('STEP19_1_CUSTOMER_INVOICE_DELIVERY_REVIEW_REQUESTS.md');
  const list=read('UPLOAD_ONLY_STEP19_1.txt');
  assert.match(doc,/No SQL migration is required/);
  assert.match(doc,/does not replace Stripe/);
  assert.match(list,/No SQL migration required/);
  assert.match(list,/admin-invoice-delivery-action\.js/);
});
