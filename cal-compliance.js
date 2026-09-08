const lib=require('./_admin-lib');
const enc=v=>encodeURIComponent(String(v??''));
const clean=(v,n=1200)=>String(v??'').trim().slice(0,n);
const bool=v=>v===true||String(v).toLowerCase()==='true'||String(v)==='1';
function bodyOf(event){try{return JSON.parse(event.body||'{}')}catch{const e=new Error('Invalid JSON body.');e.status=400;throw e}}
function bad(message,status=400){const e=new Error(message);e.status=status;throw e}
function scalar(v){if(Array.isArray(v))v=v[0];if(v&&typeof v==='object'){const k=Object.keys(v);if(k.length===1)return v[k[0]];}return v}
async function safe(path,fallback=[]){try{return await lib.sbJson(path)}catch(e){if(/does not exist|schema cache|42P01|42703/i.test(String(e.message||e)))return fallback;throw e}}
async function rpc(name,body){return lib.sbJson(`/rest/v1/rpc/${name}`,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(body||{})})}
async function audit(auth,event,eventType,objectType,objectId,afterData){try{await lib.sbJson('/rest/v1/accounting_audit_log',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({actor_user_id:auth.user.id,event_type:eventType,object_type:objectType,object_id:String(objectId||''),after_data:afterData||null,metadata:{step:'18.10',source:'CAL_COMPLIANCE_API',actor_email:auth.user.email,ip:lib.requestIp(event)||null,user_agent:lib.requestUserAgent(event)||null}})});}catch(e){console.warn('cal-compliance audit',e?.message||e)}}

async function getData(){
  const [company,settings,accounts,mappings,codes,papers,lines,obligations,approvals,evidence,packages,documents]=await Promise.all([
    safe('/rest/v1/accounting_company?select=legal_name,operating_name,business_number,province,fiscal_year_end,currency,gst_registered,sales_tax_account_number,retention_years&limit=1',[]),
    safe('/rest/v1/accounting_compliance_settings?select=*&order=created_at.asc&limit=1',[]),
    safe('/rest/v1/accounting_accounts?select=id,code,name,account_type,account_subtype,active&active=eq.true&order=code.asc',[]),
    safe('/rest/v1/accounting_gifi_account_mappings?select=*&order=updated_at.desc',[]),
    safe('/rest/v1/accounting_gifi_codes?select=code,name,statement_section,normal_sign,source_reference,active&active=eq.true&order=code.asc',[]),
    safe('/rest/v1/accounting_gifi_working_papers?select=*&order=tax_year_end_year.desc,revision.desc&limit=60',[]),
    safe('/rest/v1/accounting_gifi_working_paper_lines?select=*&order=working_paper_id,sort_order,id&limit=12000',[]),
    safe('/rest/v1/accounting_compliance_obligations?select=*&order=due_date.asc,title.asc&limit=3000',[]),
    safe('/rest/v1/accounting_compliance_approvals?select=*&order=occurred_at.desc&limit=1000',[]),
    safe('/rest/v1/accounting_filing_evidence?select=*&order=recorded_at.desc&limit=1000',[]),
    safe('/rest/v1/accounting_accountant_packages?select=*&order=tax_year_end_year.desc,revision.desc&limit=30',[]),
    safe('/rest/v1/accounting_documents?select=id,document_type,original_name,mime_type,related_type,related_id,created_at&order=created_at.desc&limit=500',[])
  ]);
  const mm=new Map((mappings||[]).map(x=>[x.account_id,x])),cm=new Map((codes||[]).map(x=>[x.code,x]));
  const normalizedAccounts=(accounts||[]).map(a=>{const m=mm.get(a.id)||null;return{...a,gifi_mapping:m?{...m,gifi:cm.get(m.gifi_code)||null}:null}});
  const lineMap=new Map();for(const l of lines||[]){if(!lineMap.has(l.working_paper_id))lineMap.set(l.working_paper_id,[]);lineMap.get(l.working_paper_id).push(l)}
  const normalizedPapers=(papers||[]).map(p=>({...p,lines:lineMap.get(p.id)||[]}));
  const today=new Date();today.setHours(0,0,0,0);const in30=new Date(today);in30.setDate(in30.getDate()+30);
  const openStatuses=new Set(['OPEN','PREPARED','REVIEWED','APPROVED']);
  const overdue=(obligations||[]).filter(o=>openStatuses.has(o.status)&&new Date(`${o.due_date}T00:00:00`)<today).length;
  const due30=(obligations||[]).filter(o=>openStatuses.has(o.status)&&new Date(`${o.due_date}T00:00:00`)>=today&&new Date(`${o.due_date}T00:00:00`)<=in30).length;
  const unmapped=normalizedAccounts.filter(a=>!a.gifi_mapping).length;
  return{company:company?.[0]||null,settings:settings?.[0]||null,accounts:normalizedAccounts,gifiCodes:codes||[],gifiPapers:normalizedPapers,obligations:obligations||[],approvals:approvals||[],evidence:evidence||[],packages:packages||[],documents:documents||[],summary:{overdue,due30,unmappedAccounts:unmapped,approvedPackages:(packages||[]).filter(x=>x.status==='APPROVED').length,approvedGifi:(papers||[]).filter(x=>x.status==='APPROVED').length}};
}

async function saveSettings(auth,event,p){
  const fed=Number(p.federal_balance_due_months||2),ab=Number(p.alberta_balance_due_months||2);
  const r=await rpc('accounting_save_compliance_settings',{p_gst_frequency:clean(p.gst_reporting_frequency,20).toUpperCase()||'UNCONFIGURED',p_federal_balance_months:fed,p_alberta_balance_months:ab,p_three_month_basis:clean(p.three_month_balance_due_basis)||null,p_t2:bool(p.t2_enabled),p_at1:bool(p.at1_enabled),p_gst:bool(p.gst_hst_enabled),p_payroll:bool(p.payroll_remittance_enabled),p_t4:bool(p.t4_enabled),p_package:bool(p.accountant_package_enabled),p_notes:clean(p.notes,2000)||null,p_actor_id:String(auth.user.id)});
  await audit(auth,event,'COMPLIANCE_SETTINGS_UPDATED','accounting_compliance_settings',scalar(r),{gst_reporting_frequency:p.gst_reporting_frequency,federal_balance_due_months:fed,alberta_balance_due_months:ab});return String(scalar(r)||'');
}
async function saveMapping(auth,event,p){const accountId=clean(p.account_id,80),code=clean(p.gifi_code,4);if(!accountId||!code)bad('GL account and GIFI code are required.');const sign=Number(p.sign_multiplier||1);const r=await rpc('accounting_save_gifi_mapping',{p_account_id:accountId,p_gifi_code:code,p_sign_multiplier:sign,p_note:clean(p.mapping_note,1000)||null,p_actor_id:String(auth.user.id)});await audit(auth,event,'GIFI_MAPPING_SAVED','accounting_accounts',accountId,{gifi_code:code,sign_multiplier:sign});return String(scalar(r)||accountId)}
async function generateGifi(auth,event,p){const year=Number(p.tax_year_end_year);if(!Number.isInteger(year)||year<2000||year>2200)bad('Valid fiscal year-end year is required.');const r=await rpc('accounting_generate_gifi_working_paper',{p_tax_year_end_year:year,p_actor_id:String(auth.user.id)});await audit(auth,event,'GIFI_WORKING_PAPER_GENERATED','accounting_gifi_working_papers',scalar(r),{tax_year_end_year:year});return String(scalar(r)||'')}
async function reviewGifi(auth,event,p,approve=false){const id=clean(p.working_paper_id,80),comment=clean(p.comment,1200);if(!id)bad('GIFI working paper is required.');const name=approve?'accounting_approve_gifi_working_paper':'accounting_review_gifi_working_paper';const r=await rpc(name,{p_working_paper_id:id,p_comment:comment,p_actor_id:String(auth.user.id)});await audit(auth,event,approve?'GIFI_APPROVED':'GIFI_REVIEWED','accounting_gifi_working_papers',id,{comment});return String(scalar(r)||'')}
async function generateCalendar(auth,event,p){const year=Number(p.year);if(!Number.isInteger(year)||year<2000||year>2200)bad('Valid calendar/tax year is required.');const r=await rpc('accounting_generate_compliance_calendar',{p_year:year,p_actor_id:String(auth.user.id)});await audit(auth,event,'COMPLIANCE_CALENDAR_GENERATED','accounting_compliance_obligations',year,{year,count:Number(scalar(r)||0)});return Number(scalar(r)||0)}
async function advanceObligation(auth,event,p){const id=clean(p.obligation_id,80),action=clean(p.workflow_action,20).toUpperCase(),comment=clean(p.comment,1200);if(!id||!action)bad('Obligation and workflow action are required.');const r=await rpc('accounting_advance_compliance_obligation',{p_obligation_id:id,p_action:action,p_comment:comment||null,p_actor_id:String(auth.user.id)});await audit(auth,event,'COMPLIANCE_OBLIGATION_'+action,'accounting_compliance_obligations',id,{comment});return String(scalar(r)||'')}
async function recordEvidence(auth,event,p){const id=clean(p.obligation_id,80),finalStatus=clean(p.final_status,10).toUpperCase(),etype=clean(p.evidence_type,40).toUpperCase(),confirmation=clean(p.confirmation_reference,300);if(!id||!finalStatus||!etype||!confirmation)bad('Obligation, final status, evidence type and confirmation reference are required.');const amount=p.amount===''||p.amount==null?null:Number(p.amount);if(amount!=null&&!Number.isFinite(amount))bad('Evidence amount is invalid.');const r=await rpc('accounting_record_filing_evidence',{p_obligation_id:id,p_final_status:finalStatus,p_evidence_type:etype,p_when:p.filed_or_paid_at||new Date().toISOString(),p_confirmation:confirmation,p_method:clean(p.method,200)||null,p_amount:amount,p_document_id:clean(p.accounting_document_id,80)||null,p_document_reference:clean(p.document_reference,500)||null,p_notes:clean(p.notes,2000)||null,p_supersedes:clean(p.supersedes_evidence_id,80)||null,p_actor_id:String(auth.user.id)});await audit(auth,event,'COMPLIANCE_EVIDENCE_RECORDED','accounting_filing_evidence',scalar(r),{obligation_id:id,final_status:finalStatus,evidence_type:etype,confirmation_reference:confirmation});return String(scalar(r)||'')}
async function generatePackage(auth,event,p){const year=Number(p.tax_year_end_year);if(!Number.isInteger(year)||year<2000||year>2200)bad('Valid fiscal year-end year is required.');const r=await rpc('accounting_generate_accountant_package',{p_tax_year_end_year:year,p_actor_id:String(auth.user.id)});await audit(auth,event,'ACCOUNTANT_PACKAGE_GENERATED','accounting_accountant_packages',scalar(r),{tax_year_end_year:year});return String(scalar(r)||'')}
async function reviewPackage(auth,event,p,approve=false){const id=clean(p.package_id,80),comment=clean(p.comment,1200);if(!id)bad('Accountant package is required.');const name=approve?'accounting_approve_accountant_package':'accounting_review_accountant_package';const r=await rpc(name,{p_package_id:id,p_comment:comment,p_actor_id:String(auth.user.id)});await audit(auth,event,approve?'ACCOUNTANT_PACKAGE_APPROVED':'ACCOUNTANT_PACKAGE_REVIEWED','accounting_accountant_packages',id,{comment});return String(scalar(r)||'')}

exports.handler=async event=>{
  if(!['GET','POST'].includes(event.httpMethod))return lib.json(405,{error:'Method not allowed'});
  if(event.httpMethod==='POST'&&!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin.'});
  try{
    const auth=await lib.requireAdmin(event);
    if(event.httpMethod==='GET')return lib.json(200,{ok:true,data:await getData()});
    const b=bodyOf(event),action=String(b.action||'').toUpperCase(),p=b.payload||{};let result;
    if(action==='SAVE_SETTINGS')result={id:await saveSettings(auth,event,p)};
    else if(action==='SAVE_GIFI_MAPPING')result={id:await saveMapping(auth,event,p)};
    else if(action==='GENERATE_GIFI')result={id:await generateGifi(auth,event,p)};
    else if(action==='REVIEW_GIFI')result={status:await reviewGifi(auth,event,p,false)};
    else if(action==='APPROVE_GIFI')result={status:await reviewGifi(auth,event,p,true)};
    else if(action==='GENERATE_CALENDAR')result={count:await generateCalendar(auth,event,p)};
    else if(action==='ADVANCE_OBLIGATION')result={status:await advanceObligation(auth,event,p)};
    else if(action==='RECORD_EVIDENCE')result={id:await recordEvidence(auth,event,p)};
    else if(action==='GENERATE_PACKAGE')result={id:await generatePackage(auth,event,p)};
    else if(action==='REVIEW_PACKAGE')result={status:await reviewPackage(auth,event,p,false)};
    else if(action==='APPROVE_PACKAGE')result={status:await reviewPackage(auth,event,p,true)};
    else return lib.json(400,{error:'Unsupported Accountant & Compliance action.'});
    return lib.json(200,{ok:true,result,data:await getData()});
  }catch(e){console.error('cal-compliance',e);return lib.json(e.status||500,{error:e.message||'Unable to process Accountant & Compliance Center.'});}
};
