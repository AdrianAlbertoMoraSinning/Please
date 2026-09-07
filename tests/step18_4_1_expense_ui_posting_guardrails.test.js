'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
function pass(name,ok){if(!ok){console.error('FAIL',name);process.exitCode=1}else console.log('PASS',name)}
const html=read('cal/expenses.html'),css=read('cal/css/style.css'),js=read('cal/js/expenses.js'),api=read('netlify/functions/cal-expenses.js'),mirror=read('cal-expenses.js');
pass('Expense KPI cards use standard CAL KPI structure',/expense-kpis/.test(html)&&/card kpi accent-orange/.test(html)&&/class="label">Awaiting Approval/.test(html)&&/class="value" id="kSubmitted"/.test(html)&&/class="note">Submitted expenses/.test(html));
pass('Expense KPI CSS prevents inline overlap and wraps safely',css.includes('.expense-kpis .card{min-height:132px;display:flex;flex-direction:column')&&css.includes('.expense-kpis .value{display:block')&&css.includes('overflow-wrap:anywhere'));
pass('Vendor selector is supplier-scoped',js.includes('state.vendors.map')&&api.includes("return s.has('SUPPLIER')"));
pass('Expense payment accounts exclude clearing/loan/other accounts',api.includes("['BANK','CASH','CREDIT_CARD'].includes")&&!api.includes("financialAccounts:[...fm.values()],counts"));
pass('Expense GL selector is classification-aware',js.includes('function eligibleAccounts')&&js.includes("c==='PREPAID'")&&js.includes("c==='FIXED_ASSET'"));
pass('Inventory expense posting is deferred until STEP 18.6',js.includes('INVENTORY (STEP 18.6)')&&api.includes('Inventory expense posting is reserved for STEP 18.6'));
pass('Server enforces prepaid and fixed-asset posting accounts',api.includes('PREPAID classification requires the Prepaid Expenses account')&&api.includes('FIXED_ASSET classification requires the Fixed Asset account'));
pass('Netlify and root function mirrors remain identical',api===mirror);
const baseline='/mnt/data/step184_work/Please-main';
for(const f of ['index.html','provider.html','admin-dashboard.html','service-request.html','track-request.html','payment.html','stripe-webhook.js','admin-provider-payment-action.js','cal/purchases.html','cal/invoices.html','netlify/functions/_cal-accounting-lib.js']){
  const a=path.join(root,f),b=path.join(baseline,f);pass(`Protected baseline unchanged: ${f}`,fs.existsSync(a)&&fs.existsSync(b)&&hash(f)===crypto.createHash('sha256').update(fs.readFileSync(b)).digest('hex'));
}
if(process.exitCode)process.exit(process.exitCode);console.log('STEP 18.4.1 Expense UI & Posting Guardrails audit completed successfully.');
