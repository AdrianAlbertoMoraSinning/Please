const crypto=require('crypto');
const lib=require('./_admin-lib');
const security=require('./_security-lib');
const hash=v=>crypto.createHash('sha256').update(String(v||'')).digest('hex');

exports.handler=async event=>{
  if(event.httpMethod!=='POST') return lib.json(405,{error:'Method not allowed'});
  try{
    const auth=await lib.requireAdmin(event);
    if(!lib.sameOrigin(event)) return lib.json(403,{error:'Invalid request origin'});
    const p=JSON.parse(event.body||'{}');
    const id=String(p.request_id||'').trim();
    if(!/^[0-9a-f-]{36}$/i.test(id)) return lib.json(400,{error:'Invalid service request.'});
    const rows=await lib.sbJson(`/rest/v1/service_requests?select=id,reference&id=eq.${encodeURIComponent(id)}&limit=1`);
    const req=rows?.[0];
    if(!req) return lib.json(404,{error:'Service request not found.'});
    const token=crypto.randomBytes(24).toString('hex');
    await security.issueTrackingToken({serviceRequestId:req.id,tokenHash:hash(token),source:'ADMIN_GENERATED'});
    return lib.json(200,{reference:req.reference,tracking_token:token,generated_by:auth.user.email});
  }catch(e){
    console.error('admin-request-tracking-link',e);
    return lib.json(e.status||500,{error:e.status===401?'Unauthorized':(e.message||'Unable to create tracking link.')});
  }
};
