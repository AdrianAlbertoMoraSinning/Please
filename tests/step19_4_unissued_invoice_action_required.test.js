'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('Dashboard counts DRAFT invoices as an ACTION REQUIRED priority',()=>{
  const fn=read('netlify/functions/admin-dashboard-data.js');
  assert.match(fn,/draftInvoices/);
  assert.match(fn,/\/rest\/v1\/invoices\?select=.*status=eq\.DRAFT/);
  assert.match(fn,/key:'unissued_invoices'/);
  assert.match(fn,/label:'Invoices Ready to Issue'/);
  assert.match(fn,/admin-invoices\.html\?status=DRAFT&action_required=1/);
  assert.match(fn,/count:\(draftInvoices\|\|\[\]\)\.length/);
});

test('Invoice Center supports the Dashboard action-required deep link and DRAFT filter',()=>{
  const js=read('js/admin-invoices.js');
  assert.match(js,/initialStatus=String\(urlParams\.get\('status'\)\|\|'ALL'\)\.toUpperCase\(\)/);
  assert.match(js,/actionRequired=urlParams\.get\('action_required'\)==='1'/);
  assert.match(js,/allowed\.has\(initialStatus\).*invoice-status.*initialStatus/s);
  assert.match(js,/invoice-action-required.*hidden=!actionRequired/);
});

test('Action-required Invoice view remains a complete review queue, not a duplicate billing screen',()=>{
  const html=read('admin-invoices.html'),js=read('js/admin-invoices.js');
  assert.match(html,/ACTION REQUIRED/);
  assert.match(html,/Invoices Ready to Issue/);
  assert.match(html,/final customer amount/);
  assert.match(html,/SEND INVOICE/);
  assert.match(html,/Job \/ Service/);
  assert.match(js,/j\?\.service_name/);
  assert.match(js,/openInvoice\(b\.dataset\.view\)/);
});

test('Action-required queue is oldest-first and clears as invoices leave DRAFT',()=>{
  const js=read('js/admin-invoices.js');
  assert.match(js,/if\(actionRequired&&st==='DRAFT'\)rows=\[\.\.\.rows\]\.sort/);
  assert.match(js,/data\.invoices\.filter\(i=>i\.status==='DRAFT'\)/);
  assert.match(js,/No draft invoices are waiting to be issued/);
});

test('STEP 19.4 cache-busts the two Administration entry points',()=>{
  const dash=read('admin-dashboard.html'),inv=read('admin-invoices.html');
  assert.match(dash,/js\/admin-dashboard\.js\?v=19\.4/);
  assert.match(inv,/js\/admin-invoices\.js\?v=19\.4/);
});
