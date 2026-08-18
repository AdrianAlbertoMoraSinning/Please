const crypto=require('crypto');

function config(){
  const url=process.env.PLEASE_SUPABASE_URL;
  const secret=process.env.PLEASE_SUPABASE_SECRET_KEY;
  if(!url||!secret) throw new Error('Security backend is not configured.');
  return {url:url.replace(/\/$/,''),secret};
}
function requestIp(event){return String(event?.headers?.['x-nf-client-connection-ip']||event?.headers?.['x-forwarded-for']||'').split(',')[0].trim().slice(0,120);}
function sameOrigin(event){const origin=event?.headers?.origin||event?.headers?.Origin;if(!origin)return true;const host=event?.headers?.host||event?.headers?.Host;if(!host)return false;try{return new URL(origin).host===host}catch{return false}}
function sha(value){return crypto.createHash('sha256').update(String(value||'')).digest('hex');}
async function rpc(name,payload){
  const {url,secret}=config();
  const r=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:secret,'content-type':'application/json'},body:JSON.stringify(payload)});
  const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!r.ok){const e=new Error(data?.message||data?.error||`Security request failed (${r.status})`);e.status=r.status;throw e;}
  return data;
}
async function checkRateLimit(event,{endpoint,limit,windowSeconds,identity=''}){
  const ep=String(endpoint||'unknown').slice(0,120);
  const ip=requestIp(event)||'unknown';
  const window=Number(windowSeconds)||900,baseLimit=Number(limit)||20;
  // Always enforce a connection-wide ceiling. If an identity is supplied, also
  // enforce the tighter identity+IP bucket so cycling identities cannot bypass abuse controls.
  const globalRows=await rpc('please_rate_limit_check',{p_bucket_hash:sha(`${ep}|${ip}|*`),p_endpoint:`${ep}:ip`,p_window_seconds:window,p_limit:Math.max(baseLimit*3,30)});
  const globalRow=Array.isArray(globalRows)?globalRows[0]:globalRows;
  if(globalRow?.allowed===false)return {allowed:false,count:Number(globalRow?.current_count||0),retryAfter:Number(globalRow?.retry_after_seconds||window)};
  if(!String(identity||'').trim())return {allowed:true,count:Number(globalRow?.current_count||0),retryAfter:0};
  const bucket=sha(`${ep}|${ip}|${String(identity||'').trim().toLowerCase().slice(0,200)}`);
  const rows=await rpc('please_rate_limit_check',{p_bucket_hash:bucket,p_endpoint:`${ep}:identity`,p_window_seconds:window,p_limit:baseLimit});
  const row=Array.isArray(rows)?rows[0]:rows;
  return {allowed:row?.allowed!==false,count:Number(row?.current_count||0),retryAfter:Number(row?.retry_after_seconds||window)};
}
async function issueTrackingToken({serviceRequestId,tokenHash,source}){
  return rpc('please_issue_tracking_token',{p_service_request_id:serviceRequestId,p_token_hash:tokenHash,p_source:source});
}
module.exports={requestIp,sameOrigin,sha,checkRateLimit,issueTrackingToken};
