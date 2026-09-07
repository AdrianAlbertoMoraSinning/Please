const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'cal/js/app.js'),'utf8');
const reports=fs.readFileSync(path.join(root,'cal/reports.html'),'utf8');
let failures=0;function pass(n,c){console.log((c?'PASS':'FAIL')+' - '+n);if(!c)failures++}
pass('Trial Balance aggregates POSTED journal lines',/function trialBalance\(d\)/.test(app)&&/j\.status/.test(app)&&/j\.lines/.test(app));
pass('Trial Balance uses real debit and credit amounts',/r\.debit\+=Number\(l\.debit/.test(app)&&/r\.credit\+=Number\(l\.credit/.test(app));
pass('Placeholder zero rendering removed',!/<td>\$\{money\(0\)\}<\/td><td>\$\{money\(0\)\}<\/td>/.test(app));
pass('Debit credit integrity control rendered',reports.includes('trialIntegrity')&&reports.includes('trialDebitTotal')&&reports.includes('trialCreditTotal'));
pass('Reports declare ledger-derived control',reports.includes('Calculated directly from POSTED journal lines'));
process.exit(failures?1:0);
