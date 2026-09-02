const path=require('path');
const root=path.resolve(__dirname,'../netlify/functions');
const PID='11111111-1111-1111-1111-111111111111',AID='22222222-2222-2222-2222-222222222222';
let start=new Date(Date.now()+4*3600000).toISOString(),events=[];
const fakeLib={sbJson:async url=>{
 if(url.startsWith('/rest/v1/job_assignments?select='))return [{id:AID,job_id:'33333333-3333-3333-3333-333333333333',provider_id:PID,status:'CONFIRMED',scheduled_start:start,scheduled_end:new Date(new Date(start).getTime()+2*3600000).toISOString(),jobs:{status:'CONFIRMED',reference:'PLS-JOB-PHOTO',service_name:'Cleaning'}}];
 if(url.startsWith('/rest/v1/providers?select='))return [{id:PID,worker_type:'PLEASE_STAFF'}];
 if(url.startsWith('/rest/v1/job_service_events?select='))return events.map(x=>({event_type:x,created_at:new Date().toISOString()}));
 throw new Error('Unexpected '+url);
}};
const evidence=require(path.join(root,'_provider-evidence-lib.js'));
(async()=>{
 let r=await evidence.readiness(fakeLib,PID,AID,'CHECK_IN');
 if(r.ok||r.code!=='TOO_EARLY'||!r.available_at)process.exit(1);
 start=new Date(Date.now()+30*60000).toISOString();
 r=await evidence.readiness(fakeLib,PID,AID,'CHECK_IN');
 if(!r.ok||r.code!=='READY')process.exit(2);
 events=['CHECKED_IN'];
 r=await evidence.readiness(fakeLib,PID,AID,'ARRIVAL');
 if(!r.ok)process.exit(3);
 events=['CHECKED_IN','ARRIVED'];
 r=await evidence.readiness(fakeLib,PID,AID,'COMPLETION');
 if(r.ok||r.code!=='START_REQUIRED')process.exit(4);
 console.log('STEP 15.9.1 PHOTO READINESS RUNTIME MOCK PASS');
})().catch(e=>{console.error(e);process.exit(10)});
