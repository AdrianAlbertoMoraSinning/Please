const test=require('node:test');
const assert=require('node:assert/strict');
const lib=require('../netlify/functions/_admin-lib');
const notify=require('../netlify/functions/_notify-lib');
const security=require('../netlify/functions/_security-lib');
const application=require('../netlify/functions/provider-application-notify');

test('admin delivery goes only to Gmail despite legacy configuration and commercial login',async()=>{
  const oldFetch=global.fetch,oldDb=lib.sbJson;
  const keys=['PLEASE_ADMIN_NOTIFY_EMAIL','PLEASE_APPLICATION_NOTIFY_EMAIL','RESEND_API_KEY','PLEASE_EMAIL_FROM'];
  const oldEnv=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try{
    process.env.PLEASE_ADMIN_NOTIFY_EMAIL='info@pleaseservice.ca';
    process.env.PLEASE_APPLICATION_NOTIFY_EMAIL='info@pleaseservice.ca';
    process.env.RESEND_API_KEY='test';process.env.PLEASE_EMAIL_FROM='PLEASE <notifications@pleaseservice.ca>';
    lib.sbJson=async()=>assert.fail('Admin recipients must not depend on login accounts or database availability');
    global.fetch=async(url,opts)=>{
      assert.deepEqual(JSON.parse(opts.body).to,['please.serviceinfo@gmail.com']);
      return {ok:true,text:async()=>JSON.stringify({id:'test-mail'})};
    };
    assert.deepEqual(await notify.adminEmails(),['please.serviceinfo@gmail.com']);
    assert.equal((await notify.sendAdmins({subject:'New service',title:'New service'})).sent,true);
  }finally{global.fetch=oldFetch;lib.sbJson=oldDb;for(const k of keys)if(oldEnv[k]===undefined)delete process.env[k];else process.env[k]=oldEnv[k];}
});

test('professional applications allow Gmail recipients while keeping verified-domain sender and applicant confirmation',async()=>{
  const oldFetch=global.fetch,oldRate=security.checkRateLimit;
  const keys=['PLEASE_SUPABASE_URL','PLEASE_SUPABASE_SECRET_KEY','RESEND_API_KEY','PLEASE_EMAIL_FROM','PLEASE_EMAIL_REPLY_TO','PLEASE_APPLICATION_NOTIFY_EMAIL'];
  const oldEnv=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const emails=[];
  try{
    Object.assign(process.env,{PLEASE_SUPABASE_URL:'https://test.invalid',PLEASE_SUPABASE_SECRET_KEY:'test',RESEND_API_KEY:'test',PLEASE_EMAIL_FROM:'PLEASE <notifications@pleaseservice.ca>',PLEASE_EMAIL_REPLY_TO:'info@pleaseservice.ca',PLEASE_APPLICATION_NOTIFY_EMAIL:'info@pleaseservice.ca'});
    security.checkRateLimit=async()=>({allowed:true});
    global.fetch=async(url,opts)=>{
      if(url.includes('api.resend.com')){emails.push(JSON.parse(opts.body));return {ok:true,text:async()=>'{"id":"test"}'};}
      return {ok:true,json:async()=>url.includes('provider_application_files')?[]:[{reference:'PLS-APP-20261013-ABC123',full_name:'Test applicant',email:'applicant@example.com'}]};
    };
    const response=await application.handler({httpMethod:'POST',headers:{},body:JSON.stringify({application_id:'11111111-1111-4111-8111-111111111111',reference:'PLS-APP-20261013-ABC123',email:'applicant@example.com'})});
    assert.equal(response.statusCode,200);
    assert.deepEqual(emails.map(e=>e.to),[['applicant@example.com'],['please.serviceinfo@gmail.com']]);
    assert.ok(emails.every(e=>e.from.includes('@pleaseservice.ca')));
  }finally{global.fetch=oldFetch;security.checkRateLimit=oldRate;for(const k of keys)if(oldEnv[k]===undefined)delete process.env[k];else process.env[k]=oldEnv[k];}
});
