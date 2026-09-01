const lib=require('./_admin-lib');
async function optional(label,work,warnings){try{return await work();}catch(e){console.warn(`admin-assignment-form-data:${label}`,e?.message||e);warnings.push(`${label}${e?.status?`:${e.status}`:''}`);return[];}}
async function services(){try{return await lib.sbJson('/rest/v1/services?select=id,name,short_description,active&active=eq.true&order=sort_order.asc,name.asc');}catch{return lib.sbJson('/rest/v1/services?select=id,name,active&active=eq.true&order=name.asc');}}
async function rates(){try{return await lib.sbJson('/rest/v1/provider_service_rates?select=id,provider_id,service_id,rate_name,description,billing_unit,customer_rate,provider_compensation_method,provider_compensation,active,sort_order&active=eq.true&order=provider_id.asc,sort_order.asc,rate_name.asc');}catch{return lib.sbJson('/rest/v1/provider_service_rates?select=id,provider_id,service_id,rate_name,description,billing_unit,customer_rate,provider_compensation_method,provider_compensation,active&active=eq.true&order=provider_id.asc,rate_name.asc');}}
exports.handler=async event=>{
  if(event.httpMethod!=='GET')return lib.json(405,{error:'Method not allowed'});
  const started=Date.now();
  try{
    await lib.requireAdmin(event);
    const warnings=[];
    const [providers,providerServices,serviceRows,rateRows]=await Promise.all([
      optional('providers',()=>lib.sbJson('/rest/v1/providers?select=id,reference,display_name,company_name,public_title,service_area,status,public_visible,slug&status=eq.ACTIVE&order=display_name.asc'),warnings),
      optional('provider-services',()=>lib.sbJson('/rest/v1/provider_services?select=provider_id,service_id,active&active=eq.true'),warnings),
      optional('services',()=>services(),warnings),
      optional('provider-rates',()=>rates(),warnings)
    ]);
    if(!providers.length||!serviceRows.length){return lib.json(503,{error:'Assignment catalog is temporarily unavailable. Please retry in a few seconds.',warnings,duration_ms:Date.now()-started});}
    return lib.json(200,{providers,provider_services:providerServices,services:serviceRows,provider_rates:rateRows,warnings,duration_ms:Date.now()-started});
  }catch(e){const status=e.status||500;return lib.json(status,{error:status===401?'Unauthorized':status===504?'Assignment data timed out while contacting Supabase. Please retry.':(e.message||'Unable to load assignment data.'),duration_ms:Date.now()-started});}
};
