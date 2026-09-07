const lib=require('./_admin-lib');
const accounting=require('./_cal-accounting-lib');
exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  try{
    if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid origin'});
    await lib.requireAdmin(event);
    const body=JSON.parse(event.body||'{}');
    const limit=Math.max(25,Math.min(500,Number(body.limit||200)));
    const scan=await accounting.reconcile(limit);
    const worker=body.process_now===false?null:await accounting.runWorker({limit:Math.min(100,limit)});
    return lib.json(200,{ok:true,recovery:true,scan,worker,note:'Recovery is an exception workflow. Normal accounting is automatic through STEP 17 database events.'});
  }catch(e){console.error('cal-accounting-recovery',e);return lib.json(e.status||500,{error:e.message||'Accounting recovery failed.'});}
};
