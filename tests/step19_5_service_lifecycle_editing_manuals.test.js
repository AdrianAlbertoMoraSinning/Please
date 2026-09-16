'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('Administration exposes a persistent lifecycle User Manual',()=>{
  const manual=read('admin-manual.html');
  assert.match(manual,/STEP 19\.5 · ADMINISTRATOR MANUAL/);
  assert.match(manual,/Unassigned Requests/);
  assert.match(manual,/Replace a Provider/);
  assert.match(manual,/Add a Follow-up Service/);
  assert.match(manual,/Completed Jobs/);
  for(const f of ['admin-dashboard.html','admin-customers.html','admin-calendar.html','admin-jobs.html','admin-invoices.html','admin-service-maintenance.html']){
    assert.match(read(f),/href="admin-manual\.html">User Manual</);
  }
});

test('Customer Master can start a follow-up service without customer re-entry',()=>{
  const html=read('admin-customers.html'),js=read('js/admin-customers.js'),cal=read('js/admin-calendar.js');
  assert.match(html,/\+ NEW SERVICE FOR THIS CUSTOMER/);
  assert.match(js,/pleaseAdminCustomerServicePrefill/);
  assert.match(js,/admin-calendar\.html\?new_customer_service=1/);
  assert.match(cal,/newCustomerService=params\.get\('new_customer_service'\)==='1'/);
  assert.match(cal,/customer-first-name.*prefill\.first_name/s);
  assert.match(cal,/job-address.*prefill\.work_address/s);
});

test('Jobs exposes direct service editing and follow-up service creation',()=>{
  const js=read('js/admin-jobs.js');
  assert.match(js,/EDIT SERVICE →/);
  assert.match(js,/admin-service-maintenance\.html\?q=/);
  assert.match(js,/\+ ADD SERVICE FOR CUSTOMER/);
  assert.match(js,/function addFollowupService/);
  assert.match(js,/pleaseAdminCustomerServicePrefill/);
});

test('PENDING or CONFIRMED Provider can be changed through guarded same-Job replacement',()=>{
  const jobs=read('js/admin-jobs.js'),cal=read('js/admin-calendar.js');
  assert.match(jobs,/CHANGE PROVIDER/);
  assert.match(jobs,/function changeProviderAssignment/);
  assert.match(jobs,/REMOVE_PROVIDER_ASSIGNMENT/);
  assert.match(jobs,/admin-calendar\.html\?reassign_job=/);
  assert.match(cal,/reassignJobId=params\.get\('reassign_job'\)/);
  assert.match(cal,/openExistingJob\(j\)/);
  assert.match(cal,/Correct & Reassign/);
});

test('Service Maintenance separates future editing from completed historical review',()=>{
  const js=read('js/admin-service-maintenance.js');
  assert.match(js,/Pre-assignment editing/);
  assert.match(js,/Assigned but not completed/);
  assert.match(js,/Completed Job · historical execution locked/);
  assert.match(js,/OPEN FINAL INVOICE \/ RATE REVIEW/);
  assert.match(js,/admin-invoices\.html\?job_id=/);
  assert.match(js,/ASSIGN THIS REQUEST →/);
});

test('Service Type changes on active Jobs validate Provider authorization',()=>{
  const fn=read('netlify/functions/admin-service-maintenance.js');
  assert.match(fn,/before\.service_id!==svc\.id/);
  assert.match(fn,/status=in\.\(PENDING,CONFIRMED\)/);
  assert.match(fn,/provider_services\?select=provider_id,service_id,active,developer_authorized,provider_enabled/);
  assert.match(fn,/Replace that Provider first from Jobs → Assignment History/);
});

test('Provider manual explains replacement visibility and release remains SQL-free',()=>{
  const provider=read('provider.html'),sw=read('service-worker.js'),doc=read('STEP19_5_SERVICE_LIFECYCLE_EDITING_MANUALS.md');
  assert.match(provider,/removes\/replaces you before the service/);
  assert.match(provider,/do not begin a service that no longer appears in your portal/);
  assert.match(sw,/please-provider-v21-step19-5/);
  assert.match(doc,/No SQL migration is required/);
  assert.equal(fs.existsSync(path.join(root,'supabase/STEP19_5_SERVICE_LIFECYCLE_EDITING_MANUALS.sql')),false);
});
