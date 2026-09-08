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
pass('Inventory guardrail is superseded safely by STEP 18.6',js.includes("c==='INVENTORY'")&&api.includes("classification==='INVENTORY'")&&api.includes('account 1600 Inventory'));
pass('Server enforces prepaid and fixed-asset posting accounts',api.includes('PREPAID classification requires the Prepaid Expenses account')&&api.includes('FIXED_ASSET classification requires the Fixed Asset account'));
pass('Netlify and root function mirrors remain identical',api===mirror);
const protectedHashes={
'index.html':'37606e19e13b019e6ae7465e0723edd5896f2cc5e15760d8de6b341f0f7dae57',
'provider.html':'1b63e313b17c5213869181bc25fd3cf6f235c7bff4013c72515caa5f46c05969',
'admin-dashboard.html':'82d9f83eeaf65fcfe80bf09478dfe0e7ceb512e13189b047d245ad10b1cf03a9',
'service-request.html':'bf8001b0669a45108d6eb71d05e5df11e6902252742e29cdf902c83179d4525d',
'track-request.html':'658412a1179cc9fd47af989394ce438fab4120485aaa14394bb48cd0abd1f33e',
'payment.html':'122a5eea2ca3315e605778adbe19a1db54de5160a50f98f94a3a62ce9dd0d420',
'stripe-webhook.js':'ae22531e33508826be005cb9d5dc9e0dabba1bef4ed2179af9d37dcc9a567812',
'admin-provider-payment-action.js':'f74fa51e9b45e91bc2ee4b2d53672a760a1df7a03e627944441022101b639e02'
};
for(const [f,h] of Object.entries(protectedHashes))pass(`Protected operational baseline unchanged: ${f}`,hash(f)===h);
if(process.exitCode)process.exit(process.exitCode);console.log('STEP 18.4.1 Expense UI & Posting Guardrails audit completed successfully.');
