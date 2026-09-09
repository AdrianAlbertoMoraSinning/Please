'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const exists=p=>fs.existsSync(path.join(root,p));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
let failed=false;const pass=(name,ok)=>{console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)failed=true};
const protectedHashes={
'index.html':'37606e19e13b019e6ae7465e0723edd5896f2cc5e15760d8de6b341f0f7dae57',
'work-with-us.html':'531bf6b4be655acd9e99bb17ce21efa70cea0f836ab800b0c30a1e890dd6de97',





'service-request.html':'bf8001b0669a45108d6eb71d05e5df11e6902252742e29cdf902c83179d4525d',
'track-request.html':'658412a1179cc9fd47af989394ce438fab4120485aaa14394bb48cd0abd1f33e',

'stripe-webhook.js':'ae22531e33508826be005cb9d5dc9e0dabba1bef4ed2179af9d37dcc9a567812',
'admin-provider-payment-action.js':'f74fa51e9b45e91bc2ee4b2d53672a760a1df7a03e627944441022101b639e02'
};
pass('Legacy protected public/operations files not intentionally evolved by STEP 19 remain byte-identical to accepted STEP 18.11 baseline',Object.entries(protectedHashes).every(([p,h])=>exists(p)&&hash(p)===h));
const home=read('index.html');
pass('Public Home remains PLEASE, not CAL',home.includes('PLEASE Services | Any Service in One Place | Calgary')&&home.includes('Need help?')&&home.includes('Just PLEASE.')&&!/CAL 1\.5|Canadian Accounting by Lottus/.test(home));
pass('Public Home keeps quote and booking CTAs',home.includes('GET A FREE QUOTE')&&home.includes('BOOK YOUR SERVICE')&&home.includes('service-request.html?mode=book'));
const req=read('service-request.html');
pass('Service Request surface exists and remains public workflow',/BOOK YOUR SERVICE|Service Request|Request Service/i.test(req)&&exists('netlify/functions/public-booking.js'));
const track=read('track-request.html');
pass('Customer tracking surface remains present',/track/i.test(track)&&exists('netlify/functions/public-request-tracking.js')&&exists('js/track-request.js'));
const pay=read('payment.html');
pass('Payment page remains connected to Stripe checkout path',/secure online checkout|payment/i.test(pay)&&exists('invoice.html')&&exists('js/invoice.js')&&exists('netlify/functions/invoice-checkout.js')&&exists('stripe-webhook.js'));
pass('Stripe success/cancel recovery surfaces remain present',exists('payment-success.html')&&exists('payment-cancelled.html')&&exists('tests/step15_9_3_stripe_webhook_runtime.test.js'));
pass('Provider application and Provider Portal surfaces remain present',exists('work-with-us.html')&&exists('provider.html')&&exists('provider-login.html'));
pass('Admin operational surfaces remain present',['admin-dashboard.html','admin-service-requests.html','admin-jobs.html','admin-providers.html','admin-provider-payments.html','admin-invoices.html','admin-calendar.html'].every(exists));
pass('Provider payment action remains separate from CAL supplier payments',exists('admin-provider-payment-action.js')&&read('admin-provider-payment-action.js').includes('provider'));
pass('No CAL page replaced root Home',!home.includes('/cal/integration')&&!home.includes('Accountant & Compliance Center'));
if(failed)process.exit(1);console.log('STEP 18.12 public/operations regression gate completed successfully.');
