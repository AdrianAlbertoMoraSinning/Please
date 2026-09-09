'use strict';const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('node:assert/strict'),test=require('node:test');const root=path.join(__dirname,'..');const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const protectedHashes={
'index.html':'37606e19e13b019e6ae7465e0723edd5896f2cc5e15760d8de6b341f0f7dae57',
'service-request.html':'bf8001b0669a45108d6eb71d05e5df11e6902252742e29cdf902c83179d4525d',
'track-request.html':'658412a1179cc9fd47af989394ce438fab4120485aaa14394bb48cd0abd1f33e',
'stripe-webhook.js':'ae22531e33508826be005cb9d5dc9e0dabba1bef4ed2179af9d37dcc9a567812',
'admin-provider-payment-action.js':'f74fa51e9b45e91bc2ee4b2d53672a760a1df7a03e627944441022101b639e02',
'invoice.html':'599a67503d10c9113b4a62e576812f6649ce81d63c850a4673d1b80dc9b84a18',
'js/invoice.js':'5105447b9b92d76a84f5cca42916d321de0d94c77e1239dc6d6577680f76ce9d',
'netlify/functions/invoice-checkout.js':'570626097b70d025a30090df4c99dd00b325cb2b785010c3b75393a1a5fc98bc',
'payment-success.html':'db4a37f4cf01996245f23c537db85dc1c7f88ecf7086b392b5d634e08a4572ab',
'payment-cancelled.html':'c6c75d315daef30b1e5b65ccf4099fb9d53f80aa5b9b22dd5388d3b8b9ec0d3e',
'netlify/functions/public-booking.js':'4097890a07e3e74454d00c1d70af9a35a9adaa71717b66ceeae05083e542fd40',
'netlify/functions/public-request-tracking.js':'0e5cbcb686a3d4f2901fb47cd8769a7b620129fff0430b5dadc4149d9a29cca6',
'netlify/functions/admin-invoice-action.js':'8afe9a402e088da72f682c38f132f17e77d636c9b046358141ab1836e2ece9f4',
'netlify/functions/cal-purchases.js':'951811255fe2732cfa2af9bee2356043e5b2f5ba64586ac83d3d7192e7ebbbca',
'netlify/functions/cal-expenses.js':'8748d43d6285f10ed21d5c567f690d40224aa5d6807d00ebbfc07b1afe07a15f',
'netlify/functions/cal-banking.js':'30eefcfa5518162da34ff3e745ecc2e2c3396a595faf4d8fd47dae133897324a'};
for(const [p,h] of Object.entries(protectedHashes))test(`baseline protected: ${p}`,()=>assert.equal(hash(p),h));
