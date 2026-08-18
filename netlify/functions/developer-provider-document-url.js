const lib=require('./_admin-lib');
exports.handler=async function(event){
 if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
 if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
 try{
  await lib.requireDeveloper(event); const b=JSON.parse(event.body||'{}'),id=String(b.document_id||'').trim();
  if(!/^[0-9a-f-]{36}$/i.test(id))return lib.json(400,{error:'Invalid document id'});
  const rows=await lib.sbJson(`/rest/v1/provider_documents?select=id,storage_path&id=eq.${id}&active=eq.true&limit=1`),file=rows?.[0];
  if(!file)return lib.json(404,{error:'Document not found'});
  const path=file.storage_path.split('/').map(encodeURIComponent).join('/');
  const signed=await lib.sbJson(`/storage/v1/object/sign/provider-applications/${path}`,{method:'POST',body:JSON.stringify({expiresIn:300})});
  const signedURL=signed?.signedURL||signed?.signedUrl;if(!signedURL)throw new Error('Unable to create signed URL');
  const base=process.env.PLEASE_SUPABASE_URL.replace(/\/$/,'');
  return lib.json(200,{url:signedURL.startsWith('http')?signedURL:`${base}/storage/v1${signedURL}`});
 }catch(e){console.error('developer-provider-document-url',e);return lib.json(e.status===401?401:500,{error:e.status===401?'Unauthorized':'Could not open document.'});}
};
