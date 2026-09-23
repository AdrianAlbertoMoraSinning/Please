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
  assert.match(sql,/Extension schedule changed/);
  assert.match(sql,/Extension pricing changed/);
  assert.match(sql,/assignment_id,provider_id,provider_service_rate_id/);
  assert.match(sql,/approved_extension_minutes=coalesce\(approved_extension_minutes,0\)\+r\.extra_minutes/);
  assert.match(sql,/quoted_subtotal=coalesce\(quoted_subtotal,0\)\+r\.customer_addition/);
  assert.match(sql,/provider_line_total/);
  assert.match(sql,/customer_line_total/);
  assert.match(sql,/status='APPROVED'/);
});

test('STEP 19.6 extension API routes final decision notifications',()=>{
  const fn=read('netlify/functions/admin-extension-action.js');
  assert.match(fn,/notify\.sendAdmins/);
  assert.match(fn,/notify\.sendProvider/);
  assert.match(fn,/j\?\.customers\?\.email/);
  assert.match(fn,/notifications_sent/);
});
