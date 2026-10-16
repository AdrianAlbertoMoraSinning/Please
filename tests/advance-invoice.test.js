const test=require('node:test');
const assert=require('node:assert/strict');
const lib=require('../netlify/functions/_admin-lib');
const notify=require('../netlify/functions/_notify-lib');
const invoice=require('../netlify/functions/admin-invoice-action');
const schedule=require('../netlify/functions/_job-schedule-lib');

test('advance invoice copies one flat amount without completing service or sending email; duplicate and cancellation stay blocked',async()=>{
 const old={requireAdmin:lib.requireAdmin,sameOrigin:lib.sameOrigin,sbJson:lib.sbJson},oldSend=notify.send;
 let status='CONFIRMED',exists=false;const calls=[];
 try{
  lib.requireAdmin=async()=>({user:{id:'admin'}});lib.sameOrigin=()=>true;notify.send=async()=>assert.fail('CREATE must not send emails');
  lib.sbJson=async(url,opt={})=>{const b=opt.body?JSON.parse(opt.body):null;calls.push({url,opt,b});
   if(url.startsWith('/rest/v1/jobs?'))return[{id:'job',reference:'BCIT',status,customers:{first_name:'BCIT',email:'client@example.com'}}];
   if(url.startsWith('/rest/v1/invoices?select=id,invoice_number'))return exists?[{id:'inv',invoice_number:'existing'}]:[];
   if(url==='/rest/v1/invoices'&&opt.method==='POST')return[{id:'inv',...b}];
   if(url.startsWith('/rest/v1/job_billing_items?'))return[{description:'Transport October 19–23',quantity:1,unit:'service',customer_unit_rate:1000,customer_line_total:1000}];
   return[];
  };
  const event={httpMethod:'POST',body:JSON.stringify({action:'CREATE',job_id:'job'})};
  assert.equal((await invoice.handler(event)).statusCode,200);
  const item=calls.find(c=>c.url==='/rest/v1/invoice_items').b[0];assert.equal(item.qty,1);assert.equal(item.line_total,1000);
  const created=calls.find(c=>c.url==='/rest/v1/invoices').b;assert.equal(created.status,'DRAFT');assert.match(created.note,/Advance invoice/);
  assert.equal(calls.some(c=>c.url.startsWith('/rest/v1/jobs')&&c.opt.method==='PATCH'),false);
  exists=true;assert.equal((await invoice.handler(event)).statusCode,409);
  exists=false;status='CANCELLED';assert.equal((await invoice.handler(event)).statusCode,409);
 }finally{Object.assign(lib,old);notify.send=oldSend;}
});

test('issued advance invoice blocks changed charges before any schedule writes',async()=>{
 const old=lib.sbJson,JOB='11111111-1111-4111-8111-111111111111',A='22222222-2222-4222-8222-222222222222',B='33333333-3333-4333-8333-333333333333';
 try{
  lib.sbJson=async(url,opt={})=>{
   assert.equal(opt.method,undefined,'No mutation may occur before rejecting changed issued billing');
   if(url.startsWith('/rest/v1/jobs?'))return[{id:JOB,status:'CONFIRMED'}];
   if(url.includes('job_assignments?select=id,job_id,provider_id'))return[{id:A,provider_id:'provider',status:'CONFIRMED',scheduled_start:'2026-10-19T14:00:00Z',scheduled_end:'2026-10-19T22:00:00Z'}];
   if(url.includes('job_billing_items?'))return[{id:B,assignment_id:A,unit:'service',quantity:1,customer_unit_rate:1000}];
   if(url.includes('/invoices?'))return[{id:'issued'}];
   return[];
  };
  await assert.rejects(schedule.updateActiveJob({jobId:JOB,actorId:'admin',scheduledStart:'2026-10-19T14:00:00Z',scheduledEnd:'2026-10-19T22:00:00Z',billingOverrides:[{id:B,customer_unit_rate:1200}],notifyPeople:false}),e=>e.status===409&&/issued invoice/.test(e.message));
 }finally{lib.sbJson=old;}
});
