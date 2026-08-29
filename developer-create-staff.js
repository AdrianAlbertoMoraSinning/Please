const lib=require('./_admin-lib');
const notify=require('./_notify-lib');
exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin'});
  try{
    const a=await lib.requireDeveloper(event),b=JSON.parse(event.body||'{}'),email=String(b.email||'').trim().toLowerCase(),display=String(b.display_name||'').trim();
    const d=await lib.sbJson('/rest/v1/rpc/developer_create_please_staff',{method:'POST',body:JSON.stringify({p_actor:a.user.id,p_display_name:display,p_email:email,p_phone:String(b.phone||''),p_password:String(b.password||'')})});
    const notices=[];
    notices.push(await notify.send({to:email,subject:'PLEASE — Administration Account Created',title:'Your PLEASE Administration account is ready',intro:`Hello ${display||'PLEASE team member'}, an Administration account has been created for you.`,message:'For security, passwords are never included in email. Use the credentials provided through the approved secure channel and change your password after signing in.',ctaLabel:'Administration Login',ctaUrl:`${notify.baseUrl()}/admin-login.html`,idempotencyKey:`please-staff-created-${email}`}));
    notices.push(await notify.sendAdmins({subject:`PLEASE — Staff Account Created (${display||email})`,title:'PLEASE staff account created',intro:`A Developer created a new PLEASE Administration account.`,details:[['Name',display],['Email',email]],message:'No password is included in this notification.',ctaLabel:'Administration',ctaUrl:`${notify.baseUrl()}/admin.html`,idempotencyKey:`please-admin-staff-created-${email}`}));
    return lib.json(200,{...(d||{ok:true}),notifications_sent:notices.filter(x=>x?.sent).length});
  }catch(e){console.error('developer-create-staff',e);return lib.json(e.status||400,{error:e.message||'Staff account could not be created.'});}
};
