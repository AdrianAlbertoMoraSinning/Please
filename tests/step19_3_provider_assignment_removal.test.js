'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('Administration exposes a single-Provider removal action without cancelling the Job',()=>{
  const ui=read('js/admin-jobs.js');
  assert.match(ui,/REMOVE FROM SERVICE/);
  assert.match(ui,/REMOVE_PROVIDER_ASSIGNMENT/);
  assert.match(ui,/This removes only this Provider assignment\. It does not cancel the Job and does not notify the customer/);
  assert.match(ui,/providerRemovalControl/);
});

test('Provider removal is guarded by service activity evidence extensions and payments',()=>{
  const fn=read('netlify/functions/admin-job-action.js');
  assert.match(fn,/REMOVE_PROVIDER_ASSIGNMENT/);
  assert.match(fn,/job_service_events/);
  assert.match(fn,/ARRIVED,STARTED,COMPLETED,CHECKED_OUT,EXTENSION_REQUESTED/);
  assert.match(fn,/job_service_evidence/);
  assert.match(fn,/provider_payments/);
  assert.match(fn,/job_extension_requests/);
  assert.match(fn,/Only a pending or confirmed Provider who has not begun the service can be removed here/);
});

test('removal preserves audit and never sends a customer cancellation email',()=>{
  const fn=read('netlify/functions/admin-job-action.js');
  assert.match(fn,/ADMIN_REMOVED_FROM_ASSIGNMENT/);
  assert.match(fn,/assignment_status_history/);
  assert.match(fn,/notifyAssignment\(assignment\.id,'REMOVED',reason\)/);
  assert.match(fn,/customer_notification_sent:false/);
});

test('removed or declined assignments disappear from Provider calendar but remain in Service History',()=>{
  const js=read('js/provider.js');
  assert.match(js,/filter\(x=>!\['CANCELLED','DECLINED'\]\.includes\(String\(x\.status\|\|''\)\.toUpperCase\(\)\)\)/);
  assert.match(js,/\['COMPLETED','DECLINED','CANCELLED'\]\.includes\(x\.status\)/);
  assert.match(read('provider.html'),/Assignments removed by PLEASE or declined by you stay in Service History/);
  assert.match(read('provider.html'),/js\/provider\.js\?v=19\.3/);
  assert.match(read('admin-jobs.html'),/js\/admin-jobs\.js\?v=15\.19\.3/);
  assert.match(read('service-worker.js'),/please-provider-v20/);
});
