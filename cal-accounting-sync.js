// STEP 17 compatibility shim. Manual Sync was removed from the CAL UI.
// Existing bookmarked/internal callers are routed to the recovery scanner so old URLs do not fail.
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
    const worker=await accounting.runWorker({limit:Math.min(100,limit)});
    return lib.json(200,{ok:true,deprecated:true,recovery:true,scan,worker,note:'Manual Sync is deprecated. STEP 17 accounting is event-driven and automatic.'});
  }catch(e){console.error('cal-accounting-sync-compat',e);return lib.json(e.status||500,{error:e.message||'Accounting recovery failed.'});}
};
