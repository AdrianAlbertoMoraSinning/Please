'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.join(__dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
function pass(name,ok){if(!ok){console.error('FAIL',name);process.exitCode=1}else console.log('PASS',name)}
const api=read('cal-fixed-assets.js'),mirror=read('netlify/functions/cal-fixed-assets.js'),js=read('cal/js/fixed-assets.js'),html=read('cal/fixed-assets.html'),sql=read('STEP18_7_FIXED_ASSETS.sql');
pass('Fixed Asset API loads active Business Partner roles',api.includes('accounting_party_roles?select=party_id,role,active&active=eq.true')&&api.includes('normalizedParties'));
pass('Responsible person assignment is role-guarded server-side',api.includes("RESPONSIBLE_ROLES=new Set(['EMPLOYEE','CONTRACTOR','OPERATIONAL_PROVIDER'])")&&api.includes("assertActivePartyRole(responsible,RESPONSIBLE_ROLES,'Responsible person')"));
pass('Opening supplier assignment requires Supplier role server-side',api.includes("assertActivePartyRole(supplier,new Set(['SUPPLIER']),'Supplier')"));
pass('UI filters Responsible and Supplier selectors by role',js.includes("const RESPONSIBLE_ROLES=['EMPLOYEE','CONTRACTOR','OPERATIONAL_PROVIDER']")&&js.includes("partyOptions('', ['SUPPLIER'])")&&js.includes('hasAnyRole'));
pass('UI explains Fixed Asset role constraints',html.includes('Employee, contractor or operational provider role.')&&html.includes('Only Business Partners with an active Supplier role.'));
pass('No STEP 18.7 SQL change is required by this hotfix',read('STEP18_7_1_FIXED_ASSET_PARTY_ROLE_GUARDRAILS.md').includes('No Supabase migration is required.'));
pass('Fixed Asset function mirrors remain identical',api===mirror);
const protectedHashes={'index.html':'37606e19e13b019e6ae7465e0723edd5896f2cc5e15760d8de6b341f0f7dae57','provider.html':'1b63e313b17c5213869181bc25fd3cf6f235c7bff4013c72515caa5f46c05969','admin-dashboard.html':'82d9f83eeaf65fcfe80bf09478dfe0e7ceb512e13189b047d245ad10b1cf03a9','service-request.html':'bf8001b0669a45108d6eb71d05e5df11e6902252742e29cdf902c83179d4525d','payment.html':'122a5eea2ca3315e605778adbe19a1db54de5160a50f98f94a3a62ce9dd0d420','stripe-webhook.js':'ae22531e33508826be005cb9d5dc9e0dabba1bef4ed2179af9d37dcc9a567812'};
pass('Public PLEASE and Stripe baseline stays byte-identical',Object.entries(protectedHashes).every(([f,h])=>hash(f)===h));
if(process.exitCode)process.exit(process.exitCode);console.log('STEP 18.7.1 Fixed Asset role guardrails audit completed successfully.');
