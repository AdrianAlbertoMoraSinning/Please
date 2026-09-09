'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const root=path.join(__dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');const exists=p=>fs.existsSync(path.join(root,p));
test('STEP 19 migration and verify mirrors are present and identical',()=>{
  assert.ok(exists('STEP19_OPERATIONAL_FINANCE_AUTOMATION.sql'));
  assert.equal(read('STEP19_OPERATIONAL_FINANCE_AUTOMATION.sql'),read('supabase/STEP19_OPERATIONAL_FINANCE_AUTOMATION.sql'));
  assert.ok(exists('STEP19_VERIFY.sql'));
  assert.equal(read('STEP19_VERIFY.sql'),read('supabase/STEP19_VERIFY.sql'));
});
test('STEP 19 verification is read-only and defines 20 controls',()=>{
  const s=read('STEP19_VERIFY.sql');
  assert.doesNotMatch(s,/\b(create table|alter table|drop table|truncate table|create trigger|drop trigger|insert into|update\s+public\.|delete from)\b/i);
  assert.match(s,/20,'no_historical_invoice_backfill_pending'/);
  assert.match(s,/20 PASS \/ 0 FAIL/);
});
test('STEP 19 documentation records safe defaults and deployment boundary',()=>{
  const s=read('STEP19_OPERATIONAL_FINANCE_AUTOMATION.md');
  assert.match(s,/Auto-create invoice DRAFT:\s*\*\*ON\*\*/);
  assert.match(s,/Auto-issue invoice:\s*\*\*OFF\*\*/);
  assert.match(s,/Auto-email invoice:\s*\*\*OFF\*\*/);
  assert.match(s,/Independent Provider workflow is unchanged/);
  assert.match(s,/20 PASS \/ 0 FAIL/);
});
