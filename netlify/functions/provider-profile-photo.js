const providerLib=require('./_provider-lib');
const adminLib=require('./_admin-lib');
const crypto=require('crypto');
const BUCKET='provider-applications';
function json(statusCode,payload){return{statusCode,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'},body:JSON.stringify(payload)}}
function hash(v){return crypto.createHash('sha256').update(String(v||'')).digest('hex')}
function mimeFromPath(path){const p=String(path||'').toLowerCase();if(p.endsWith('.png'))return'image/png';if(p.endsWith('.webp'))return'image/webp';return'image/jpeg'}
async function trackingRequest(token){if(!/^[a-f0-9]{48}$/i.test(token||''))return null;const h=hash(token);try{const links=await adminLib.sbJson(`/rest/v1/service_request_tracking_tokens?select=service_request_id&token_hash=eq.${encodeURIComponent(h)}&revoked_at=is.null&or=(expires_at.is.null,expires_at.gt.${encodeURIComponent(new Date().toISOString())})&limit=1`);if(links?.[0]?.service_request_id){const r=await adminLib.sbJson(`/rest/v1/service_requests?select=id,job_id&id=eq.${encodeURIComponent(links[0].service_request_id)}&limit=1`);if(r?.[0])return r[0];}}catch(_){}const r=await adminLib.sbJson(`/rest/v1/service_requests?select=id,job_id&tracking_token_hash=eq.${encodeURIComponent(h)}&limit=1`);return r?.[0]||null}
async function allowedProviderForTracking(providerId,token){const req=await trackingRequest(token);if(!req?.job_id)return false;const rows=await adminLib.sbJson(`/rest/v1/job_assignments?select=id&job_id=eq.${encodeURIComponent(req.job_id)}&provider_id=eq.${encodeURIComponent(providerId)}&limit=1`);return !!rows?.[0]}
async function providerPath(providerId){const rows=await adminLib.sbJson(`/rest/v1/providers?select=id,profile_image_path&id=eq.${encodeURIComponent(providerId)}&limit=1`);return rows?.[0]?.profile_image_path||null}
async function fetchObject(path){
  const base=String(process.env.PLEASE_SUPABASE_URL||'').replace(/\/$/,'');
  if(!base)throw new Error('Storage backend is not configured.');
  const enc=String(path).split('/').map(encodeURIComponent).join('/');
  // IMPORTANT: new Supabase sb_secret_* keys are API keys, not JWTs.  Do not
  // send them as Bearer tokens to /object/authenticated.  Instead generate a
  // short-lived signed URL server-side and download through that URL.
  const signed=await adminLib.sbJson(`/storage/v1/object/sign/${BUCKET}/${enc}`,{
    method:'POST',body:JSON.stringify({expiresIn:60})
  });
  const rel=signed?.signedURL||signed?.signedUrl;
  if(!rel)throw new Error('Unable to create profile photo access URL.');
  const url=rel.startsWith('http')?rel:`${base}/storage/v1${rel}`;
  const r=await fetch(url,{headers:{'accept':'image/*'}});
  if(!r.ok)throw new Error(`Unable to load profile photo (${r.status})`);
  return {body:Buffer.from(await r.arrayBuffer()),contentType:r.headers.get('content-type')||mimeFromPath(path)};
}
exports.handler=async event=>{if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed'});try{let providerId=String(event.queryStringParameters?.provider_id||'').trim();const trackingToken=String(event.queryStringParameters?.tracking_token||'').trim();let authorized=false;if(trackingToken&&providerId){authorized=await allowedProviderForTracking(providerId,trackingToken);}else if(providerId){await adminLib.requireAdmin(event);authorized=true;}else{const p=await providerLib.requireProvider(event);providerId=p.provider.id;authorized=true;}if(!authorized||!providerId)return json(403,{error:'Not authorized'});const path=await providerPath(providerId);if(!path)return json(404,{error:'Profile photo not found'});const out=await fetchObject(path);return{statusCode:200,isBase64Encoded:true,headers:{'content-type':out.contentType,'cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff','content-disposition':'inline'},body:out.body.toString('base64')};}catch(e){console.error('provider-profile-photo',e);return json(e.status||500,{error:e.message||'Unable to load profile photo'})}};
