const lib=require('./_admin-lib');
const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
function validId(v){return /^[0-9a-f-]{36}$/i.test(String(v||''));}
exports.handler=async event=>{
 try{
  await lib.requireAdmin(event);
  if(event.httpMethod==='GET'){
   const id=clean(event.queryStringParameters?.id,80);
   if(!id){
    let rows=[];try{rows=await lib.sbJson('/rest/v1/customers?select=id,first_name,last_name,email,phone,address_line1,city,province,postal_code,service_request_count,first_service_request_at,last_service_request_at,created_at,updated_at&order=last_service_request_at.desc.nullslast,updated_at.desc&limit=1000');}
    catch(e){rows=await lib.sbJson('/rest/v1/customers?select=id,first_name,last_name,email,phone,address_line1,city,province,postal_code,created_at,updated_at&order=updated_at.desc&limit=1000');rows=(rows||[]).map(x=>({...x,service_request_count:0}));}
    return lib.json(200,{customers:rows||[]});
   }
   if(!validId(id))return lib.json(400,{error:'Invalid customer id.'});
   const customers=await lib.sbJson(`/rest/v1/customers?select=*&id=eq.${encodeURIComponent(id)}&limit=1`),customer=customers?.[0];if(!customer)return lib.json(404,{error:'Customer not found.'});
   const [requests,jobs]=await Promise.all([
    lib.sbJson(`/rest/v1/service_requests?select=id,reference,status,service_name,preferred_date,preferred_start_time,created_at,job_id&customer_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=200`).catch(()=>[]),
    lib.sbJson(`/rest/v1/jobs?select=id,reference,status,service_name,work_address,created_at,completed_at&customer_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=200`).catch(()=>[])
   ]);
   return lib.json(200,{customer,requests:requests||[],jobs:jobs||[]});
  }
  if(event.httpMethod==='POST'){
   if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
   const b=JSON.parse(event.body||'{}'),id=clean(b.customer_id,80);if(!validId(id))return lib.json(400,{error:'Invalid customer id.'});
   const first=clean(b.first_name,100),email=clean(b.email,200).toLowerCase(),phone=clean(b.phone,80);if(!first)return lib.json(400,{error:'First name is required.'});
   const patch={first_name:first,last_name:clean(b.last_name,100)||null,email:email||null,phone:phone||null,address_line1:clean(b.address_line1,300)||null,city:clean(b.city,120)||null,province:clean(b.province,80)||null,postal_code:clean(b.postal_code,30)||null,normalized_email:email||null,normalized_phone:phone?phone.replace(/[^0-9]+/g,'')||null:null,updated_at:new Date().toISOString()};
   const rows=await lib.sbJson(`/rest/v1/customers?id=eq.${encodeURIComponent(id)}&select=*`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});if(!rows?.[0])return lib.json(404,{error:'Customer not found.'});
   return lib.json(200,{ok:true,customer:rows[0]});
  }
  return lib.json(405,{error:'Method not allowed'});
 }catch(e){console.error('admin-customers',e);return lib.json(e.status||500,{error:e.status===401?'Unauthorized':(e.message||'Unable to load customers.')});}
};
