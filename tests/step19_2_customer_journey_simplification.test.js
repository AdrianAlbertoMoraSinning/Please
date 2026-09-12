'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('routine Service Request states remain internal while cancellation stays customer-facing',()=>{
  const fn=read('netlify/functions/admin-service-request-action.js');
  assert.match(fn,/REVIEWING and READY_TO_ASSIGN/);
  assert.match(fn,/notificationPromise=Promise\.resolve\(null\)/);
  assert.match(fn,/if\(action==='CANCEL'\)/);
  assert.match(fn,/notificationPromise=notify\.send/);
  assert.doesNotMatch(fn,/PLEASE is reviewing your request/);
  assert.doesNotMatch(fn,/ready for provider coordination/);
});

test('Job creation and reassignment no longer send routine coordinating email',()=>{
  const fn=read('netlify/functions/admin-job-action.js');
  assert.doesNotMatch(fn,/notifyCustomerJob\(jobId,'SCHEDULED'\)/);
  assert.doesNotMatch(fn,/notifyCustomerJob\(value\.job_id,'SCHEDULED'\)/);
  assert.match(fn,/notifyCustomerJob\(value\.job_id,'CANCELLED'\)/);
});

test('customer Service Confirmed is one whole-team milestone',()=>{
  const fn=read('netlify/functions/provider-assignment-action.js');
  assert.match(fn,/rows\.some\(x=>x\.status!=='CONFIRMED'\)/);
  assert.match(fn,/Your PLEASE service is confirmed/);
  assert.match(fn,/please-customer-service-confirmed-\$\{jobId\}/);
  assert.doesNotMatch(fn,/Service Team Update/);
  assert.doesNotMatch(fn,/Confirmed professional added/);
});

test('ARRIVE START COMPLETE are operational only; extension remains customer-facing',()=>{
  const fn=read('netlify/functions/provider-live-service-action.js');
  assert.match(fn,/let title='',intro='',customerIntro='',notifyCustomer=false/);
  assert.match(fn,/REQUEST_EXTENSION[\s\S]*notifyCustomer=true/);
  assert.doesNotMatch(fn,/your PLEASE professional has arrived/);
  assert.doesNotMatch(fn,/your PLEASE service is now in progress/);
  assert.doesNotMatch(fn,/your PLEASE service has been completed by the service team/);
});

test('invoice email combines completion and payment with simplified customer copy',()=>{
  const fn=read('netlify/functions/admin-invoice-delivery-action.js');
  assert.match(fn,/Your service is complete · Invoice/);
  assert.match(fn,/Your service is complete — Invoice/);
  assert.match(fn,/Card \/ Debit: click PAY NOW to securely pay online/);
  assert.match(fn,/e-Transfer: send payment to/);
  assert.doesNotMatch(fn,/Stripe checkout/);
  assert.match(fn,/greetingName\(job\?\.customers\?\.first_name\|\|fresh\.client_name\)/);
});

test('public invoice hides internal automation notes and customer-facing Stripe wording',()=>{
  const js=read('js/invoice.js');
  const success=read('payment-success.html');
  assert.match(js,/Automatically prepared from completed Job/);
  assert.match(js,/return''/);
  assert.match(js,/Click below to securely pay your invoice online/);
  assert.doesNotMatch(js,/Stripe-hosted checkout/);
  assert.doesNotMatch(js,/Stripe confirmation/);
  assert.doesNotMatch(success,/Stripe confirmation/);
  assert.doesNotMatch(success,/Confirming your payment with Stripe/);
});

test('final Draft invoice values synchronize Job totals and surface in Jobs Request and Calendar views',()=>{
  const invoice=read('netlify/functions/admin-invoice-action.js');
  const reqApi=read('netlify/functions/admin-service-requests.js');
  const reqUi=read('js/admin-service-requests.js');
  const calApi=read('netlify/functions/admin-calendar-data.js');
  const calUi=read('js/admin-calendar.js');
  const jobsApi=read('netlify/functions/admin-jobs-data.js');
  const jobsUi=read('js/admin-jobs.js');
  assert.match(invoice,/syncFinalCustomerBilling/);
  assert.match(invoice,/quoted_subtotal:MONEY\(subtotal\)/);
  assert.match(invoice,/provider_unit_rate/);
  assert.match(invoice,/structurallyCompatible/);
  assert.match(reqApi,/final_invoice_total/);
  assert.match(reqUi,/Final Invoiced Total/);
  assert.match(calApi,/final_invoices/);
  assert.match(calUi,/Final Customer Billing/);
  assert.match(jobsApi,/final_invoices/);
  assert.match(jobsUi,/Final Customer Billing/);
});

test('STEP 19.2 cache-busts every browser surface changed by this release',()=>{
  for(const f of ['admin-service-requests.html','admin-calendar.html','admin-jobs.html','invoice.html'])assert.match(read(f),/v=15\.19\.2/);
});
