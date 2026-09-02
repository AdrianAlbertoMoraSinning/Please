const lib=require('./_admin-lib');
const BUCKET='provider-applications';
const clean=(v,n=1000)=>String(v??'').trim().slice(0,n);
const validId=v=>/^[0-9a-f-]{36}$/i.test(String(v||''));
async function removeStorage(path){if(!path)return false;const enc=String(path).split('/').map(encodeURIComponent).join('/');try{const r=await lib.sbFetch(`/storage/v1/object/${BUCKET}/${enc}`,{method:'DELETE'});return r.ok;}catch{return false;}}
async function audit(auth,type,id,reference,snapshot,reason){try{await lib.sbJson('/rest/v1/admin_service_maintenance_audit',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({admin_user_id:auth.user.id,action:'EDIT',record_type:type,record_id:id,reference,reason:reason||'Record edited in Service Maintenance',snapshot})});}catch(e){console.warn('admin-service-maintenance:audit',e?.message||e);}}
exports.handler=async event=>{
 try{
  const auth=await lib.requireAdmin(event);
  if(event.httpMethod==='GET'){
   const q=clean(event.queryStringParameters?.q,200).toLowerCase();
   const [requests,jobs]=await Promise.all([
    lib.sbJson('/rest/v1/service_requests?select=id,reference,status,first_name,last_name,email,phone,service_name,street_address,city,province,postal_code,preferred_date,preferred_start_time,estimated_hours,work_description,internal_notes,job_id,created_at,updated_at&order=created_at.desc&limit=500').catch(()=>[]),
    lib.sbJson('/rest/v1/jobs?select=id,reference,status,service_name,work_address,work_description,estimated_duration_minutes,internal_notes,created_at,updated_at,customers(first_name,last_name,email,phone)&order=created_at.desc&limit=500').catch(()=>[])
   ]);
   const rows=[];
   for(const r of requests||[]){const hay=[r.reference,r.status,r.first_name,r.last_name,r.email,r.phone,r.service_name,r.street_address].join(' ').toLowerCase();if(!q||hay.includes(q))rows.push({type:'SERVICE_REQUEST',...r,customer_name:[r.first_name,r.last_name].filter(Boolean).join(' ')});}
   for(const j of jobs||[]){const c=j.customers||{},hay=[j.reference,j.status,j.service_name,j.work_address,c.first_name,c.last_name,c.email,c.phone].join(' ').toLowerCase();if(!q||hay.includes(q))rows.push({type:'JOB',...j,customer_name:[c.first_name,c.last_name].filter(Boolean).join(' '),email:c.email,phone:c.phone});}
   rows.sort((a,b)=>new Date(b.updated_at||b.created_at)-new Date(a.updated_at||a.created_at));return lib.json(200,{records:rows.slice(0,500)});
  }
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
  const b=JSON.parse(event.body||'{}'),action=clean(b.action,30).toUpperCase(),type=clean(b.record_type,40).toUpperCase(),id=clean(b.record_id,80);if(!['EDIT','DELETE'].includes(action)||!['SERVICE_REQUEST','JOB'].includes(type)||!validId(id))return lib.json(400,{error:'Invalid maintenance request.'});
  if(action==='DELETE'){
   if(b.confirm!==true)return lib.json(400,{error:'Deletion must be explicitly confirmed.'});
   let evidence=[];if(type==='JOB')evidence=await lib.sbJson(`/rest/v1/job_service_evidence?select=storage_path&job_id=eq.${encodeURIComponent(id)}`).catch(()=>[]);
   const d=await lib.sbJson('/rest/v1/rpc/admin_service_maintenance_delete',{method:'POST',body:JSON.stringify({p_actor:auth.user.id,p_record_type:type,p_record_id:id,p_reason:clean(b.reason,1000)||null})});
   let removed=0;for(const e of evidence||[])if(await removeStorage(e.storage_path))removed++;
   return lib.json(200,{ok:true,result:d,evidence_files_removed:removed});
  }
  const patch=b.patch||{},now=new Date().toISOString();
  if(type==='SERVICE_REQUEST'){
   const before=(await lib.sbJson(`/rest/v1/service_requests?select=*&id=eq.${encodeURIComponent(id)}&limit=1`))?.[0];if(!before)return lib.json(404,{error:'Service Request not found.'});
   const out={street_address:clean(patch.street_address,300)||null,city:clean(patch.city,120)||null,province:clean(patch.province,80)||null,postal_code:clean(patch.postal_code,30)||null,work_description:clean(patch.work_description,4000),preferred_date:clean(patch.preferred_date,20)||null,preferred_start_time:clean(patch.preferred_start_time,10)||null,estimated_hours:patch.estimated_hours===''||patch.estimated_hours==null?null:Number(patch.estimated_hours),internal_notes:clean(patch.internal_notes,4000)||null,updated_at:now};
   if(!out.work_description)return lib.json(400,{error:'Work Description is required.'});if(out.preferred_date&&!/^\d{4}-\d{2}-\d{2}$/.test(out.preferred_date))return lib.json(400,{error:'Preferred Date is invalid.'});if(out.preferred_start_time&&!/^\d{2}:(00|15|30|45)$/.test(out.preferred_start_time.slice(0,5)))return lib.json(400,{error:'Time must use 15-minute increments.'});if(out.estimated_hours!=null&&(!Number.isFinite(out.estimated_hours)||out.estimated_hours<0.25||out.estimated_hours>72||Math.abs(out.estimated_hours*4-Math.round(out.estimated_hours*4))>1e-8))return lib.json(400,{error:'Estimated Hours must be 0.25–72 in 15-minute increments.'});
   const rows=await lib.sbJson(`/rest/v1/service_requests?id=eq.${encodeURIComponent(id)}&select=*`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(out)});await audit(auth,type,id,before.reference,before,'Service Request edited in Service Maintenance');return lib.json(200,{ok:true,record:rows?.[0]});
  }
  const before=(await lib.sbJson(`/rest/v1/jobs?select=*&id=eq.${encodeURIComponent(id)}&limit=1`))?.[0];if(!before)return lib.json(404,{error:'Job not found.'});
  const rawMins=Number(patch.estimated_duration_minutes);if(!Number.isFinite(rawMins)||rawMins<15||rawMins>4320||Math.round(rawMins)%15!==0)return lib.json(400,{error:'Estimated Minutes must use 15-minute increments.'});const mins=Math.round(rawMins);const out={work_address:clean(patch.work_address,500),work_description:clean(patch.work_description,5000),estimated_duration_minutes:mins,internal_notes:clean(patch.internal_notes,5000)||null,updated_at:now};if(!out.work_address||!out.work_description)return lib.json(400,{error:'Work Address and Work Description are required.'});const rows=await lib.sbJson(`/rest/v1/jobs?id=eq.${encodeURIComponent(id)}&select=*`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(out)});await audit(auth,type,id,before.reference,before,'Job edited in Service Maintenance');return lib.json(200,{ok:true,record:rows?.[0]});
 }catch(e){console.error('admin-service-maintenance',e);return lib.json(e.status||500,{error:e.status===401?'Unauthorized':(e.message||'Service Maintenance failed.')});}
};
