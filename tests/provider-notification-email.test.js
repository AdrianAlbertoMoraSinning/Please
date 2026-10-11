const test=require('node:test');
const assert=require('node:assert/strict');
const lib=require('../netlify/functions/_admin-lib');
const notify=require('../netlify/functions/_notify-lib');
const endpoint=require('../netlify/functions/admin-provider-notifications');
test('restoration refuses complaints and addresses outside approved contacts before changing delivery',async()=>{
  const old={requireAdmin:lib.requireAdmin,sameOrigin:lib.sameOrigin,sbJson:lib.sbJson},oldFetch=global.fetch,oldAdmins=notify.adminEmails;
  try{
    lib.requireAdmin=async()=>({user:{id:'admin'}});lib.sameOrigin=()=>true;
    lib.sbJson=async()=>[{id:'id',primary_email:'approved@example.com'}];notify.adminEmails=async()=>[];
    global.fetch=async(url,opts)=>{assert.notEqual(opts.method,'DELETE');return {ok:true,json:async()=>({origin:'complaint'})};};
    const event=email=>({httpMethod:'POST',body:JSON.stringify({action:'RESTORE_BOUNCED_EMAIL',provider_id:'11111111-1111-1111-1111-111111111111',email})});
    assert.equal((await endpoint.handler(event('approved@example.com'))).statusCode,409);
    assert.equal((await endpoint.handler(event('other@example.com'))).statusCode,403);
  }finally{Object.assign(lib,old);global.fetch=oldFetch;notify.adminEmails=oldAdmins;}
});
test('delivery checks paginate, filter known recipients and expose suppression origin',async()=>{
  const old={requireAdmin:lib.requireAdmin,sbJson:lib.sbJson},oldFetch=global.fetch,oldKey=process.env.RESEND_API_KEY;
  try{
    process.env.RESEND_API_KEY='test';lib.requireAdmin=async()=>({user:{id:'admin'}});
    lib.sbJson=async()=>[{primary_email:'blocked@example.com',email:'blocked@example.com'}];
    global.fetch=async url=>({ok:true,json:async()=>url.includes('/suppressions/')?{email:'blocked@example.com',origin:'bounce'}:{has_more:true,data:[{id:'11111111-1111-1111-1111-111111111111',to:['blocked@example.com'],last_event:'suppressed'},{id:'22222222-2222-2222-2222-222222222222',to:['customer@example.com']}]}});
    const response=await endpoint.handler({httpMethod:'GET'}),data=JSON.parse(response.body);
    assert.equal(data.emails.length,1);assert.equal(data.suppressions[0].origin,'bounce');assert.equal(data.next_cursor,'22222222-2222-2222-2222-222222222222');
    assert.equal((await endpoint.handler({httpMethod:'GET',queryStringParameters:{after:'bad'}})).statusCode,400);
  }finally{Object.assign(lib,old);global.fetch=oldFetch;if(oldKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=oldKey;}
});
test('contact email takes precedence over login; invalid contact falls back to active login',async()=>{
  const old=lib.sbJson;
  try {
    lib.sbJson=async url=>url.includes('provider_portal_users')?[{email:'old@example.com'}]:[{primary_email:'NEW@example.com'}];
    assert.deepEqual(await notify.providerEmails('id'),['new@example.com']);
    lib.sbJson=async url=>url.includes('provider_portal_users')?[{email:'old@example.com'}]:[{primary_email:'invalid'}];
    assert.deepEqual(await notify.providerEmails('id'),['old@example.com']);
  }finally{lib.sbJson=old;}
});
test('notification update requires admin and same origin, rejects malformed email without writing',async()=>{
  const old={requireAdmin:lib.requireAdmin,sameOrigin:lib.sameOrigin,sbJson:lib.sbJson};
  try{
    lib.requireAdmin=async()=>{throw Object.assign(new Error('Unauthorized'),{status:401});};
    assert.equal((await endpoint.handler({httpMethod:'POST'})).statusCode,401);
    lib.requireAdmin=async()=>({user:{id:'admin'}});
    lib.sameOrigin=()=>false;
    assert.equal((await endpoint.handler({httpMethod:'POST'})).statusCode,403);
    lib.sameOrigin=()=>true;
    lib.sbJson=async()=>assert.fail('Invalid input must not write');
    assert.equal((await endpoint.handler({httpMethod:'POST',body:JSON.stringify({provider_id:'11111111-1111-1111-1111-111111111111',email:'a@b@c.com'})})).statusCode,400);
  }finally{Object.assign(lib,old);}
});
test('saves verified contact and audit; no login mutation; sending failure is explicit',async()=>{
  const old={requireAdmin:lib.requireAdmin,sameOrigin:lib.sameOrigin,sbJson:lib.sbJson},oldSend=notify.sendProvider;
  const calls=[];
  try{
    lib.requireAdmin=async()=>({user:{id:'admin'}});lib.sameOrigin=()=>true;
    lib.sbJson=async(url,opts)=>{calls.push({url,opts});return opts?.method==='POST'?null:[{id:'id',display_name:'Provider',primary_email:opts?.method==='PATCH'?'new@example.com':'old@example.com'}];};
    notify.sendProvider=async()=>({sent:false,error:'Delivery failed'});
    const r=await endpoint.handler({httpMethod:'POST',body:JSON.stringify({provider_id:'11111111-1111-1111-1111-111111111111',email:'new@example.com'})});
    assert.equal(r.statusCode,200);
    assert.equal(JSON.parse(r.body).notification.sent,false);
    assert.ok(calls.some(c=>c.url.includes('provider_technical_history')));
    assert.ok(calls.every(c=>!c.url.includes('provider_portal_users')));
  }finally{Object.assign(lib,old);notify.sendProvider=oldSend;}
});
