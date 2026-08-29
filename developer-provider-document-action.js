const lib=require('./_admin-lib');
const notify=require('./_notify-lib');
exports.handler=async function(event){
 if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
 if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
 try{
  const auth=await lib.requireDeveloper(event),b=JSON.parse(event.body||'{}'),id=String(b.document_id||'').trim(),status=String(b.status||'').trim().toUpperCase();
  if(!/^[0-9a-f-]{36}$/i.test(id))return lib.json(400,{error:'Invalid document id'});
  const before=(await lib.sbJson(`/rest/v1/provider_documents?select=id,provider_id,document_name,document_type&id=eq.${encodeURIComponent(id)}&limit=1`).catch(()=>[]))?.[0];
  const result=await lib.sbJson('/rest/v1/rpc/developer_provider_document_action',{method:'POST',body:JSON.stringify({p_actor:auth.user.id,p_document_id:id,p_status:status,p_note:String(b.note||''),p_expires_on:b.expires_on||null})});
  const pr=before?.provider_id?await notify.providerContext(before.provider_id).catch(()=>null):null;
  const n=before?.provider_id?await notify.sendProvider(before.provider_id,{subject:`PLEASE — Document Review ${status}`,title:'PLEASE document review updated',intro:`Hello ${pr?.display_name||'Provider'}, the review status of one of your documents was updated.`,details:[['Document',before.document_name],['Type',before.document_type],['Status',status],['Expires',b.expires_on||'—']],message:String(b.note||''),ctaLabel:'Provider Portal',ctaUrl:`${notify.baseUrl()}/provider.html`,idempotencyKey:`please-document-review-${id}-${status}-${Date.now()}`}):{sent:false};
  return lib.json(200,{ok:true,result,provider_notified:!!n?.sent});
 }catch(e){console.error('developer-provider-document-action',e);return lib.json(e.status===401?401:400,{error:e.status===401?'Unauthorized':(e.message||'Document review failed.')});}
};
