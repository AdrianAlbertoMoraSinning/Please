const lib=require('./_admin-lib');
const APP_FIELDS='id,reference,full_name,company_name,phone,email,service_trade,service_id,other_service_description,years_experience,service_area,licensed_certified,insured,licensed_certified_status,insured_status,experience_details,status,internal_notes,referred_to_developer_at,onboarding_started_at,approved_at,activated_provider_id,submitted_at,updated_at';
exports.handler=async function(event){
  if(event.httpMethod!=='GET') return lib.json(405,{error:'Method not allowed'});
  try{
    await lib.requireDeveloper(event);
    const id=String(event.queryStringParameters?.id||'').trim();
    if(!id){
      const statuses='REFERRED_TO_DEVELOPER,ONBOARDING,APPROVED,ACTIVATED';
      const rows=await lib.sbJson(`/rest/v1/provider_applications?select=${APP_FIELDS}&status=in.(${statuses})&order=referred_to_developer_at.desc.nullslast,submitted_at.desc`);
      return lib.json(200,{applications:rows||[]});
    }
    if(!/^[0-9a-f-]{36}$/i.test(id)) return lib.json(400,{error:'Invalid application id'});
    const apps=await lib.sbJson(`/rest/v1/provider_applications?select=${APP_FIELDS}&id=eq.${id}&limit=1`);
    const application=Array.isArray(apps)?apps[0]:null;
    if(!application) return lib.json(404,{error:'Application not found'});
    const providers=await lib.sbJson(`/rest/v1/providers?select=id,reference,display_name,company_name,slug,primary_email,primary_phone,public_title,short_bio,technical_description,service_area,licensed_certified,insured,status,public_visible,activated_at,created_at,updated_at&source_application_id=eq.${id}&limit=1`);
    const provider=Array.isArray(providers)?providers[0]:null;
    const [services,files,history,providerServices,availability,credential]=await Promise.all([
      lib.sbJson('/rest/v1/services?select=id,name,slug,category_id,active&active=eq.true&order=sort_order.asc'),
      lib.sbJson(`/rest/v1/provider_application_files?select=id,file_type,file_name,storage_path,mime_type,file_size_bytes,created_at&application_id=eq.${id}&order=created_at.asc`),
      lib.sbJson(`/rest/v1/provider_application_status_history?select=id,old_status,new_status,note,created_at&application_id=eq.${id}&order=created_at.desc`),
      provider?lib.sbJson(`/rest/v1/provider_services?select=service_id,active&provider_id=eq.${provider.id}`):Promise.resolve([]),
      provider?lib.sbJson(`/rest/v1/provider_availability?select=id,weekday,start_time,end_time,active&provider_id=eq.${provider.id}&order=weekday.asc,start_time.asc`):Promise.resolve([]),
      provider?lib.sbJson(`/rest/v1/provider_portal_users?select=id,email,display_name,active,password_changed_at&provider_id=eq.${provider.id}&limit=1`):Promise.resolve([])
    ]);
    return lib.json(200,{application,provider,services:services||[],files:files||[],history:history||[],provider_services:providerServices||[],availability:availability||[],credential:Array.isArray(credential)?credential[0]||null:null});
  }catch(error){console.error('developer-applications',error);return lib.json(error.status===401?401:500,{error:error.status===401?'Unauthorized':'Unable to load developer onboarding data.'});}
};
