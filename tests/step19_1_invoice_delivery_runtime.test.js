'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('path');
const root=path.join(__dirname,'..');
const fnPath=path.join(root,'netlify/functions/admin-invoice-delivery-action.js');
const libPath=path.join(root,'netlify/functions/_admin-lib.js');
const notifyPath=path.join(root,'netlify/functions/_notify-lib.js');

function buildHarness({invoice,sendResult={sent:true},priorReview=false}={}){
  process.env.PLEASE_ETRANSFER_EMAIL='payments@example.com';
  process.env.PLEASE_GOOGLE_REVIEW_URL='https://example.com/review';
  let state={...invoice};
  const histories=[];
  const patches=[];
  const sent=[];
  const fakeLib={
    sameOrigin:()=>true,
    requireAdmin:async()=>({user:{id:'admin-1'}}),
    json:(status,body)=>({statusCode:status,body:JSON.stringify(body)}),
    sbJson:async(url,opt={})=>{
      if(url.startsWith('/rest/v1/invoices?select='))return [state];
      if(url.startsWith('/rest/v1/invoices?id=eq.')&&opt.method==='PATCH'){
        const patch=JSON.parse(opt.body||'{}');patches.push(patch);state={...state,...patch};return [];
      }
      if(url==='/rest/v1/invoice_status_history'&&opt.method==='POST'){
        histories.push(JSON.parse(opt.body||'{}'));return [];
      }
      if(url.startsWith('/rest/v1/invoice_status_history?'))return priorReview?[{id:'h1',note:'STEP19.1 GOOGLE REVIEW REQUEST SENT'}]:[];
      throw new Error(`Unexpected sbJson call ${url}`);
    }
  };
  const fakeNotify={
    baseUrl:()=> 'https://pleaseservice.ca',
    money:n=>`${Number(n||0).toFixed(2)} CAD`,
    invoiceContext:async()=>({...state}),
    jobContext:async()=>({service_name:'Lawn Service'}),
    send:async opts=>{sent.push(opts);return sendResult}
  };
  require.cache[require.resolve(libPath)]={exports:fakeLib};
  require.cache[require.resolve(notifyPath)]={exports:fakeNotify};
  delete require.cache[require.resolve(fnPath)];
  const handler=require(fnPath).handler;
  return {handler,getState:()=>state,histories,patches,sent};
}

function event(action,invoiceId='inv-1'){
  return {httpMethod:'POST',headers:{origin:'https://pleaseservice.ca'},body:JSON.stringify({action,invoice_id:invoiceId})};
}

test('DRAFT invoice becomes SENT only after successful customer email',async()=>{
  const h=buildHarness({invoice:{id:'inv-1',invoice_number:'PLS-INV-1',job_id:'job-1',client_name:'Client',client_email:'client@example.com',total_amount:110.25,due_date:'2026-09-10',public_token:'tok-12345678901234567890',status:'DRAFT',payment_status:'UNPAID'}});
  const res=await h.handler(event('SEND_INVOICE'));
  assert.equal(res.statusCode,200);
  assert.equal(h.getState().status,'SENT');
  assert.equal(h.patches[0].status,'ISSUED');
  assert.equal(h.patches[1].status,'SENT');
  assert.equal(h.sent.length,1);
  assert.equal(h.sent[0].ctaLabel,'PAY NOW');
  assert.match(h.sent[0].message,/e-Transfer/);
  assert.equal(h.histories.length,2);
});

test('email failure leaves invoice ISSUED and retryable instead of falsely SENT',async()=>{
  const h=buildHarness({invoice:{id:'inv-1',invoice_number:'PLS-INV-1',job_id:'job-1',client_name:'Client',client_email:'client@example.com',total_amount:110.25,due_date:'2026-09-10',public_token:'tok-12345678901234567890',status:'DRAFT',payment_status:'UNPAID'},sendResult:{sent:false,error:'temporary mail error'}});
  const res=await h.handler(event('SEND_INVOICE'));
  assert.equal(res.statusCode,502);
  assert.equal(h.getState().status,'ISSUED');
  assert.equal(h.patches.length,1);
  assert.match(JSON.parse(res.body).error,/Use SEND TO CUSTOMER to retry/);
});

test('review request is selective, paid-only and traceable',async()=>{
  const h=buildHarness({invoice:{id:'inv-1',invoice_number:'PLS-INV-1',job_id:'job-1',client_name:'Client',client_email:'client@example.com',total_amount:110.25,public_token:'tok-12345678901234567890',status:'PAID',payment_status:'PAID'}});
  const res=await h.handler(event('SEND_REVIEW'));
  assert.equal(res.statusCode,200);
  assert.equal(h.sent.length,1);
  assert.equal(h.sent[0].ctaLabel,'LEAVE A GOOGLE REVIEW');
  assert.match(h.histories[0].note,/STEP19\.1 GOOGLE REVIEW REQUEST SENT/);
});

test('duplicate Google review request is blocked before sending',async()=>{
  const h=buildHarness({invoice:{id:'inv-1',invoice_number:'PLS-INV-1',job_id:'job-1',client_name:'Client',client_email:'client@example.com',total_amount:110.25,public_token:'tok-12345678901234567890',status:'PAID',payment_status:'PAID'},priorReview:true});
  const res=await h.handler(event('SEND_REVIEW'));
  assert.equal(res.statusCode,409);
  assert.equal(h.sent.length,0);
  assert.match(JSON.parse(res.body).error,/already sent/);
});
