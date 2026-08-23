const lib=require('./_admin-lib');
async function signed(path,expires=1800){if(!path)return null;try{const enc=String(path).split('/').map(encodeURIComponent).join('/');const d=await lib.sbJson(`/storage/v1/object/sign/provider-applications/${enc}`,{method:'POST',body:JSON.stringify({expiresIn:expires})});const u=d?.signedURL||d?.signedUrl;return u?`${process.env.PLEASE_SUPABASE_URL.replace(/\/$/,'')}/storage/v1${u}`:null;}catch{return null;}}
function safePublicUrl(v){try{const u=new URL(String(v||''));return ['http:','https:'].includes(u.protocol)?u.href:null}catch{return null;}}

async function optional(label, fn, fallback){
  try{return await fn();}
  catch(e){console.error(`admin-providers:${label}`,e);return fallback;}
}

async function listProviders(){
  const base='id,reference,display_name,company_name,slug,primary_email,primary_phone,public_title,service_area,profile_image_url,profile_image_path,status,public_visible,activated_at,created_at,updated_at,source_application_id';
  try{
    return await lib.sbJson(`/rest/v1/providers?select=${base},worker_type&order=created_at.desc`);
  }catch(e){
    // STEP 14 adds worker_type. Keep Provider Accounts usable even if the migration
    // has not reached the production schema yet, instead of returning an empty UI.
    if(/worker_type|column .* does not exist|schema cache/i.test(String(e.message||''))){
      console.warn('admin-providers: worker_type unavailable; using compatibility mode');
      const rows=await lib.sbJson(`/rest/v1/providers?select=${base}&order=created_at.desc`);
      return (rows||[]).map(r=>({...r,worker_type:'INDEPENDENT_PROVIDER'}));
    }
    throw e;
  }
}

async function getProvider(id){
  const base='id,reference,display_name,company_name,slug,primary_email,primary_phone,public_title,short_bio,technical_description,service_area,licensed_certified,insured,profile_image_url,profile_image_path,logo_url,status,public_visible,activated_at,created_at,updated_at,source_application_id';
  try{
    const rows=await lib.sbJson(`/rest/v1/providers?select=${base},worker_type&id=eq.${id}&limit=1`);
    return rows?.[0]||null;
  }catch(e){
    if(/worker_type|column .* does not exist|schema cache/i.test(String(e.message||''))){
      console.warn('admin-providers: detail worker_type unavailable; using compatibility mode');
      const rows=await lib.sbJson(`/rest/v1/providers?select=${base}&id=eq.${id}&limit=1`);
      return rows?.[0]?{...rows[0],worker_type:'INDEPENDENT_PROVIDER'}:null;
    }
    throw e;
  }
}

exports.handler=async function(event){
  if(event.httpMethod!=='GET') return lib.json(405,{error:'Method not allowed'});
  try{
    await lib.requireAdmin(event);
    const id=String(event.queryStringParameters?.id||'').trim();
    if(!id){
      const rows=await listProviders();
      const providerIds=(rows||[]).map(x=>x.id);
      let users=[];
      if(providerIds.length){
        const list=providerIds.map(encodeURIComponent).join(',');
        users=await optional('portal-users',()=>lib.sbJson(`/rest/v1/provider_portal_users?select=id,provider_id,email,display_name,active,last_login_at,password_changed_at,created_at,updated_at&provider_id=in.(${list})`),[]);
      }
      const byProvider=new Map((users||[]).map(x=>[x.provider_id,x]));
      const enriched=[];for(const p of rows||[]){enriched.push({...p,profile_photo_url:p.profile_image_path?await signed(p.profile_image_path):safePublicUrl(p.profile_image_url),account:byProvider.get(p.id)||null});}return lib.json(200,{providers:enriched});
    }
    if(!/^[0-9a-f-]{36}$/i.test(id)) return lib.json(400,{error:'Invalid provider id'});
    const provider=await getProvider(id);
    if(!provider) return lib.json(404,{error:'Provider not found'});

    // These datasets are supporting panels. One stale optional table/column should
    // not prevent the Provider Account drawer itself from opening.
    const [account,services,availability,exceptions,documents,history,allServices]=await Promise.all([
      optional('account',()=>lib.sbJson(`/rest/v1/provider_portal_users?select=id,email,display_name,active,last_login_at,password_changed_at,created_at,updated_at&provider_id=eq.${id}&limit=1`).then(x=>x?.[0]||null),null),
      optional('services',()=>lib.sbJson(`/rest/v1/provider_services?select=service_id,active,developer_authorized,provider_enabled,provider_notes,services(id,name,short_description)&provider_id=eq.${id}`),[]),
      optional('availability',()=>lib.sbJson(`/rest/v1/provider_availability?select=id,weekday,start_time,end_time,active&provider_id=eq.${id}&order=weekday.asc,start_time.asc`),[]),
      optional('exceptions',()=>lib.sbJson(`/rest/v1/provider_availability_exceptions?select=id,exception_date,start_time,end_time,exception_type,reason,created_at&provider_id=eq.${id}&order=exception_date.asc,start_time.asc`),[]),
      optional('documents',()=>lib.sbJson(`/rest/v1/provider_documents?select=id,document_type,document_name,storage_path,mime_type,file_size_bytes,verification_status,expires_on,active,review_note,created_at,updated_at&provider_id=eq.${id}&active=eq.true&order=created_at.desc`),[]),
      optional('history',()=>lib.sbJson(`/rest/v1/provider_technical_history?select=id,event_type,event_label,details,actor_type,created_at&provider_id=eq.${id}&order=created_at.desc&limit=100`),[]),
      optional('all-services',()=>lib.sbJson('/rest/v1/services?select=id,name,short_description,active&active=eq.true&order=sort_order.asc'),[])
    ]);
    provider.profile_photo_url=provider.profile_image_path?await signed(provider.profile_image_path):safePublicUrl(provider.profile_image_url);return lib.json(200,{provider,account,services,availability,exceptions,documents,history,all_services:allServices});
  }catch(e){
    console.error('admin-providers',e);
    return lib.json(e.status===401?401:500,{error:e.status===401?'Unauthorized':'Unable to load provider accounts.'});
  }
};
