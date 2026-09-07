const fs=require('fs');
const assert=require('assert');
const read=p=>fs.readFileSync(p,'utf8');
function pass(name,cond){assert.ok(cond,name);console.log('PASS:',name)}
const step16=read('supabase/STEP16_0_CAL_PLEASE_ACCOUNTING_BRIDGE.sql');
const step17=read('supabase/STEP17_NATIVE_ACCOUNTING_ENGINE.sql');
const dashboard=read('cal/dashboard.html');
const adminDashboard=read('admin-dashboard.html');
pass('STEP 16 accounting tables remain the preserved foundation',step16.includes('accounting_external_events')&&step16.includes('please_accounting_outbox')&&step16.includes('accounting_journal_entries'));
pass('STEP 17 upgrades rather than deletes the STEP 16 outbox',step17.includes('alter table public.please_accounting_outbox')&&!step17.includes('drop table public.please_accounting_outbox'));
pass('CAL remains isolated under /cal',fs.existsSync('cal/dashboard.html')&&read('cal/js/supabase-config.js').includes('PLEASE_CONNECTED'));
pass('Admin still exposes CAL Accounting',adminDashboard.includes('cal/dashboard.html')&&adminDashboard.includes('CAL Accounting'));
pass('Manual Sync UI is intentionally superseded by STEP 17',!dashboard.includes('Sync PLEASE Accounting')&&step17.includes('accounting_claim_outbox'));
pass('STEP 16 accounting history remains compatible with STEP 17 event source uniqueness',step16.includes('unique(source_system,source_event_id)')&&step17.includes('event_version'));
console.log('STEP 16 foundation / STEP 17 compatibility audit completed successfully.');
