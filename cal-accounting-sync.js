const lib=require('./_admin-lib');
const accounting=require('./_cal-accounting-lib');
exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  try{
    if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid origin'});
    await lib.requireAdmin(event);
    const body=JSON.parse(event.body||'{}');
    const summary=await accounting.reconcile(Math.max(25,Math.min(500,Number(body.limit||200))));
    return lib.json(200,{ok:true,summary});
  }catch(e){console.error('cal-accounting-sync',e);return lib.json(e.status||500,{error:e.message||'Accounting sync failed.'});}
};
