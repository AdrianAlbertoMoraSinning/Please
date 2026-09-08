'use strict';
const path=require('path'),assert=require('assert');const root=path.resolve(__dirname,'../netlify/functions'),calls=[];
const assetOpen={id:'asset-open',asset_number:'FA-OPEN',source_type:'OPENING',purchase_date:'2026-01-01',capital_cost:100,opening_accumulated_depreciation:20};
const assetDep={id:'asset-dep',asset_number:'FA-DEP',source_type:'MANUAL',capital_cost:100,opening_accumulated_depreciation:0,status:'ACTIVE'};
const assetDispose={id:'asset-dispose',asset_number:'FA-DISP',source_type:'MANUAL',status:'DISPOSED',capital_cost:100,disposal_date:'2026-09-07',disposal_proceeds:80,disposal_financial_account_id:'fin-bank',disposal_accumulated_depreciation:30,disposal_net_book_value:70};
const run={id:'run-1',run_number:'DEP-000001',period_end:'2026-09-30',total_depreciation:10,status:'POSTED'},depLines=[{id:'dl1',depreciation_run_id:'run-1',asset_id:'asset-dep',depreciation_amount:10}];
const rules={FIXED_ASSET_OPENING_POSTED:{debit_account_code:'1500',credit_account_code:'3000',configuration_json:{accumulated_depreciation_account:'1510'}},FIXED_ASSET_DEPRECIATION_POSTED:{debit_account_code:'6200',credit_account_code:'1510',configuration_json:{}},FIXED_ASSET_DISPOSAL_POSTED:{debit_account_code:'1510',credit_account_code:'1500',configuration_json:{gain_account:'4050',loss_account:'6300'}}};let seq=0;
const fake={sbJson:async(url,opt={})=>{const body=opt.body?JSON.parse(opt.body):null;calls.push({url,method:opt.method||'GET',body});
 if(url.includes('/accounting_posting_rules?')){const m=url.match(/event_type=eq\.([^&]+)/);return[rules[decodeURIComponent(m?.[1]||'')]||null].filter(Boolean)}
 if(url.includes('/accounting_fixed_assets?id=eq.asset-open'))return[assetOpen];if(url.includes('/accounting_fixed_assets?id=eq.asset-dep'))return[assetDep];if(url.includes('/accounting_fixed_assets?id=eq.asset-dispose'))return[assetDispose];
 if(url.includes('/accounting_fixed_asset_depreciation_runs?id=eq.run-1'))return[run];if(url.includes('/accounting_fixed_asset_depreciation_lines?depreciation_run_id=eq.run-1'))return depLines;
 if(url.includes('/accounting_financial_accounts?id=eq.fin-bank'))return[{id:'fin-bank',name:'Operating Bank',financial_type:'BANK',currency:'CAD',gl_account_id:'gl-bank',active:true}];if(url.includes('/accounting_accounts?id=eq.gl-bank'))return[{id:'gl-bank',code:'1000',name:'Operating Bank',account_type:'ASSET',active:true}];
 if(url.startsWith('/rest/v1/accounting_external_events?'))return[];if(url==='/rest/v1/accounting_external_events'&&opt.method==='POST')return[{id:`evt-${++seq}`,posting_status:'PENDING'}];if(url.startsWith('/rest/v1/accounting_external_events?id=eq.')&&opt.method==='PATCH')return null;if(url.startsWith('/rest/v1/please_accounting_outbox?id=eq.')&&opt.method==='PATCH')return null;
 if(url.startsWith('/rest/v1/accounting_accounts?code=eq.')){const code=decodeURIComponent((url.match(/code=eq\.([^&]+)/)||[])[1]||'0000');return[{id:`acc-${code}`,code}]};if(url==='/rest/v1/rpc/accounting_post_event_journal')return[{accounting_post_event_journal:`journal-${seq}`}];
 throw new Error(`Unexpected ${opt.method||'GET'} ${url}`)}};
require.cache[require.resolve(path.join(root,'_admin-lib.js'))]={exports:fake};const acct=require(path.join(root,'_cal-accounting-lib.js'));
function row(id,type,payload={}){return{id:`out-${id}-${type}`,event_key:`PLEASE:${type}:${id}`,event_type:type,event_version:1,source_table:type==='FIXED_ASSET_DEPRECIATION_POSTED'?'accounting_fixed_asset_depreciation_runs':'accounting_fixed_assets',source_record_id:id,source_reference:id,occurred_at:'2026-09-07T12:00:00Z',payload_json:payload,attempts:1}}
async function runCase(r,expected){const before=calls.length,res=await acct.processOutboxEvent(r,{workerId:'fa-test'});assert.strictEqual(res.status,'POSTED');const post=calls.slice(before).find(c=>c.url==='/rest/v1/rpc/accounting_post_event_journal');assert.ok(post);assert.deepStrictEqual(post.body.p_lines.map(x=>({code:x.code,debit:x.debit,credit:x.credit})),expected)}
(async()=>{
 await runCase(row('asset-open','FIXED_ASSET_OPENING_POSTED',{fixed_asset:assetOpen}),[{code:'1500',debit:100,credit:0},{code:'1510',debit:0,credit:20},{code:'3000',debit:0,credit:80}]);
 await runCase(row('run-1','FIXED_ASSET_DEPRECIATION_POSTED',{depreciation_run:run,lines:depLines}),[{code:'6200',debit:10,credit:0},{code:'1510',debit:0,credit:10}]);
 await runCase(row('asset-dispose','FIXED_ASSET_DISPOSAL_POSTED',{fixed_asset:assetDispose}),[{code:'1000',debit:80,credit:0},{code:'1510',debit:30,credit:0},{code:'1500',debit:0,credit:100},{code:'4050',debit:0,credit:10}]);
 console.log('STEP 18.7 FIXED ASSET WORKER RUNTIME PASS');
})().catch(e=>{console.error(e);process.exit(1)});
