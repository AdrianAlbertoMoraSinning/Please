const lib=require('./_admin-lib');
exports.handler=async function(event){
 if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
 if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
 try{
  const auth=await lib.requireDeveloper(event),b=JSON.parse(event.body||'{}'),id=String(b.document_id||'').trim(),status=String(b.status||'').trim().toUpperCase();
  if(!/^[0-9a-f-]{36}$/i.test(id))return lib.json(400,{error:'Invalid document id'});
  const result=await lib.sbJson('/rest/v1/rpc/developer_provider_document_action',{method:'POST',body:JSON.stringify({p_actor:auth.user.id,p_document_id:id,p_status:status,p_note:String(b.note||''),p_expires_on:b.expires_on||null})});
  return lib.json(200,{ok:true,result});
 }catch(e){console.error('developer-provider-document-action',e);return lib.json(e.status===401?401:400,{error:e.status===401?'Unauthorized':(e.message||'Document review failed.')});}
};
