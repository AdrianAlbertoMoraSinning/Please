const lib=require('./_provider-lib');
const notify=require('./_notify-lib');
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
 try{const a=await lib.requireProvider(event),b=JSON.parse(event.body||'{}'),id=String(b.document_id||'').trim(),action=String(b.action||'').toUpperCase();if(!/^[0-9a-f-]{36}$/i.test(id))return lib.json(400,{error:'Invalid document id'});if(action!=='REMOVE')return lib.json(400,{error:'Invalid action'});
  const docs=await lib.sbJson(`/rest/v1/provider_documents?select=id,provider_id,storage_path,document_name&id=eq.${id}&provider_id=eq.${a.provider.id}&active=eq.true&limit=1`),doc=docs?.[0];if(!doc)return lib.json(404,{error:'Document not found'});
  await lib.sbJson(`/rest/v1/provider_documents?id=eq.${id}&provider_id=eq.${a.provider.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({active:false,updated_at:new Date().toISOString()})});
  await lib.sbFetch('/rest/v1/provider_technical_history',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({provider_id:a.provider.id,event_type:'DOCUMENT_REMOVED',event_label:'Provider document removed',details:{document_id:id,document_name:doc.document_name},actor_type:'PROVIDER',actor_provider_user_id:a.user.id})}).catch(()=>{});
  const n=await notify.sendDevelopers({subject:`PLEASE — Provider Document Removed (${a.provider.reference||a.provider.display_name})`,title:'Provider document removed',intro:`${a.provider.display_name} removed a document from the Provider Portal.`,details:[['Provider',a.provider.display_name],['Document',doc.document_name]],ctaLabel:'Review Provider',ctaUrl:`${notify.baseUrl()}/developer-providers.html`,idempotencyKey:`please-provider-document-remove-${id}`});
  return lib.json(200,{ok:true,review_team_notified:!!n?.sent});
 }catch(e){console.error('provider-document-action',e);return lib.json(e.status===401?401:500,{error:e.status===401?'Unauthorized':(e.message||'Document could not be removed.')});}
};
