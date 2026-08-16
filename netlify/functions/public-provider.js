const lib=require('./_admin-lib');
exports.handler=async function(event){
  if(event.httpMethod!=='GET') return lib.json(405,{error:'Method not allowed'});
  try{
    const slug=String(event.queryStringParameters?.slug||'').trim().toLowerCase();
    if(!/^[a-z0-9-]{2,120}$/.test(slug)) return lib.json(400,{error:'Invalid provider'});
    const rows=await lib.sbJson(`/rest/v1/providers?select=id,reference,display_name,company_name,slug,public_title,short_bio,technical_description,service_area,licensed_certified,insured,profile_image_url,logo_url,status,public_visible&slug=eq.${encodeURIComponent(slug)}&status=eq.ACTIVE&public_visible=eq.true&limit=1`);
    const provider=Array.isArray(rows)?rows[0]:null;
    if(!provider) return lib.json(404,{error:'Professional not found'});
    const ps=await lib.sbJson(`/rest/v1/provider_services?select=service_id,services(name,short_description)&provider_id=eq.${provider.id}&active=eq.true`);
    provider.services=(ps||[]).map(x=>x.services).filter(Boolean);
    return lib.json(200,{provider});
  }catch(error){console.error('public-provider',error);return lib.json(500,{error:'Unable to load professional profile.'});}
};
