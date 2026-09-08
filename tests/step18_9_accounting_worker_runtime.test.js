'use strict';
const path=require('path'),assert=require('assert');const root=path.resolve(__dirname,'../netlify/functions'),calls=[];let seq=0;
const adjustment={id:'adj-1',adjustment_number:'ADJ-000001',period_id:'period-1',entry_date:'2026-08-31',memo:'Accrue professional fees',status:'POSTED',lines_json:[{code:'5500',debit:100,credit:0,description:'Accrual'},{code:'2000',debit:0,credit:100,description:'A/P accrual'}]};
const fake={sbJson:async(url,opt={})=>{const body=opt.body?JSON.parse(opt.body):null;calls.push({url,method:opt.method||'GET',body});
 if(url.includes('/accounting_posting_rules?'))return[];
 if(url.includes('/accounting_period_adjustments?id=eq.adj-1'))return[adjustment];
 if(url.startsWith('/rest/v1/accounting_external_events?'))return[];
 if(url==='/rest/v1/accounting_external_events'&&opt.method==='POST')return[{id:`evt-${++seq}`,posting_status:'PENDING'}];
 if(url.startsWith('/rest/v1/accounting_external_events?id=eq.')&&opt.method==='PATCH')return null;
 if(url.startsWith('/rest/v1/please_accounting_outbox?id=eq.')&&opt.method==='PATCH')return null;
 if(url.startsWith('/rest/v1/accounting_accounts?code=eq.')){const code=decodeURIComponent((url.match(/code=eq\.([^&]+)/)||[])[1]||'0000');return[{id:`acc-${code}`,code}]}
 if(url.startsWith('/rest/v1/accounting_accounts?code=eq.1000'))return[{id:'acc-1000',code:'1000'}];
 if(url.startsWith('/rest/v1/accounting_accounts?'))return[];
 if(url==='/rest/v1/accounting_accounts'&&opt.method==='POST')return[{id:'created'}];
 if(url==='/rest/v1/rpc/accounting_post_event_journal')return[{accounting_post_event_journal:'journal-1'}];
 throw new Error(`Unexpected ${opt.method||'GET'} ${url}`)}};
require.cache[require.resolve(path.join(root,'_admin-lib.js'))]={exports:fake};const acct=require(path.join(root,'_cal-accounting-lib.js'));
(async()=>{const row={id:'out-adj-1',event_key:'PLEASE:PERIOD_CLOSE_ADJUSTMENT_POSTED:adj-1',event_type:'PERIOD_CLOSE_ADJUSTMENT_POSTED',event_version:1,source_table:'accounting_period_adjustments',source_record_id:'adj-1',source_reference:'ADJ-000001',occurred_at:'2026-09-01T00:00:00Z',payload_json:{period_adjustment:adjustment,lines:adjustment.lines_json},attempts:1};const res=await acct.processOutboxEvent(row,{workerId:'period-close-test'});assert.strictEqual(res.status,'POSTED');const post=calls.find(c=>c.url==='/rest/v1/rpc/accounting_post_event_journal');assert.ok(post);assert.strictEqual(post.body.p_entry_date,'2026-08-31');assert.strictEqual(post.body.p_lines.length,2);assert.deepStrictEqual(post.body.p_lines.map(x=>({code:x.code,debit:x.debit,credit:x.credit})),[{code:'5500',debit:100,credit:0},{code:'2000',debit:0,credit:100}]);console.log('STEP 18.9 PERIOD CLOSE WORKER RUNTIME PASS')})().catch(e=>{console.error(e);process.exit(1)});
