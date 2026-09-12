'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('path');
const root=path.join(__dirname,'..');
const fnPath=path.join(root,'netlify/functions/admin-invoice-action.js');
const libPath=path.join(root,'netlify/functions/_admin-lib.js');
const notifyPath=path.join(root,'netlify/functions/_notify-lib.js');

function build({jobQty=2,jobUnit='hour'}={}){
  const invoice={id:'inv-1',invoice_number:'PLS-INV-1',job_id:'job-1',status:'DRAFT',payment_status:'UNPAID',invoice_date:'2026-09-12',due_date:'2026-09-12',gst_rate:5};
  const calls=[];
  const fakeLib={
    sameOrigin:()=>true,
    requireAdmin:async()=>({user:{id:'admin-1'}}),
    json:(status,body)=>({statusCode:status,body:JSON.stringify(body)}),
    sbJson:async(url,opt={})=>{
      calls.push({url,opt,body:opt.body?JSON.parse(opt.body):null});
      if(url.startsWith('/rest/v1/invoices?select='))return[invoice];
      if(url.startsWith('/rest/v1/jobs?select=id,billing_type'))return[{id:'job-1',billing_type:'HOURLY',customer_rate:50,billable_quantity:2,billing_unit:'hour',quoted_subtotal:100}];
      if(url.startsWith('/rest/v1/job_billing_items?select=id,quantity'))return[{id:'bill-1',quantity:jobQty,unit:jobUnit,customer_unit_rate:50,customer_line_total:100,provider_unit_rate:30,provider_line_total:60,sort_order:10}];
      return[];
    }
  };
  const fakeNotify={invoiceContext:async()=>invoice,send:async()=>({sent:true}),money:n=>`${n}`,baseUrl:()=>''};
  require.cache[require.resolve(libPath)]={exports:fakeLib};
  require.cache[require.resolve(notifyPath)]={exports:fakeNotify};
  delete require.cache[require.resolve(fnPath)];
  return {handler:require(fnPath).handler,calls};
}
function event(items){return{httpMethod:'POST',headers:{origin:'https://pleaseservice.ca'},body:JSON.stringify({action:'SAVE',invoice_id:'inv-1',client_name:'Maria Mendoza',client_email:'maria@example.com',client_phone:'',invoice_date:'2026-09-12',due_date:'2026-09-12',gst_rate:5,note:'Automatically prepared from completed Job PLS-JOB-1. Review before issue.',items})};}

test('changing final invoice rate updates Job subtotal and customer-side Job rate only',async()=>{
  const h=build();
  const res=await h.handler(event([{description:'Moving — Labour',qty:2,unit:'hour',unit_rate:100}]));
  assert.equal(res.statusCode,200);
  const body=JSON.parse(res.body);
  assert.equal(body.total_amount,210);
  assert.equal(body.line_sync,'CUSTOMER_RATES_SYNCED');
  const jobPatch=h.calls.find(c=>c.url.startsWith('/rest/v1/jobs?id=eq.job-1')&&c.opt.method==='PATCH');
  assert.equal(jobPatch.body.quoted_subtotal,200);
  assert.equal(jobPatch.body.customer_rate,100);
  const billPatch=h.calls.find(c=>c.url.startsWith('/rest/v1/job_billing_items?id=eq.bill-1')&&c.opt.method==='PATCH');
  assert.deepEqual(Object.keys(billPatch.body).sort(),['customer_unit_rate','updated_at'].sort());
  assert.equal(billPatch.body.customer_unit_rate,100);
});

test('structural invoice change preserves frozen Provider billing and syncs only final Job total',async()=>{
  const h=build({jobQty:2,jobUnit:'hour'});
  const res=await h.handler(event([{description:'Final service',qty:1,unit:'service',unit_rate:200}]));
  assert.equal(res.statusCode,200);
  const body=JSON.parse(res.body);
  assert.equal(body.line_sync,'FINAL_TOTAL_ONLY');
  assert.equal(h.calls.some(c=>c.url.startsWith('/rest/v1/job_billing_items?id=eq.bill-1')&&c.opt.method==='PATCH'),false);
  const jobPatch=h.calls.find(c=>c.url.startsWith('/rest/v1/jobs?id=eq.job-1')&&c.opt.method==='PATCH');
  assert.equal(jobPatch.body.quoted_subtotal,200);
});
