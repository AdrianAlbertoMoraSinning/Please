const accounting=require('./_cal-accounting-lib');
exports.handler=async()=>{
  try{
    const limit=Math.max(1,Math.min(100,Number(process.env.CAL_ACCOUNTING_WORKER_LIMIT||10)));
    const summary=await accounting.runWorker({limit});
    return {statusCode:summary.schema_missing?503:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify(summary)};
  }catch(e){
    console.error('cal-accounting-worker',e);
    return {statusCode:500,headers:{'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify({ok:false,error:e.message||'Accounting worker failed.'})};
  }
};
