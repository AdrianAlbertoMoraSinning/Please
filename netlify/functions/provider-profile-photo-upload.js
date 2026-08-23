const lib=require('./_provider-lib');
const {randomUUID}=require('crypto');
const BUCKET='provider-applications',MAX=4*1024*1024,ALLOWED={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
function magic(b,t){if(t==='image/jpeg')return b.length>3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff;if(t==='image/png')return b.length>=8&&b.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));if(t==='image/webp')return b.length>=12&&b.subarray(0,4).toString('ascii')==='RIFF'&&b.subarray(8,12).toString('ascii')==='WEBP';return false;}
function cleanName(event){let n=String(event.headers['x-file-name']||event.headers['X-File-Name']||'profile-photo').trim();try{n=decodeURIComponent(n);}catch{}return n.replace(/[\r\n]/g,' ').slice(0,180)||'profile-photo';}
async function removeObject(path){if(!path)return;try{await lib.sbJson(`/storage/v1/object/${BUCKET}`,{method:'DELETE',body:JSON.stringify({prefixes:[path]})});}catch(e){console.warn('provider-profile-photo-upload:cleanup',e.message||e);}}
exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
  let newPath=null;
  try{
    const a=await lib.requireProvider(event);
    const ct=String(event.headers['content-type']||'').split(';')[0].toLowerCase();
    if(!ALLOWED[ct])return lib.json(415,{error:'Use JPG, PNG or WEBP.'});
    const b=Buffer.from(event.body||'',event.isBase64Encoded?'base64':'binary');
    if(!b.length||b.length>MAX||!magic(b,ct))return lib.json(415,{error:'Invalid or oversized photo.'});
    const originalName=cleanName(event);
    const before=await lib.sbJson(`/rest/v1/providers?select=id,profile_image_path&id=eq.${encodeURIComponent(a.provider.id)}&limit=1`);
    if(!before?.[0])return lib.json(404,{error:'Provider record not found.'});
    const oldPath=before[0].profile_image_path||null;
    newPath=`providers/${a.provider.id}/profile/${randomUUID()}.${ALLOWED[ct]}`;
    const enc=newPath.split('/').map(encodeURIComponent).join('/');
    const up=await lib.sbFetch(`/storage/v1/object/${BUCKET}/${enc}`,{method:'POST',headers:{'content-type':ct,'x-upsert':'false'},body:b});
    if(!up.ok)throw new Error(await up.text()||'Could not store profile photo.');
    const patch={profile_image_path:newPath,profile_image_name:originalName,updated_at:new Date().toISOString()};
    let saved;
    try{
      saved=await lib.sbJson(`/rest/v1/providers?id=eq.${encodeURIComponent(a.provider.id)}&select=id,profile_image_path,profile_image_name,updated_at`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});
    }catch(e){
      if(!/profile_image_name/i.test(String(e.message||'')))throw e;
      delete patch.profile_image_name;
      saved=await lib.sbJson(`/rest/v1/providers?id=eq.${encodeURIComponent(a.provider.id)}&select=id,profile_image_path,updated_at`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});
    }
    const row=Array.isArray(saved)?saved[0]:null;
    if(!row||row.profile_image_path!==newPath)throw new Error('Profile photo was stored, but the Provider record was not updated.');
    if(oldPath&&oldPath!==newPath)removeObject(oldPath).catch(()=>{});
    return lib.json(200,{ok:true,file_name:originalName,profile_image_path:newPath,updated_at:row.updated_at||patch.updated_at});
  }catch(e){
    if(newPath)await removeObject(newPath);
    console.error('provider-profile-photo-upload',e);
    return lib.json(e.status||500,{error:e.message||'Profile photo upload failed.'});
  }
};
