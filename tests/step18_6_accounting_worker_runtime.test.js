'use strict';
const path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'../netlify/functions'),calls=[];
const IDs={item:'11111111-1111-1111-1111-111111111111',inv:'22222222-2222-2222-2222-222222222222',cogs:'33333333-3333-3333-3333-333333333333',adj:'44444444-4444-4444-4444-444444444444'};
const movements={
 open:{id:'open',movement_number:'IM-OPEN',movement_type:'OPENING',movement_date:'2026-09-07',item_id:IDs.item,value_delta:100},
 issue:{id:'issue',movement_number:'IM-ISSUE',movement_type:'ISSUE',movement_date:'2026-09-08',item_id:IDs.item,value_delta:-40},
 gain:{id:'gain',movement_number:'IM-GAIN',movement_type:'ADJUSTMENT_GAIN',movement_date:'2026-09-09',item_id:IDs.item,value_delta:15},
 loss:{id:'loss',movement_number:'IM-LOSS',movement_type:'ADJUSTMENT_LOSS',movement_date:'2026-09-10',item_id:IDs.item,value_delta:-10}
};
let seq=0;
const rules={
 INVENTORY_OPENING_POSTED:{debit_account_code:'1600',credit_account_code:'3000',configuration_json:{}},
 INVENTORY_ISSUE_POSTED:{debit_account_code:'6000',credit_account_code:'1600',configuration_json:{}},
 INVENTORY_ADJUSTMENT_POSTED:{debit_account_code:'6100',credit_account_code:'1600',configuration_json:{gain_credit_account:'6100'}}
};
const fake={
 sbJson:async(url,opt={})=>{const body=opt.body?JSON.parse(opt.body):null;calls.push({url,method:opt.method||'GET',body});
   if(url.includes('/accounting_posting_rules?')){const m=url.match(/event_type=eq\.([^&]+)/);return[rules[decodeURIComponent(m?.[1]||'')]||null].filter(Boolean);}
   if(url.startsWith('/rest/v1/accounting_inventory_movements?id=eq.')){const id=decodeURIComponent((url.match(/id=eq\.([^&]+)/)||[])[1]||'');return movements[id]?[movements[id]]:[];}
   if(url.startsWith(`/rest/v1/accounting_inventory_items?id=eq.${IDs.item}`))return[{id:IDs.item,sku:'TEST-ITEM',name:'Test Item',inventory_account_id:IDs.inv,cogs_account_id:IDs.cogs,adjustment_account_id:IDs.adj}];
   if(url.startsWith(`/rest/v1/accounting_accounts?id=eq.${IDs.inv}`))return[{id:IDs.inv,code:'1600',name:'Inventory',account_type:'ASSET',active:true}];
   if(url.startsWith(`/rest/v1/accounting_accounts?id=eq.${IDs.cogs}`))return[{id:IDs.cogs,code:'6000',name:'Cost of Goods Sold',account_type:'EXPENSE',active:true}];
   if(url.startsWith(`/rest/v1/accounting_accounts?id=eq.${IDs.adj}`))return[{id:IDs.adj,code:'6100',name:'Inventory Adjustments',account_type:'EXPENSE',active:true}];
   if(url.startsWith('/rest/v1/accounting_external_events?'))return[];
   if(url==='/rest/v1/accounting_external_events'&&opt.method==='POST')return[{id:`evt-${++seq}`,posting_status:'PENDING'}];
   if(url.startsWith('/rest/v1/accounting_external_events?id=eq.')&&opt.method==='PATCH')return null;
   if(url.startsWith('/rest/v1/please_accounting_outbox?id=eq.')&&opt.method==='PATCH')return null;
   if(url.startsWith('/rest/v1/accounting_accounts?code=eq.')){const code=decodeURIComponent((url.match(/code=eq\.([^&]+)/)||[])[1]||'0000');return[{id:`acc-${code}`,code}]}
   if(url==='/rest/v1/rpc/accounting_post_event_journal')return[{accounting_post_event_journal:`journal-${seq}`}];
   throw new Error(`Unexpected ${opt.method||'GET'} ${url}`);
 }
};
require.cache[require.resolve(path.join(root,'_admin-lib.js'))]={exports:fake};
const acct=require(path.join(root,'_cal-accounting-lib.js'));
function row(id,type){return{id:`out-${id}`,event_key:`PLEASE:${type}:${id}`,event_type:type,event_version:1,source_table:'accounting_inventory_movements',source_record_id:id,source_reference:movements[id].movement_number,occurred_at:`${movements[id].movement_date}T12:00:00Z`,payload_json:{inventory_movement:movements[id]},attempts:1}}
async function run(id,type,expected){const before=calls.length,r=await acct.processOutboxEvent(row(id,type),{workerId:'inventory-test'});assert.strictEqual(r.status,'POSTED');const post=calls.slice(before).find(c=>c.url==='/rest/v1/rpc/accounting_post_event_journal');assert.ok(post,`Journal post missing for ${id}`);assert.deepStrictEqual(post.body.p_lines.map(x=>({code:x.code,debit:x.debit,credit:x.credit})),expected);}
(async()=>{
 await run('open','INVENTORY_OPENING_POSTED',[{code:'1600',debit:100,credit:0},{code:'3000',debit:0,credit:100}]);
 await run('issue','INVENTORY_ISSUE_POSTED',[{code:'6000',debit:40,credit:0},{code:'1600',debit:0,credit:40}]);
 await run('gain','INVENTORY_ADJUSTMENT_POSTED',[{code:'1600',debit:15,credit:0},{code:'6100',debit:0,credit:15}]);
 await run('loss','INVENTORY_ADJUSTMENT_POSTED',[{code:'6100',debit:10,credit:0},{code:'1600',debit:0,credit:10}]);
 console.log('STEP 18.6 INVENTORY WORKER RUNTIME PASS');
})().catch(e=>{console.error(e);process.exit(1)});
