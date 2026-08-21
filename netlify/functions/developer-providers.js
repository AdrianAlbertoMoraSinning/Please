const lib=require('./_admin-lib');
exports.handler=async function(event){
  if(event.httpMethod!=='GET') return lib.json(405,{error:'Method not allowed'});
  try{
    await lib.requireDeveloper(event);
    const id=String(event.queryStringParameters?.id||'').trim();
    if(!id){
      const rows=await lib.sbJson('/rest/v1/providers?select=id,reference,display_name,company_name,slug,primary_email,primary_phone,public_title,service_area,status,public_visible,activated_at,created_at,updated_at,source_application_id,worker_type&order=created_at.desc');
      const providerIds=(rows||[]).map(x=>x.id);
      let users=[];
      if(providerIds.length){
        const list=providerIds.map(encodeURIComponent).join(',');
        users=await lib.sbJson(`/rest/v1/provider_portal_users?select=id,provider_id,email,display_name,active,last_login_at,password_changed_at,created_at,updated_at&provider_id=in.(${list})`);
      }
      const byProvider=new Map((users||[]).map(x=>[x.provider_id,x]));
      return lib.json(200,{providers:(rows||[]).map(p=>({...p,account:byProvider.get(p.id)||null}))});
    }
    if(!/^[0-9a-f-]{36}$/i.test(id)) return lib.json(400,{error:'Invalid provider id'});
    const providers=await lib.sbJson(`/rest/v1/providers?select=id,reference,display_name,company_name,slug,primary_email,primary_phone,public_title,short_bio,technical_description,service_area,licensed_certified,insured,profile_image_url,logo_url,status,public_visible,activated_at,created_at,updated_at,source_application_id,worker_type&id=eq.${id}&limit=1`);
    const provider=providers?.[0]; if(!provider) return lib.json(404,{error:'Provider not found'});
    const [account,services,availability,exceptions,documents,history,allServices]=await Promise.all([
      lib.sbJson(`/rest/v1/provider_portal_users?select=id,email,display_name,active,last_login_at,password_changed_at,created_at,updated_at&provider_id=eq.${id}&limit=1`).then(x=>x?.[0]||null),
      lib.sbJson(`/rest/v1/provider_services?select=service_id,active,developer_authorized,provider_enabled,provider_notes,services(id,name,short_description)&provider_id=eq.${id}`),
      lib.sbJson(`/rest/v1/provider_availability?select=id,weekday,start_time,end_time,active&provider_id=eq.${id}&order=weekday.asc,start_time.asc`),
      lib.sbJson(`/rest/v1/provider_availability_exceptions?select=id,exception_date,start_time,end_time,exception_type,reason,created_at&provider_id=eq.${id}&order=exception_date.asc,start_time.asc`),
      lib.sbJson(`/rest/v1/provider_documents?select=id,document_type,document_name,storage_path,mime_type,file_size_bytes,verification_status,expires_on,active,review_note,created_at,updated_at&provider_id=eq.${id}&active=eq.true&order=created_at.desc`),
      lib.sbJson(`/rest/v1/provider_technical_history?select=id,event_type,event_label,details,actor_type,created_at&provider_id=eq.${id}&order=created_at.desc&limit=100`),
      lib.sbJson('/rest/v1/services?select=id,name,short_description,active&active=eq.true&order=sort_order.asc')
    ]);
    return lib.json(200,{provider,account,services:services||[],availability:availability||[],exceptions:exceptions||[],documents:documents||[],history:history||[],all_services:allServices||[]});
  }catch(e){console.error('developer-providers',e);return lib.json(e.status===401?401:500,{error:e.status===401?'Unauthorized':'Unable to load provider accounts.'});}
};
