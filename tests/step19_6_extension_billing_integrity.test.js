'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('STEP 19.6 extension approval keeps time and money atomic',()=>{
  const sql=read('supabase/STEP19_6_EXTENSION_BILLING_INTEGRITY.sql');
  assert.match(sql,/Customer approval method is required/);
  assert.match(sql,/customer invoice snapshot already exists/);
  assert.match(sql,/Extension schedule changed/);
  assert.match(sql,/Extension pricing changed/);
  assert.match(sql,/job_id,provider_service_rate_id,service_id,service_name,description/);
  assert.match(sql,/approved_extension_minutes=coalesce\(approved_extension_minutes,0\)\+r\.extra_minutes/);
  assert.match(sql,/quoted_subtotal=coalesce\(quoted_subtotal,0\)\+r\.customer_addition/);
  assert.match(sql,/provider_line_total/);
  assert.match(sql,/customer_line_total/);
  assert.match(sql,/status='APPROVED'/);
  assert.match(sql,/update public\.job_extension_requests set billing_item_id=new_item_id/);
});

test('STEP 19.6 extension API routes final decision notifications',()=>{
  const fn=read('netlify/functions/admin-extension-action.js');
  assert.match(fn,/notify\.sendAdmins/);
  assert.match(fn,/notify\.sendProvider/);
  assert.match(fn,/j\?\.customers\?\.email/);
  assert.match(fn,/notifications_sent/);
});


test('STEP 19.6 approved-extension correction is audited and financially locked',()=>{
  const sql=read('supabase/STEP19_6_EXTENSION_BILLING_INTEGRITY.sql');
  assert.match(sql,/admin_correct_approved_extension/);
  assert.match(sql,/Corrected time must be entered in exact 15-minute increments/);
  assert.match(sql,/Correction reason is required/);
  assert.match(sql,/A customer invoice already exists for this Job/);
  assert.match(sql,/Provider payment records lock this correction/);
  assert.match(sql,/A later extension exists for this assignment/);
  assert.match(sql,/Corrected extension conflicts with another assignment/);
  assert.match(sql,/ADMIN CORRECTION — extension changed from/);
  assert.match(sql,/create table if not exists public\.job_extension_corrections/);
  assert.match(sql,/insert into public\.job_extension_corrections/);
  assert.match(sql,/old_minutes,new_minutes,old_end,new_end/);
  assert.match(sql,/old_customer_addition,new_customer_addition,old_provider_addition,new_provider_addition,reason/);
  assert.match(sql,/where id=r\.billing_item_id and job_id=r\.job_id for update/);
  assert.match(sql,/ext_item\.description='Approved time extension'/);
  assert.match(sql,/legacy_match_count<>1/);
  assert.match(sql,/Legacy extension billing line is ambiguous/);
  assert.match(sql,/approved_extension_minutes=greatest\(0,coalesce\(approved_extension_minutes,0\)\+delta_minutes\)/);
  assert.match(sql,/quoted_subtotal=greatest\(0,coalesce\(quoted_subtotal,0\)\+\(customer_total-old_customer\)\)/);
});

test('STEP 19.6 correction API and Live Operations require explicit hours and minutes',()=>{
  const fn=read('netlify/functions/admin-extension-correction-action.js');
  const ui=read('js/admin-live-operations.js');
  assert.match(fn,/Enter both corrected hours and minutes/);
  assert.match(fn,/hours\*60\+minutes/);
  assert.match(fn,/total%15!==0/);
  assert.match(fn,/Correction reason is required/);
  assert.match(fn,/admin_correct_approved_extension/);
  assert.match(fn,/notify\.sendAdmins/);
  assert.match(fn,/notify\.sendProvider/);
  assert.match(fn,/job\?\.customers\?\.email/);
  assert.match(fn,/please-customer-extension-correction-/);
  assert.match(ui,/CORRECT TIME/);
  assert.match(ui,/additional minutes \(0, 15, 30 or 45\)/);
  assert.match(ui,/admin-extension-correction-action/);
  assert.doesNotMatch(ui,/parseFloat\([^)]*extra_minutes/);
});


test('STEP 19.6 Live Operations exposes financial correction locks before admin clicks',()=>{
  const data=read('netlify/functions/admin-live-operations-data.js');
  const ui=read('js/admin-live-operations.js');
  assert.match(data,/invoices\?select=id,job_id,status,payment_status,created_at/);
  assert.match(data,/provider_payments\?select=id,job_id,status,created_at/);
  assert.match(data,/correction_locked/);
  assert.match(data,/Customer invoice has been issued/);
  assert.match(data,/Customer invoice draft already exists/);
  assert.match(data,/Provider payment record exists/);
  assert.match(ui,/Correction locked:/);
  assert.match(ui,/x\.correction_locked\?'':/);
});


test('STEP 19.6 customer tracking extension decisions notify operations',()=>{
  const fn=read('netlify/functions/public-extension-response.js');
  assert.match(fn,/notify\.sendAdmins/);
  assert.match(fn,/notify\.sendProvider/);
  assert.match(fn,/Customer approval received/);
  assert.match(fn,/Customer declined additional time/);
  assert.match(fn,/assignment_id:x\.assignment_id/);
  assert.match(fn,/provider_id:x\.provider_id/);
  assert.match(fn,/please-admin-customer-extension-approved-/);
  assert.match(fn,/please-provider-customer-extension-rejected-/);
});
