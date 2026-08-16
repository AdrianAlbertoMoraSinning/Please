const crypto=require('crypto');
const lib=require('./_admin-lib');

const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
const emailOk=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const FLEX=new Set(['EXACT','SAME_DAY','FLEXIBLE','ANYTIME']);
function ref(){return `PLS-REQ-${new Intl.DateTimeFormat('en-CA',{timeZone:'America/Edmonton',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;}
function hash(v){return crypto.createHash('sha256').update(v).digest('hex');}

exports.handler=async event=>{
  try{
    if(event.httpMethod==='GET'){
      const services=await lib.sbJson('/rest/v1/services?select=id,name,short_description&active=eq.true&order=sort_order.asc,name.asc');
      return lib.json(200,{services:services||[]});
    }
    if(event.httpMethod!=='POST') return lib.json(405,{error:'Method not allowed'});
    if(!lib.sameOrigin(event)) return lib.json(403,{error:'Invalid request origin'});
    const p=JSON.parse(event.body||'{}');
    const first=clean(p.first_name,100), last=clean(p.last_name,100), email=clean(p.email,200).toLowerCase(), phone=clean(p.phone,80);
    const serviceId=clean(p.service_id,60), address=clean(p.street_address,300), city=clean(p.city||'Calgary',120), province=clean(p.province||'AB',80), postal=clean(p.postal_code,30);
    const desc=clean(p.work_description,4000), notes=clean(p.customer_notes,2000), flexibility=clean(p.scheduling_flexibility||'FLEXIBLE',30).toUpperCase();
    if(!first||!email||!phone||!serviceId||!address||!desc) return lib.json(400,{error:'Please complete all required fields.'});
    if(!emailOk(email)) return lib.json(400,{error:'Please enter a valid email address.'});
    if(!FLEX.has(flexibility)) return lib.json(400,{error:'Invalid scheduling flexibility.'});
    const services=await lib.sbJson(`/rest/v1/services?select=id,name&id=eq.${encodeURIComponent(serviceId)}&active=eq.true&limit=1`);
    const service=services?.[0]; if(!service) return lib.json(400,{error:'Selected service is not available.'});
    const token=crypto.randomBytes(24).toString('hex');
    const reference=ref();
    const row={reference,tracking_token_hash:hash(token),first_name:first,last_name:last||null,email,phone,service_id:service.id,service_name:service.name,street_address:address,city,province,postal_code:postal||null,work_description:desc,preferred_date:p.preferred_date||null,preferred_start_time:p.preferred_start_time||null,scheduling_flexibility:flexibility,customer_notes:notes||null,status:'NEW'};
    const created=await lib.sbJson('/rest/v1/service_requests?select=id,reference,status,created_at',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(row)});
    const item=created?.[0];
    await lib.sbJson('/rest/v1/service_request_status_history',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({service_request_id:item.id,old_status:null,new_status:'NEW',note:'Customer service request submitted'})});
    return lib.json(201,{reference:item.reference,status:item.status,tracking_token:token,message:'Your request has been received by PLEASE.'});
  }catch(e){console.error('public-service-request',e);return lib.json(e.status||500,{error:e.message||'Unable to submit request.'});}
};
