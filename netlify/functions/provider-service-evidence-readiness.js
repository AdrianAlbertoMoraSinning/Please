const lib=require('./_provider-lib');
const evidence=require('./_provider-evidence-lib');
exports.handler=async event=>{
  if(event.httpMethod!=='GET')return lib.json(405,{error:'Method not allowed'});
  try{const auth=await lib.requireProvider(event),q=event.queryStringParameters||{},result=await evidence.readiness(lib,auth.provider.id,String(q.assignment_id||''),String(q.evidence_type||''));return lib.json(result.ok?200:409,result);}catch(e){console.error('provider-service-evidence-readiness',e);return lib.json(e.status||500,{ok:false,code:e.code||'READINESS_ERROR',error:e.message||'Unable to verify photo readiness.'});}
};
