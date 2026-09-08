const lib=require('./_admin-lib');
const enc=v=>encodeURIComponent(String(v??''));
const clean=(v,n=1000)=>String(v??'').trim().slice(0,n);
function bodyOf(event){try{return JSON.parse(event.body||'{}')}catch{const e=new Error('Invalid JSON body.');e.status=400;throw e}}
function bad(message,status=400){const e=new Error(message);e.status=status;throw e}
function scalar(v){if(Array.isArray(v))v=v[0];if(v&&typeof v==='object'){const k=Object.keys(v);if(k.length===1)return v[k[0]];}return v}
async function safe(path,fallback=[]){try{return await lib.sbJson(path)}catch(e){if(/does not exist|schema cache|42P01|42703/i.test(String(e.message||e)))return fallback;throw e}}
async function rpc(name,body){return lib.sbJson(`/rest/v1/rpc/${name}`,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(body||{})})}

async function getData(event){
  const q=event.queryStringParameters||{};
  const [periods,accounts,healthRaw]=await Promise.all([
    safe('/rest/v1/accounting_fiscal_periods?select=id,period_start,period_end,status,close_state,close_version,last_prepared_at,last_prepared_by,close_notes,closed_at,reopened_at,reopened_by,reopen_reason&order=period_end.desc,period_start.desc&limit=120',[]),
    safe('/rest/v1/accounting_accounts?select=id,code,name,account_type,account_subtype,allow_manual_posting,active&active=eq.true&allow_manual_posting=eq.true&order=code.asc',[]),
    rpc('accounting_engine_health',{}).catch(()=>({status:'UNKNOWN'}))
  ]);
  let selectedId=clean(q.period_id,80)||null;
  if(!selectedId)selectedId=(periods||[]).find(x=>x.status==='OPEN')?.id||(periods||[])[0]?.id||null;
  const selected=(periods||[]).find(x=>x.id===selectedId)||null;
  let controls=[],adjustments=[],actions=[],snapshots=[],adjustmentEvents=[];
  if(selected){
    [controls,adjustments,actions,snapshots,adjustmentEvents]=await Promise.all([
      safe(`/rest/v1/accounting_period_close_checklist?period_id=eq.${enc(selected.id)}&select=*&order=category.asc,control_code.asc`,[]),
      safe(`/rest/v1/accounting_period_adjustments?period_id=eq.${enc(selected.id)}&select=*&order=entry_date.desc,created_at.desc&limit=500`,[]),
      safe(`/rest/v1/accounting_period_close_actions?period_id=eq.${enc(selected.id)}&select=*&order=occurred_at.desc&limit=300`,[]),
      safe(`/rest/v1/accounting_period_close_snapshots?period_id=eq.${enc(selected.id)}&select=id,period_id,close_version,created_by,created_at&order=close_version.desc&limit=20`,[]),
      safe('/rest/v1/please_accounting_outbox?event_type=eq.PERIOD_CLOSE_ADJUSTMENT_POSTED&select=source_record_id,status,journal_entry_id,last_error,updated_at&order=updated_at.desc&limit=1000',[])
    ]);
  }
  const health=Array.isArray(healthRaw)?(healthRaw[0]||{}):(healthRaw||{});
  const eventMap=new Map((adjustmentEvents||[]).map(x=>[String(x.source_record_id),x]));adjustments=(adjustments||[]).map(x=>({...x,accounting_event:eventMap.get(String(x.id))||null}));
  const blockers=(controls||[]).filter(x=>x.status==='BLOCKER').length,reviews=(controls||[]).filter(x=>x.status==='REVIEW').length,overrides=(controls||[]).filter(x=>x.status==='OVERRIDDEN').length;
  return{periods:periods||[],selectedPeriod:selected,controls:controls||[],adjustments:adjustments||[],actions:actions||[],snapshots:snapshots||[],accounts:accounts||[],engineHealth:health||{},summary:{blockers,reviews,overrides,ready:!!selected&&blockers===0&&reviews===0&&controls.length>0}};
}

async function prepare(auth,p){const start=clean(p.period_start,10),end=clean(p.period_end,10);if(!start||!end)bad('Period start and end are required.');const r=await rpc('accounting_prepare_period_close',{p_period_start:start,p_period_end:end,p_actor_id:String(auth.user.id)});return String(scalar(r)||'')}
async function refresh(auth,p){const id=clean(p.period_id,80);if(!id)bad('Fiscal period is required.');await rpc('accounting_refresh_period_close_checklist',{p_period_id:id,p_actor_id:String(auth.user.id)});return id}
async function overrideControl(auth,p){const id=clean(p.period_id,80),code=clean(p.control_code,80),reason=clean(p.reason,1200);if(!id||!code)bad('Period and control are required.');if(reason.length<10)bad('Sign-off reason must be at least 10 characters.');await rpc('accounting_override_period_close_control',{p_period_id:id,p_control_code:code,p_reason:reason,p_actor_id:String(auth.user.id)});return id}
async function adjustment(auth,p){const id=clean(p.period_id,80),date=clean(p.entry_date,10),memo=clean(p.memo,500),reason=clean(p.reason,1200),lines=Array.isArray(p.lines)?p.lines.slice(0,40):[];if(!id||!date||!memo||lines.length<2)bad('Period, entry date, memo and at least two lines are required.');const normalized=lines.map(x=>({code:clean(x.code,30),debit:Number(x.debit||0),credit:Number(x.credit||0),description:clean(x.description,500)||memo}));const r=await rpc('accounting_create_period_close_adjustment',{p_period_id:id,p_entry_date:date,p_memo:memo,p_lines:normalized,p_reason:reason||null,p_actor_id:String(auth.user.id)});await rpc('accounting_refresh_period_close_checklist',{p_period_id:id,p_actor_id:String(auth.user.id)});return String(scalar(r)||'')}
async function reverseAdjustment(auth,p){const id=clean(p.adjustment_id,80),date=clean(p.reversal_date,10),reason=clean(p.reason,1200);if(!id||!date)bad('Adjustment and reversal date are required.');if(reason.length<10)bad('Reversal reason must be at least 10 characters.');const r=await rpc('accounting_create_period_close_reversal',{p_adjustment_id:id,p_reversal_date:date,p_reason:reason,p_actor_id:String(auth.user.id)});const a=(await safe(`/rest/v1/accounting_period_adjustments?id=eq.${enc(id)}&select=period_id&limit=1`,[]))?.[0];if(a?.period_id)await rpc('accounting_refresh_period_close_checklist',{p_period_id:a.period_id,p_actor_id:String(auth.user.id)});return String(scalar(r)||'')}
async function closePeriod(auth,p){const id=clean(p.period_id,80),notes=clean(p.notes,1200),confirmation=clean(p.confirmation,20).toUpperCase();if(!id)bad('Fiscal period is required.');if(confirmation!=='CLOSE')bad('Type CLOSE to confirm the period lock.');await rpc('accounting_close_fiscal_period',{p_period_id:id,p_notes:notes||null,p_actor_id:String(auth.user.id)});return id}
async function reopenPeriod(auth,p){const id=clean(p.period_id,80),reason=clean(p.reason,1200),confirmation=clean(p.confirmation,20).toUpperCase();if(!id)bad('Fiscal period is required.');if(confirmation!=='REOPEN')bad('Type REOPEN to confirm.');if(reason.length<10)bad('Reopen reason must be at least 10 characters.');await rpc('accounting_reopen_fiscal_period',{p_period_id:id,p_reason:reason,p_actor_id:String(auth.user.id)});return id}

exports.handler=async event=>{
  if(!['GET','POST'].includes(event.httpMethod))return lib.json(405,{error:'Method not allowed'});
  if(event.httpMethod==='POST'&&!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin.'});
  try{
    const auth=await lib.requireAdmin(event);
    if(event.httpMethod==='GET')return lib.json(200,{ok:true,data:await getData(event)});
    const b=bodyOf(event),action=String(b.action||'').toUpperCase(),p=b.payload||{};let result;
    if(action==='PREPARE')result={period_id:await prepare(auth,p)};
    else if(action==='REFRESH')result={period_id:await refresh(auth,p)};
    else if(action==='OVERRIDE_CONTROL')result={period_id:await overrideControl(auth,p)};
    else if(action==='POST_ADJUSTMENT')result={adjustment_id:await adjustment(auth,p)};
    else if(action==='REVERSE_ADJUSTMENT')result={adjustment_id:await reverseAdjustment(auth,p)};
    else if(action==='CLOSE_PERIOD')result={period_id:await closePeriod(auth,p)};
    else if(action==='REOPEN_PERIOD')result={period_id:await reopenPeriod(auth,p)};
    else return lib.json(400,{error:'Unsupported Period Close action.'});
    return lib.json(200,{ok:true,result,data:await getData({...event,queryStringParameters:{period_id:result.period_id||p.period_id||''}})});
  }catch(e){console.error('cal-period-close',e);return lib.json(e.status||500,{error:e.message||'Unable to process Period Close.'});}
};
