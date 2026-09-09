const lib=require('./_admin-lib');
const accounting=require('./_cal-accounting-lib');
const clean=(v,n=1000)=>String(v??'').trim().slice(0,n);
const enc=v=>encodeURIComponent(String(v??''));
function bodyOf(event){try{return JSON.parse(event.body||'{}')}catch{const e=new Error('Invalid JSON body.');e.status=400;throw e}}
function scalar(v){if(Array.isArray(v))v=v[0];if(v&&typeof v==='object'){const k=Object.keys(v);if(k.length===1)return v[k[0]];}return v}
async function rpc(name,body){return lib.sbJson(`/rest/v1/rpc/${name}`,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(body||{})})}
async function safe(path,fallback=[]){try{return await lib.sbJson(path)}catch(e){if(/does not exist|schema cache|42P01|42703/i.test(String(e.message||e)))return fallback;throw e}}
async function getData(){
  const [healthRaw,engineRaw,exceptionsRaw,contracts,recent,domainEvents]=await Promise.all([
    rpc('accounting_integration_health',{}).catch(()=>({status:'UNKNOWN'})),
    rpc('accounting_engine_health',{}).catch(()=>({status:'UNKNOWN'})),
    rpc('accounting_integration_exceptions',{p_limit:250}).catch(()=>[]),
    safe('/rest/v1/accounting_integration_contracts?select=*&active=eq.true&order=route.asc,priority.asc,event_type.asc',[]),
    safe('/rest/v1/please_accounting_outbox?select=event_key,event_type,source_table,source_record_id,source_reference,status,attempts,last_error,cal_journal_entry_id,created_at,updated_at,processed_at&order=updated_at.desc&limit=100',[]),
    safe('/rest/v1/please_domain_events?event_type=in.(GIFI_WORKING_PAPER_CREATED,COMPLIANCE_OBLIGATION_CREATED,COMPLIANCE_APPROVAL_RECORDED,COMPLIANCE_EVIDENCE_RECORDED,ACCOUNTANT_PACKAGE_CREATED)&select=event_type,source_table,source_record_id,source_reference,occurred_at&order=occurred_at.desc&limit=50',[])
  ]);
  const health=scalar(healthRaw)||{},engine=scalar(engineRaw)||{},exceptions=Array.isArray(exceptionsRaw)?exceptionsRaw:[];
  return{health,engine,exceptions,contracts:contracts||[],recent:recent||[],domainEvents:domainEvents||[],supportedFinancialEvents:accounting.SUPPORTED_FINANCIAL_EVENT_TYPES||[],priority:accounting.FINANCIAL_EVENT_PRIORITY||{}};
}
async function audit(auth,event,eventType,after){try{await lib.sbJson('/rest/v1/accounting_audit_log',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({actor_user_id:null,event_type:eventType,object_type:'STEP18_11_INTEGRATION',object_id:null,after_data:after||null,metadata:{step:'18.11',source:'CAL_INTEGRATION_API',please_admin_user_id:auth.user.id,actor_email:auth.user.email,ip:lib.requestIp(event)||null,user_agent:lib.requestUserAgent(event)||null}})});}catch(e){console.warn('cal-integration audit',e?.message||e)}}
exports.handler=async event=>{
  if(!['GET','POST'].includes(event.httpMethod))return lib.json(405,{error:'Method not allowed'});
  if(event.httpMethod==='POST'&&!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin.'});
  try{
    const auth=await lib.requireAdmin(event);
    if(event.httpMethod==='GET')return lib.json(200,{ok:true,data:await getData()});
    const b=bodyOf(event),action=String(b.action||'').toUpperCase(),p=b.payload||{};let result;
    if(action==='RECONCILE'){
      const limit=Math.max(25,Math.min(500,Number(p.limit||200)));
      result={scan:await accounting.reconcile(limit)};
      await audit(auth,event,'INTEGRATION_RECONCILIATION_SCAN',result.scan);
    }else if(action==='RUN_WORKER'){
      const limit=Math.max(1,Math.min(100,Number(p.limit||50)));
      result={worker:await accounting.runWorker({limit,workerId:`integration-${String(auth.user.id).slice(0,8)}`})};
      await audit(auth,event,'INTEGRATION_WORKER_RUN',result.worker);
    }else if(action==='REQUEUE_DEAD_LETTER'){
      const key=clean(p.event_key,500);if(!key){const e=new Error('Event key is required.');e.status=400;throw e}
      const r=await rpc('accounting_requeue_dead_letter',{p_event_key:key});
      result={event_key:key,status:scalar(r)};
      await audit(auth,event,'INTEGRATION_DEAD_LETTER_REQUEUED',result);
    }else return lib.json(400,{error:'Unsupported Integration action.'});
    return lib.json(200,{ok:true,result,data:await getData()});
  }catch(e){console.error('cal-integration',e);return lib.json(e.status||500,{error:e.message||'Unable to process Integration controls.'});}
};
