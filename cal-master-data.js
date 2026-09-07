const lib=require('./_admin-lib');

const enc=v=>encodeURIComponent(String(v??''));
const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
const bool=v=>v===true||String(v).toLowerCase()==='true'||String(v)==='1';
const ROLES=new Set(['CUSTOMER','OPERATIONAL_PROVIDER','SUPPLIER','EMPLOYEE','CONTRACTOR','OTHER']);
const PARTY_TYPES=new Set(['INDIVIDUAL','ORGANIZATION']);
const ACCOUNT_TYPES=new Set(['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE']);
const FIN_TYPES=new Set(['BANK','CASH','CREDIT_CARD','CLEARING','LOAN','OTHER']);
const PROTECTED_ACCOUNT_FIELDS=new Set(['code','account_type','active']);

function bodyOf(event){try{return JSON.parse(event.body||'{}')}catch{const e=new Error('Invalid JSON body.');e.status=400;throw e}}
function moneyRate(v){const n=Number(v||0);if(!Number.isFinite(n)||n<0||n>100){const e=new Error('Tax rates must be between 0 and 100.');e.status=400;throw e}return n}
async function audit(auth,event,objectType,objectId,action,afterData){
  try{
    await lib.sbJson('/rest/v1/accounting_audit_log',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({
      actor_user_id:auth.user.id,event_type:action,object_type:objectType,object_id:String(objectId||''),after_data:afterData||null,
      metadata:{step:'18.1',source:'CAL_MASTER_DATA_API',actor_email:auth.user.email,ip:lib.requestIp(event)||null,user_agent:lib.requestUserAgent(event)||null}
    })});
  }catch(e){console.warn('cal-master-data audit',e?.message||e);}
}
async function getData(){
  const [parties,roles,accounts,taxCodes,financialAccounts]=await Promise.all([
    lib.sbJson('/rest/v1/accounting_parties?select=id,party_number,party_type,legal_name,display_name,email,phone,address,business_number,tax_number,default_currency,payment_terms_days,notes,active,source_system,source_table,source_record_id,created_at,updated_at&order=legal_name.asc'),
    lib.sbJson('/rest/v1/accounting_party_roles?select=party_id,role,active,effective_from,effective_to,metadata,created_at,updated_at&order=role.asc'),
    lib.sbJson('/rest/v1/accounting_accounts?select=id,code,name,account_type,account_subtype,parent_id,active,system_managed,allow_manual_posting,created_at,updated_at&order=code.asc'),
    lib.sbJson('/rest/v1/accounting_tax_codes?select=id,code,name,federal_rate,provincial_rate,tax_kind,province,recoverable_default,effective_from,effective_to,active,system_managed,updated_at&order=province.asc,code.asc'),
    lib.sbJson('/rest/v1/accounting_financial_accounts?select=id,name,financial_type,institution_name,account_last4,currency,gl_account_id,is_primary,active,source_reference,metadata,created_at,updated_at&order=financial_type.asc,name.asc')
  ]);
  const roleMap=new Map();
  for(const r of roles||[]){if(!roleMap.has(r.party_id))roleMap.set(r.party_id,[]);roleMap.get(r.party_id).push(r)}
  const accountMap=new Map((accounts||[]).map(a=>[a.id,a]));
  const normalizedParties=(parties||[]).map(p=>({...p,roles:roleMap.get(p.id)||[],managed_by:p.source_system==='PLEASE'?'PLEASE':'CAL'}));
  const normalizedFinancial=(financialAccounts||[]).map(f=>({...f,gl_account:accountMap.get(f.gl_account_id)||null}));
  const counts={
    parties:normalizedParties.filter(x=>x.active).length,
    suppliers:normalizedParties.filter(x=>x.active&&x.roles.some(r=>r.role==='SUPPLIER'&&r.active)).length,
    operationalProviders:normalizedParties.filter(x=>x.active&&x.roles.some(r=>r.role==='OPERATIONAL_PROVIDER'&&r.active)).length,
    customers:normalizedParties.filter(x=>x.active&&x.roles.some(r=>r.role==='CUSTOMER'&&r.active)).length,
    financialAccounts:normalizedFinancial.filter(x=>x.active).length
  };
  return{parties:normalizedParties,accounts:accounts||[],taxCodes:taxCodes||[],financialAccounts:normalizedFinancial,counts};
}
async function protectedRolesFor(party){
  const protectedSet=new Set();
  if(party?.source_system==='PLEASE'&&party?.source_table==='customers')protectedSet.add('CUSTOMER');
  if(party?.source_system==='PLEASE'&&party?.source_table==='providers'){
    protectedSet.add('OPERATIONAL_PROVIDER');
    const rows=await lib.sbJson(`/rest/v1/accounting_party_roles?party_id=eq.${enc(party.id)}&role=in.(EMPLOYEE,CONTRACTOR)&active=eq.true&select=role`);
    for(const r of rows||[])protectedSet.add(r.role);
  }
  return protectedSet;
}
async function setPartyRoles(party,requested){
  const wanted=new Set((requested||[]).map(x=>String(x||'').toUpperCase()).filter(x=>ROLES.has(x)));
  for(const r of await protectedRolesFor(party))wanted.add(r);
  if(!wanted.size){const e=new Error('At least one valid business role is required.');e.status=400;throw e}
  const current=await lib.sbJson(`/rest/v1/accounting_party_roles?party_id=eq.${enc(party.id)}&select=party_id,role,active`);
  for(const r of current||[]){
    const should=wanted.has(r.role);
    if(Boolean(r.active)!==should)await lib.sbJson(`/rest/v1/accounting_party_roles?party_id=eq.${enc(party.id)}&role=eq.${enc(r.role)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({active:should,effective_to:should?null:new Date().toISOString().slice(0,10)})});
  }
  const have=new Set((current||[]).map(x=>x.role));
  for(const role of wanted)if(!have.has(role))await lib.sbJson('/rest/v1/accounting_party_roles',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({party_id:party.id,role,active:true,effective_from:new Date().toISOString().slice(0,10),metadata:{source:'CAL Master Data'}})});
}
async function saveParty(auth,event,payload){
  const id=clean(payload.id,80);
  let party=null;
  if(id){
    party=(await lib.sbJson(`/rest/v1/accounting_parties?id=eq.${enc(id)}&select=*&limit=1`))?.[0];
    if(!party){const e=new Error('Business partner not found.');e.status=404;throw e}
    if(party.source_system==='PLEASE'){
      // Operational identity stays source-managed. CAL may maintain accounting-only attributes and roles.
      const financePatch={
        business_number:clean(payload.business_number,80)||party.business_number||null,
        tax_number:clean(payload.tax_number,80)||party.tax_number||null,
        default_currency:(clean(payload.default_currency,3)||party.default_currency||'CAD').toUpperCase(),
        payment_terms_days:Math.max(0,Math.min(365,Number(payload.payment_terms_days||0)||0)),
        notes:clean(payload.notes,2000)||null
      };
      await lib.sbJson(`/rest/v1/accounting_parties?id=eq.${enc(party.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(financePatch)});
      await setPartyRoles(party,payload.roles||[]);
      await audit(auth,event,'accounting_parties',party.id,'MASTER_DATA_PARTY_FINANCE_UPDATED',{...financePatch,roles:payload.roles||[],source_managed:true});
      return party.id;
    }
  }
  const partyType=String(payload.party_type||'ORGANIZATION').toUpperCase();
  if(!PARTY_TYPES.has(partyType)){const e=new Error('Invalid party type.');e.status=400;throw e}
  const legalName=clean(payload.legal_name,240);if(!legalName){const e=new Error('Legal/business name is required.');e.status=400;throw e}
  const row={party_type:partyType,legal_name:legalName,display_name:clean(payload.display_name,240)||null,email:clean(payload.email,320)||null,phone:clean(payload.phone,80)||null,address:{line1:clean(payload.address_line1,240)||null,line2:clean(payload.address_line2,240)||null,city:clean(payload.city,120)||null,province:clean(payload.address_province,40)||null,postal_code:clean(payload.postal_code,24)||null,country:clean(payload.country,80)||'Canada'},business_number:clean(payload.business_number,80)||null,tax_number:clean(payload.tax_number,80)||null,default_currency:(clean(payload.default_currency,3)||'CAD').toUpperCase(),payment_terms_days:Math.max(0,Math.min(365,Number(payload.payment_terms_days||0)||0)),notes:clean(payload.notes,2000)||null,active:payload.active!==false,source_system:'CAL',source_table:'accounting_parties'};
  if(id){
    await lib.sbJson(`/rest/v1/accounting_parties?id=eq.${enc(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)});
    party={...party,...row,id};
  }else{
    const created=await lib.sbJson('/rest/v1/accounting_parties',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(row)});
    party=created?.[0];if(!party?.id)throw new Error('Business partner could not be created.');
  }
  await setPartyRoles(party,payload.roles||['SUPPLIER']);
  await audit(auth,event,'accounting_parties',party.id,id?'MASTER_DATA_PARTY_UPDATED':'MASTER_DATA_PARTY_CREATED',{...row,roles:payload.roles||['SUPPLIER']});
  return party.id;
}
async function saveFinancialAccount(auth,event,payload){
  const id=clean(payload.id,80),type=String(payload.financial_type||'').toUpperCase();
  if(!FIN_TYPES.has(type)){const e=new Error('Invalid financial account type.');e.status=400;throw e}
  const name=clean(payload.name,240);if(!name){const e=new Error('Financial account name is required.');e.status=400;throw e}
  const glId=clean(payload.gl_account_id,80);if(!glId){const e=new Error('A mapped GL account is required.');e.status=400;throw e}
  const gl=(await lib.sbJson(`/rest/v1/accounting_accounts?id=eq.${enc(glId)}&select=id,code,name,account_type,active&limit=1`))?.[0];
  if(!gl||gl.active===false){const e=new Error('Mapped GL account was not found or is inactive.');e.status=400;throw e}
  const assetKinds=new Set(['BANK','CASH','CLEARING']);
  const liabilityKinds=new Set(['CREDIT_CARD','LOAN']);
  if(assetKinds.has(type)&&gl.account_type!=='ASSET'){const e=new Error(`${type} must map to an ASSET GL account.`);e.status=400;throw e}
  if(liabilityKinds.has(type)&&gl.account_type!=='LIABILITY'){const e=new Error(`${type} must map to a LIABILITY GL account.`);e.status=400;throw e}
  const isPrimary=bool(payload.is_primary),active=payload.active!==false;
  const row={name,financial_type:type,institution_name:clean(payload.institution_name,240)||null,account_last4:clean(payload.account_last4,4)||null,currency:(clean(payload.currency,3)||'CAD').toUpperCase(),gl_account_id:gl.id,is_primary:isPrimary,active,source_reference:clean(payload.source_reference,240)||null};
  if(isPrimary&&active)await lib.sbJson(`/rest/v1/accounting_financial_accounts?financial_type=eq.${enc(type)}&is_primary=eq.true${id?`&id=neq.${enc(id)}`:''}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({is_primary:false})});
  if(id){
    const existing=(await lib.sbJson(`/rest/v1/accounting_financial_accounts?id=eq.${enc(id)}&select=id&limit=1`))?.[0];if(!existing){const e=new Error('Financial account not found.');e.status=404;throw e}
    await lib.sbJson(`/rest/v1/accounting_financial_accounts?id=eq.${enc(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)});
  }else await lib.sbJson('/rest/v1/accounting_financial_accounts',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)});
  await audit(auth,event,'accounting_financial_accounts',id||gl.id,id?'MASTER_DATA_FINANCIAL_ACCOUNT_UPDATED':'MASTER_DATA_FINANCIAL_ACCOUNT_CREATED',row);
}
async function saveAccount(auth,event,payload){
  const id=clean(payload.id,80),code=clean(payload.code,30).toUpperCase(),name=clean(payload.name,240),type=String(payload.account_type||'').toUpperCase();
  if(!code||!name||!ACCOUNT_TYPES.has(type)){const e=new Error('Account code, name and valid type are required.');e.status=400;throw e}
  const active=payload.active!==false,allowManual=payload.allow_manual_posting!==false;
  const row={code,name,account_type:type,account_subtype:clean(payload.account_subtype,80)||null,parent_id:clean(payload.parent_id,80)||null,active,allow_manual_posting:allowManual};
  if(id){
    const existing=(await lib.sbJson(`/rest/v1/accounting_accounts?id=eq.${enc(id)}&select=*&limit=1`))?.[0];if(!existing){const e=new Error('GL account not found.');e.status=404;throw e}
    if(existing.system_managed){
      if(code!==existing.code||type!==existing.account_type||!active){const e=new Error('System-managed account code, type and active status are protected.');e.status=409;throw e}
    }
    if(row.parent_id===id){const e=new Error('An account cannot be its own parent.');e.status=400;throw e}
    await lib.sbJson(`/rest/v1/accounting_accounts?id=eq.${enc(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)});
  }else{
    await lib.sbJson('/rest/v1/accounting_accounts',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({...row,system_managed:false})});
  }
  await audit(auth,event,'accounting_accounts',id||code,id?'MASTER_DATA_GL_ACCOUNT_UPDATED':'MASTER_DATA_GL_ACCOUNT_CREATED',row);
}
async function saveTaxCode(auth,event,payload){
  const id=clean(payload.id,80),code=clean(payload.code,40).toUpperCase(),name=clean(payload.name,240),kind=clean(payload.tax_kind,40).toUpperCase(),province=clean(payload.province,4).toUpperCase();
  if(!code||!name||!kind){const e=new Error('Tax code, name and tax kind are required.');e.status=400;throw e}
  const row={code,name,federal_rate:moneyRate(payload.federal_rate),provincial_rate:moneyRate(payload.provincial_rate),tax_kind:kind,province:province||null,recoverable_default:payload.recoverable_default!==false,effective_from:clean(payload.effective_from,10)||new Date().toISOString().slice(0,10),effective_to:clean(payload.effective_to,10)||null,active:payload.active!==false};
  if(row.effective_to&&row.effective_to<row.effective_from){const e=new Error('Tax effective-to date cannot be before effective-from date.');e.status=400;throw e}
  if(id){
    const existing=(await lib.sbJson(`/rest/v1/accounting_tax_codes?id=eq.${enc(id)}&select=*&limit=1`))?.[0];if(!existing){const e=new Error('Tax code not found.');e.status=404;throw e}
    if(existing.system_managed){const e=new Error('Seeded Canadian tax codes are protected. Create a new effective-dated tax code rather than rewriting history.');e.status=409;throw e}
    await lib.sbJson(`/rest/v1/accounting_tax_codes?id=eq.${enc(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)});
  }else await lib.sbJson('/rest/v1/accounting_tax_codes',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({...row,system_managed:false})});
  await audit(auth,event,'accounting_tax_codes',id||code,id?'MASTER_DATA_TAX_CODE_UPDATED':'MASTER_DATA_TAX_CODE_CREATED',row);
}

exports.handler=async event=>{
  if(!['GET','POST'].includes(event.httpMethod))return lib.json(405,{error:'Method not allowed'});
  if(event.httpMethod==='POST'&&!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin.'});
  try{
    const auth=await lib.requireAdmin(event);
    if(event.httpMethod==='GET')return lib.json(200,{ok:true,data:await getData()});
    const b=bodyOf(event),action=String(b.action||'').toUpperCase(),payload=b.payload||{};
    if(action==='SAVE_PARTY')await saveParty(auth,event,payload);
    else if(action==='SAVE_FINANCIAL_ACCOUNT')await saveFinancialAccount(auth,event,payload);
    else if(action==='SAVE_GL_ACCOUNT')await saveAccount(auth,event,payload);
    else if(action==='SAVE_TAX_CODE')await saveTaxCode(auth,event,payload);
    else return lib.json(400,{error:'Unsupported master-data action.'});
    return lib.json(200,{ok:true,data:await getData()});
  }catch(e){console.error('cal-master-data',e);return lib.json(e.status||500,{error:e.message||'Unable to update CAL master data.'});}
};
