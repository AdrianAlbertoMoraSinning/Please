const lib=require('./_admin-lib');
const enc=v=>encodeURIComponent(String(v??''));
const clean=(v,n=1000)=>String(v??'').trim().slice(0,n);
const money=v=>Math.round((Number(v)||0)*100)/100;
const today=()=>new Date().toISOString().slice(0,10);
function bodyOf(event){try{return JSON.parse(event.body||'{}')}catch{const e=new Error('Invalid JSON body.');e.status=400;throw e}}
function bad(message,status=400){const e=new Error(message);e.status=status;throw e}
function rpcScalar(v){if(Array.isArray(v))v=v[0];if(v&&typeof v==='object'){const k=Object.keys(v);if(k.length===1)return v[k[0]];}return v}
async function audit(auth,event,objectType,objectId,eventType,afterData){try{await lib.sbJson('/rest/v1/accounting_audit_log',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({actor_user_id:null,event_type:eventType,object_type:objectType,object_id:String(objectId||''),after_data:afterData||null,metadata:{step:'18.4',source:'CAL_EXPENSES_API',please_admin_user_id:auth.user.id,actor_email:auth.user.email,ip:lib.requestIp(event)||null,user_agent:lib.requestUserAgent(event)||null}})});}catch(e){console.warn('cal-expenses audit',e?.message||e)}}

async function getData(){
  const [parties,roles,accounts,taxCodes,financialAccounts,claims,lines,reimbursements,documents,legacyExpenses]=await Promise.all([
    lib.sbJson('/rest/v1/accounting_parties?select=id,party_number,legal_name,display_name,email,active,source_system,source_table&active=eq.true&order=legal_name.asc'),
    lib.sbJson('/rest/v1/accounting_party_roles?select=party_id,role,active&active=eq.true'),
    lib.sbJson('/rest/v1/accounting_accounts?select=id,code,name,account_type,account_subtype,active,system_managed&active=eq.true&order=code.asc'),
    lib.sbJson('/rest/v1/accounting_tax_codes?select=id,code,name,federal_rate,provincial_rate,tax_kind,province,recoverable_default,effective_from,effective_to,active&active=eq.true&order=code.asc'),
    lib.sbJson('/rest/v1/accounting_financial_accounts?select=id,name,financial_type,institution_name,account_last4,currency,gl_account_id,is_primary,active&active=eq.true&order=is_primary.desc,name.asc'),
    lib.sbJson('/rest/v1/accounting_expense_claims?select=*&order=expense_date.desc,created_at.desc&limit=750'),
    lib.sbJson('/rest/v1/accounting_expense_claim_lines?select=*&order=expense_claim_id.asc,sort_order.asc,id.asc&limit=5000'),
    lib.sbJson('/rest/v1/accounting_expense_reimbursements?select=*&order=payment_date.desc,created_at.desc&limit=2500'),
    lib.sbJson('/rest/v1/accounting_documents?select=id,document_type,original_name,mime_type,size_bytes,related_type,related_id,sha256_hash,source_reference,created_at&related_type=eq.EXPENSE_CLAIM&order=created_at.desc&limit=1500').catch(()=>[]),
    lib.sbJson('/rest/v1/accounting_expenses?select=id,expense_number,expense_date,status,subtotal,tax_total,total,recoverable_tax,description,source_reference,created_at&order=expense_date.desc,created_at.desc&limit=500').catch(()=>[])
  ]);
  const pm=new Map((parties||[]).map(x=>[x.id,x])),am=new Map((accounts||[]).map(x=>[x.id,x])),tm=new Map((taxCodes||[]).map(x=>[x.id,x]));
  const fm=new Map((financialAccounts||[]).map(x=>[x.id,{...x,gl_account:am.get(x.gl_account_id)||null}]));
  const lm=new Map();for(const l of lines||[]){if(!lm.has(l.expense_claim_id))lm.set(l.expense_claim_id,[]);lm.get(l.expense_claim_id).push({...l,posting_account:am.get(l.posting_account_id)||null,tax_code:tm.get(l.tax_code_id)||null});}
  const rm=new Map();for(const r of reimbursements||[]){if(!rm.has(r.expense_claim_id))rm.set(r.expense_claim_id,[]);rm.get(r.expense_claim_id).push({...r,financial_account:fm.get(r.financial_account_id)||null});}
  const dm=new Map((documents||[]).map(d=>[d.id,d]));
  const normalized=(claims||[]).map(x=>({...x,vendor:pm.get(x.vendor_party_id)||null,payee:pm.get(x.payee_party_id)||null,financial_account:fm.get(x.financial_account_id)||null,receipt_document:dm.get(x.receipt_document_id)||null,lines:lm.get(x.id)||[],reimbursements:rm.get(x.id)||[],reimbursement_balance:money(Math.max(0,Number(x.total||0)-Number(x.amount_reimbursed||0)))}));
  const rolesByParty=new Map();for(const r of roles||[]){if(!rolesByParty.has(r.party_id))rolesByParty.set(r.party_id,new Set());rolesByParty.get(r.party_id).add(r.role)}
  const vendors=(parties||[]).filter(p=>{const s=rolesByParty.get(p.id)||new Set();return s.has('SUPPLIER')});
  const payees=(parties||[]).filter(p=>{const s=rolesByParty.get(p.id)||new Set();return s.has('EMPLOYEE')||s.has('CONTRACTOR')});
  const counts={draft:normalized.filter(x=>x.status==='DRAFT').length,submitted:normalized.filter(x=>x.status==='SUBMITTED').length,approved:normalized.filter(x=>x.status==='APPROVED').length,posted:normalized.filter(x=>['POSTED','PAID'].includes(x.status)).length,unreimbursed:money(normalized.filter(x=>x.payment_mode==='REIMBURSEMENT'&&x.status==='POSTED').reduce((n,x)=>n+x.reimbursement_balance,0)),missingReceipts:normalized.filter(x=>x.receipt_status==='MISSING'&&!['VOID'].includes(x.status)).length,totalPosted:money(normalized.filter(x=>['POSTED','PAID'].includes(x.status)).reduce((n,x)=>n+Number(x.total||0),0))};
  return{expenses:normalized,operationalExpenses:(legacyExpenses||[]).map(x=>({...x})),vendors,payees,accounts:(accounts||[]).filter(a=>['EXPENSE','ASSET'].includes(a.account_type)),taxCodes:taxCodes||[],financialAccounts:[...fm.values()].filter(x=>['BANK','CASH','CREDIT_CARD'].includes(String(x.financial_type||'').toUpperCase())),counts};
}

async function normalizeLines(rawLines,expenseDate){
  const rows=Array.isArray(rawLines)?rawLines:[];if(!rows.length)bad('At least one expense line is required.');if(rows.length>100)bad('An expense cannot exceed 100 lines.');
  const [accounts,taxes]=await Promise.all([lib.sbJson('/rest/v1/accounting_accounts?select=id,code,name,account_type,account_subtype,active&active=eq.true'),lib.sbJson('/rest/v1/accounting_tax_codes?select=id,code,name,federal_rate,provincial_rate,tax_kind,recoverable_default,effective_from,effective_to,active&active=eq.true')]);
  const am=new Map((accounts||[]).map(x=>[x.id,x])),tm=new Map((taxes||[]).map(x=>[x.id,x]));
  return rows.map((x,i)=>{
    const description=clean(x.description,500);if(!description)bad(`Line ${i+1}: description is required.`);
    const classification=clean(x.classification,20).toUpperCase()||'EXPENSE';if(!['EXPENSE','PREPAID','FIXED_ASSET','INVENTORY'].includes(classification))bad(`Line ${i+1}: invalid classification.`);if(classification==='INVENTORY')bad(`Line ${i+1}: Inventory expense posting is reserved for STEP 18.6 Inventory Accounting.`);
    const quantity=Number(x.quantity||1),unitPrice=Number(x.unit_price||0);if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unitPrice)||unitPrice<0)bad(`Line ${i+1}: invalid quantity or unit price.`);
    const account=am.get(clean(x.posting_account_id,80));if(!account||!['EXPENSE','ASSET'].includes(account.account_type))bad(`Line ${i+1}: choose an active Expense or Asset account.`);
    if(classification==='EXPENSE'&&account.account_type!=='EXPENSE')bad(`Line ${i+1}: EXPENSE classification requires an Expense account.`);
    if(classification==='PREPAID'&&!(account.account_type==='ASSET'&&(account.account_subtype==='PREPAID'||account.code==='1400')))bad(`Line ${i+1}: PREPAID classification requires the Prepaid Expenses account.`);
    if(classification==='FIXED_ASSET'&&!(account.account_type==='ASSET'&&(account.account_subtype==='FIXED_ASSET'||account.code==='1500')))bad(`Line ${i+1}: FIXED_ASSET classification requires the Fixed Asset account.`);
    const taxId=clean(x.tax_code_id,80)||null;let tax=null,taxAmount=0;if(taxId){tax=tm.get(taxId);if(!tax)bad(`Line ${i+1}: tax code is inactive or missing.`);const d=expenseDate||today();if(tax.effective_from&&d<tax.effective_from)bad(`Line ${i+1}: tax code ${tax.code} is not yet effective.`);if(tax.effective_to&&d>tax.effective_to)bad(`Line ${i+1}: tax code ${tax.code} is expired.`);}
    const eligibility=clean(x.itc_eligibility,20).toUpperCase()||'FULL';if(!['FULL','PARTIAL','NONE','MANUAL'].includes(eligibility))bad(`Line ${i+1}: invalid ITC eligibility.`);
    let percent=Number(x.recoverable_percent);if(!Number.isFinite(percent))percent=eligibility==='NONE'?0:100;if(eligibility==='FULL')percent=100;if(eligibility==='NONE')percent=0;if(percent<0||percent>100)bad(`Line ${i+1}: recoverable percent must be 0–100.`);
    const subtotal=money(quantity*unitPrice);if(tax){taxAmount=money(subtotal*(Number(tax.federal_rate||0)+Number(tax.provincial_rate||0))/100)}
    const recoverable=money(taxAmount*percent/100),nonrecoverable=money(taxAmount-recoverable);
    return{sort_order:i+1,description,classification,quantity,unit_price:unitPrice,posting_account_id:account.id,tax_code_id:taxId,itc_eligibility:eligibility,recoverable_percent:percent,line_subtotal:subtotal,tax_amount:taxAmount,recoverable_tax:recoverable,nonrecoverable_tax:nonrecoverable,line_total:money(subtotal+taxAmount)};
  });
}

async function saveExpense(auth,event,p){
  const expenseDate=clean(p.expense_date,10)||today(),lines=await normalizeLines(p.lines,expenseDate),mode=clean(p.payment_mode,30).toUpperCase()||'COMPANY_PAID';
  if(!['COMPANY_PAID','REIMBURSEMENT'].includes(mode))bad('Invalid payment mode.');
  const financialAccountId=clean(p.financial_account_id,80)||null;
  if(mode==='COMPANY_PAID'){if(!financialAccountId)bad('Company-paid expenses require a financial account.');const fa=await lib.sbJson(`/rest/v1/accounting_financial_accounts?select=id,financial_type,active&id=eq.${enc(financialAccountId)}&limit=1`);const row=Array.isArray(fa)?fa[0]:null;if(!row||row.active===false||!['BANK','CASH','CREDIT_CARD'].includes(String(row.financial_type||'').toUpperCase()))bad('Choose an active bank, cash, or credit-card account for a company-paid expense.');}
  const result=await lib.sbJson('/rest/v1/rpc/accounting_save_expense_claim',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_id:clean(p.id,80)||null,p_expense_date:expenseDate,p_posting_date:clean(p.posting_date,10)||expenseDate,p_vendor_party_id:clean(p.vendor_party_id,80)||null,p_payee_party_id:clean(p.payee_party_id,80)||null,p_payment_mode:mode,p_financial_account_id:financialAccountId,p_currency:(clean(p.currency,3)||'CAD').toUpperCase(),p_reference:clean(p.reference,160)||null,p_description:clean(p.description,1000),p_business_purpose:clean(p.business_purpose,1000)||null,p_department:clean(p.department,120)||null,p_project_reference:clean(p.project_reference,160)||null,p_receipt_waiver_reason:clean(p.receipt_waiver_reason,1000)||null,p_lines:lines,p_actor_id:String(auth.user.id)})});
  const id=String(rpcScalar(result)||'');if(!id)throw new Error('Expense save did not return an id.');await audit(auth,event,'accounting_expense_claims',id,'EXPENSE_SAVED',{payment_mode:mode,line_count:lines.length,expense_date:expenseDate});return id;
}
async function expenseAction(auth,event,p){const id=clean(p.id,80),action=clean(p.expense_action||p.action,30).toUpperCase();if(!id||!action)bad('Expense id and action are required.');const result=await lib.sbJson('/rest/v1/rpc/accounting_expense_claim_action',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_expense_id:id,p_action:action,p_actor_id:String(auth.user.id),p_reason:clean(p.reason,1000)||null})});const status=String(rpcScalar(result)||'');await audit(auth,event,'accounting_expense_claims',id,`EXPENSE_${action}`,{status,reason:p.reason||null});return status}
async function reimbursement(auth,event,p){const id=clean(p.expense_claim_id,80),fin=clean(p.financial_account_id,80),amount=money(p.amount);if(!id||!fin||amount<=0)bad('Expense, financial account and positive amount are required.');const fa=await lib.sbJson(`/rest/v1/accounting_financial_accounts?select=id,financial_type,active&id=eq.${enc(fin)}&limit=1`);const row=Array.isArray(fa)?fa[0]:null;if(!row||row.active===false||!['BANK','CASH','CREDIT_CARD'].includes(String(row.financial_type||'').toUpperCase()))bad('Choose an active bank, cash, or credit-card account for reimbursement.');const result=await lib.sbJson('/rest/v1/rpc/accounting_record_expense_reimbursement',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_expense_id:id,p_financial_account_id:fin,p_payment_date:clean(p.payment_date,10)||today(),p_amount:amount,p_method:clean(p.method,80)||null,p_reference:clean(p.reference,160)||null,p_notes:clean(p.notes,1000)||null,p_actor_id:String(auth.user.id)})});const rid=String(rpcScalar(result)||'');if(!rid)throw new Error('Reimbursement did not return an id.');await audit(auth,event,'accounting_expense_reimbursements',rid,'EXPENSE_REIMBURSEMENT_RECORDED',{expense_claim_id:id,amount,financial_account_id:fin});return rid}

exports.handler=async event=>{if(!['GET','POST'].includes(event.httpMethod))return lib.json(405,{error:'Method not allowed'});if(event.httpMethod==='POST'&&!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin.'});try{const auth=await lib.requireAdmin(event);if(event.httpMethod==='GET')return lib.json(200,{ok:true,data:await getData()});const b=bodyOf(event),action=String(b.action||'').toUpperCase(),p=b.payload||{};let result;if(action==='SAVE_EXPENSE')result={id:await saveExpense(auth,event,p)};else if(action==='EXPENSE_ACTION')result={status:await expenseAction(auth,event,p)};else if(action==='RECORD_REIMBURSEMENT')result={id:await reimbursement(auth,event,p)};else return lib.json(400,{error:'Unsupported Expenses action.'});return lib.json(200,{ok:true,result,data:await getData()});}catch(e){console.error('cal-expenses',e);return lib.json(e.status||500,{error:e.message||'Unable to process Expenses.'})}};
