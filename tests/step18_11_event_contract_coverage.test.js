'use strict';
const fs=require('fs'),path=require('path');const root=path.join(__dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');function pass(name,ok,detail=''){if(!ok){console.error('FAIL',name,detail);process.exitCode=1}else console.log('PASS',name)}
const sql=read('STEP18_11_INTEGRATION.sql'),lib=read('_cal-accounting-lib.js');
const contract=[...sql.matchAll(/^ \('([A-Z0-9_]+)'.*'FINANCIAL_OUTBOX'/gm)].map(x=>x[1]);
const priorityBlock=(lib.match(/const FINANCIAL_EVENT_PRIORITY=Object\.freeze\(\{([\s\S]*?)\}\);/)||[])[1]||'';
const worker=[...priorityBlock.matchAll(/\b([A-Z][A-Z0-9_]+)\s*:/g)].map(x=>x[1]);
pass('Contract has exactly 22 financial event types',contract.length===22,contract.join(','));
pass('Worker has exactly 22 supported event types',worker.length===22,worker.join(','));
pass('SQL financial contract and worker event set are identical',contract.length===worker.length&&contract.every(x=>worker.includes(x))&&worker.every(x=>contract.includes(x)));
const sourceSql=['STEP17_NATIVE_ACCOUNTING_ENGINE.sql','STEP18_2_PURCHASES_AP.sql','STEP18_3_AR_CREDIT_NOTES_REFUNDS.sql','STEP18_4_ADVANCED_EXPENSE_WORKFLOW.sql','STEP18_6_INVENTORY_ACCOUNTING.sql','STEP18_7_FIXED_ASSETS.sql','STEP18_8_PAYROLL.sql','STEP18_9_ADVANCED_PERIOD_CLOSE.sql'].map(read).join('\n');
const enqueued=[...new Set([...sourceSql.matchAll(/accounting_enqueue_event\(\s*'([A-Z0-9_]+)'/g)].map(x=>x[1]))];
pass('Every statically enqueued financial event is in STEP 18.11 contract',enqueued.every(x=>contract.includes(x)),enqueued.filter(x=>!contract.includes(x)).join(','));
pass('No compliance contract is worker-supported',!['GIFI_WORKING_PAPER_CREATED','COMPLIANCE_OBLIGATION_CREATED','COMPLIANCE_APPROVAL_RECORDED','COMPLIANCE_EVIDENCE_RECORDED','ACCOUNTANT_PACKAGE_CREATED'].some(x=>worker.includes(x)));
if(process.exitCode)process.exit(process.exitCode);console.log('STEP 18.11 event contract coverage PASS');
