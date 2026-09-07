const lib=require('./_admin-lib');

const enc=v=>encodeURIComponent(String(v??''));
const clean=(v,n=1000)=>String(v??'').trim().slice(0,n);
const money=v=>Math.round((Number(v)||0)*100)/100;
function bodyOf(event){try{return JSON.parse(event.body||'{}')}catch{const e=new Error('Invalid JSON body.');e.status=400;throw e}}
function bad(message,status=400){const e=new Error(message);e.status=status;throw e}
function rpcScalar(v){if(Array.isArray(v))v=v[0];if(v&&typeof v==='object'){const keys=Object.keys(v);if(keys.length===1)return v[keys[0]];}return v}
function inList(ids){return `(${ids.map(x=>String(x).replace(/[(),]/g,'')).join(',')})`}

async function audit(auth,event,objectType,objectId,eventType,afterData){
  try{
    await lib.sbJson('/rest/v1/accounting_audit_log',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({
      actor_user_id:null,event_type:eventType,object_type:objectType,object_id:String(objectId||''),after_data:afterData||null,
      metadata:{step:'18.2',source:'CAL_PURCHASES_API',please_admin_user_id:auth.user.id,actor_email:auth.user.email,ip:lib.requestIp(event)||null,user_agent:lib.requestUserAgent(event)||null}
    })});
  }catch(e){console.warn('cal-purchases audit',e?.message||e);}
}

async function getData(){
  const [parties,roles,accounts,taxCodes,financialAccounts,bills,lines,payments]=await Promise.all([
    lib.sbJson('/rest/v1/accounting_parties?select=id,party_number,legal_name,display_name,email,phone,default_currency,payment_terms_days,active,source_system,source_table&active=eq.true&order=legal_name.asc'),
    lib.sbJson('/rest/v1/accounting_party_roles?select=party_id,role,active&role=eq.SUPPLIER&active=eq.true'),
    lib.sbJson('/rest/v1/accounting_accounts?select=id,code,name,account_type,active,system_managed&active=eq.true&order=code.asc'),
    lib.sbJson('/rest/v1/accounting_tax_codes?select=id,code,name,federal_rate,provincial_rate,tax_kind,province,recoverable_default,effective_from,effective_to,active&active=eq.true&order=code.asc'),
    lib.sbJson('/rest/v1/accounting_financial_accounts?select=id,name,financial_type,institution_name,account_last4,currency,gl_account_id,is_primary,active&active=eq.true&order=is_primary.desc,name.asc'),
    lib.sbJson('/rest/v1/accounting_supplier_bills?select=*&order=bill_date.desc,created_at.desc&limit=500'),
    lib.sbJson('/rest/v1/accounting_supplier_bill_lines?select=*&order=supplier_bill_id.asc,sort_order.asc,id.asc&limit=3000'),
    lib.sbJson('/rest/v1/accounting_supplier_payments?select=*&order=payment_date.desc,created_at.desc&limit=1500')
  ]);
  const supplierIds=new Set((roles||[]).map(r=>r.party_id));
  const suppliers=(parties||[]).filter(p=>supplierIds.has(p.id));
  const partyMap=new Map((parties||[]).map(p=>[p.id,p]));
  const accountMap=new Map((accounts||[]).map(a=>[a.id,a]));
  const taxMap=new Map((taxCodes||[]).map(t=>[t.id,t]));
  const finMap=new Map((financialAccounts||[]).map(f=>[f.id,{...f,gl_account:accountMap.get(f.gl_account_id)||null}]));
  const lineMap=new Map();for(const l of lines||[]){if(!lineMap.has(l.supplier_bill_id))lineMap.set(l.supplier_bill_id,[]);lineMap.get(l.supplier_bill_id).push({...l,posting_account:accountMap.get(l.posting_account_id)||null,tax_code:taxMap.get(l.tax_code_id)||null});}
  const payMap=new Map();for(const p of payments||[]){if(!payMap.has(p.supplier_bill_id))payMap.set(p.supplier_bill_id,[]);payMap.get(p.supplier_bill_id).push({...p,financial_account:finMap.get(p.financial_account_id)||null});}
  const today=new Date().toISOString().slice(0,10);
  const normalized=(bills||[]).map(b=>{
    const balance=money(Number(b.total||0)-Number(b.amount_paid||0));
    let aging='CLOSED';
    if(balance>0&&['POSTED','PARTIAL'].includes(b.status)){
      const due=b.due_date||b.bill_date;const days=Math.floor((new Date(today+'T00:00:00Z')-new Date(due+'T00:00:00Z'))/86400000);
      aging=days<=0?'CURRENT':days<=30?'1-30':days<=60?'31-60':days<=90?'61-90':'90+';
    }
    return{...b,balance_due:balance,aging_bucket:aging,supplier:partyMap.get(b.supplier_party_id)||null,lines:lineMap.get(b.id)||[],payments:payMap.get(b.id)||[]};
  });
  const postedOpen=normalized.filter(b=>b.balance_due>0&&['POSTED','PARTIAL'].includes(b.status));
  const counts={
    suppliers:suppliers.length,
    draft:normalized.filter(b=>b.status==='DRAFT').length,
    awaitingApproval:normalized.filter(b=>['SUBMITTED','APPROVED'].includes(b.status)).length,
    openBills:postedOpen.length,
    openAP:money(postedOpen.reduce((n,b)=>n+b.balance_due,0)),
    overdueAP:money(postedOpen.filter(b=>['1-30','31-60','61-90','90+'].includes(b.aging_bucket)).reduce((n,b)=>n+b.balance_due,0))
  };
  const aging={CURRENT:0,'1-30':0,'31-60':0,'61-90':0,'90+':0};for(const b of postedOpen)aging[b.aging_bucket]=money((aging[b.aging_bucket]||0)+b.balance_due);
  return{bills:normalized,suppliers,accounts:(accounts||[]).filter(a=>['EXPENSE','ASSET'].includes(a.account_type)),taxCodes:taxCodes||[],financialAccounts:[...finMap.values()],counts,aging};
}

async function normalizeLines(rawLines,billDate){
  const lines=Array.isArray(rawLines)?rawLines:[];if(!lines.length)bad('At least one purchase line is required.');if(lines.length>100)bad('A supplier bill cannot exceed 100 lines.');
  const [accounts,taxes]=await Promise.all([
    lib.sbJson('/rest/v1/accounting_accounts?select=id,code,name,account_type,active&active=eq.true'),
    lib.sbJson('/rest/v1/accounting_tax_codes?select=id,code,name,federal_rate,provincial_rate,tax_kind,recoverable_default,effective_from,effective_to,active&active=eq.true')
  ]);
  const am=new Map((accounts||[]).map(x=>[x.id,x])),tm=new Map((taxes||[]).map(x=>[x.id,x]));
  return lines.map((x,i)=>{
    const description=clean(x.description,500);if(!description)bad(`Line ${i+1}: description is required.`);
    const quantity=Number(x.quantity||1),unitPrice=Number(x.unit_price||0);if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unitPrice)||unitPrice<0)bad(`Line ${i+1}: invalid quantity or unit price.`);
    const account=am.get(clean(x.posting_account_id,80));if(!account||!['EXPENSE','ASSET'].includes(account.account_type))bad(`Line ${i+1}: choose an active Expense or Asset account.`);
    let tax=null,taxAmount=0,recoverable=0;const taxId=clean(x.tax_code_id,80)||null;
    if(taxId){tax=tm.get(taxId);if(!tax)bad(`Line ${i+1}: tax code is inactive or missing.`);const d=billDate||new Date().toISOString().slice(0,10);if(tax.effective_from&&d<tax.effective_from)bad(`Line ${i+1}: tax code ${tax.code} is not yet effective.`);if(tax.effective_to&&d>tax.effective_to)bad(`Line ${i+1}: tax code ${tax.code} is expired.`);}
    const subtotal=money(quantity*unitPrice);if(tax){const rate=Number(tax.federal_rate||0)+Number(tax.provincial_rate||0);taxAmount=money(subtotal*rate/100);recoverable=tax.recoverable_default===false?0:taxAmount;}
    return{sort_order:i+1,description,quantity,unit_price:unitPrice,posting_account_id:account.id,tax_code_id:taxId,line_subtotal:subtotal,tax_amount:taxAmount,recoverable_tax:recoverable,line_total:money(subtotal+taxAmount)};
  });
}

async function saveBill(auth,event,payload){
  const supplierId=clean(payload.supplier_party_id,80);if(!supplierId)bad('Supplier is required.');
  const billDate=clean(payload.bill_date,10)||new Date().toISOString().slice(0,10);
  let dueDate=clean(payload.due_date,10)||null;
  if(!dueDate){const p=(await lib.sbJson(`/rest/v1/accounting_parties?id=eq.${enc(supplierId)}&select=payment_terms_days&limit=1`))?.[0];const d=new Date(billDate+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+Math.max(0,Number(p?.payment_terms_days||0)));dueDate=d.toISOString().slice(0,10);}
  const lines=await normalizeLines(payload.lines,billDate);
  const result=await lib.sbJson('/rest/v1/rpc/accounting_save_supplier_bill',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({
    p_id:clean(payload.id,80)||null,p_supplier_party_id:supplierId,p_supplier_invoice_number:clean(payload.supplier_invoice_number,120)||null,p_bill_date:billDate,p_due_date:dueDate,p_currency:(clean(payload.currency,3)||'CAD').toUpperCase(),p_notes:clean(payload.notes,2000)||null,p_source_reference:clean(payload.source_reference,240)||null,p_lines:lines,p_actor_id:String(auth.user.id)
  })});
  const id=String(rpcScalar(result)||'');if(!id)throw new Error('Supplier bill save did not return an id.');
  await audit(auth,event,'accounting_supplier_bills',id,'SUPPLIER_BILL_SAVED',{supplier_party_id:supplierId,bill_date:billDate,due_date:dueDate,line_count:lines.length});
  return id;
}
async function billAction(auth,event,payload){
  const id=clean(payload.id,80),action=clean(payload.bill_action||payload.action,40).toUpperCase();if(!id||!action)bad('Bill id and action are required.');
  const result=await lib.sbJson('/rest/v1/rpc/accounting_supplier_bill_action',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_bill_id:id,p_action:action,p_actor_id:String(auth.user.id)})});
  const status=String(rpcScalar(result)||'');await audit(auth,event,'accounting_supplier_bills',id,`SUPPLIER_BILL_${action}`,{status});return status;
}
async function recordPayment(auth,event,payload){
  const billId=clean(payload.supplier_bill_id,80),finId=clean(payload.financial_account_id,80),amount=money(payload.amount);if(!billId||!finId||amount<=0)bad('Bill, financial account and positive payment amount are required.');
  const result=await lib.sbJson('/rest/v1/rpc/accounting_record_supplier_payment',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_bill_id:billId,p_financial_account_id:finId,p_payment_date:clean(payload.payment_date,10)||new Date().toISOString().slice(0,10),p_amount:amount,p_method:clean(payload.method,80)||null,p_reference:clean(payload.reference,160)||null,p_notes:clean(payload.notes,1000)||null,p_actor_id:String(auth.user.id)})});
  const id=String(rpcScalar(result)||'');if(!id)throw new Error('Supplier payment did not return an id.');await audit(auth,event,'accounting_supplier_payments',id,'SUPPLIER_PAYMENT_RECORDED',{supplier_bill_id:billId,amount,financial_account_id:finId});return id;
}

exports.handler=async event=>{
  if(!['GET','POST'].includes(event.httpMethod))return lib.json(405,{error:'Method not allowed'});
  if(event.httpMethod==='POST'&&!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin.'});
  try{
    const auth=await lib.requireAdmin(event);
    if(event.httpMethod==='GET')return lib.json(200,{ok:true,data:await getData()});
    const b=bodyOf(event),action=String(b.action||'').toUpperCase(),payload=b.payload||{};let result=null;
    if(action==='SAVE_BILL')result={id:await saveBill(auth,event,payload)};
    else if(action==='BILL_ACTION')result={status:await billAction(auth,event,payload)};
    else if(action==='RECORD_PAYMENT')result={id:await recordPayment(auth,event,payload)};
    else return lib.json(400,{error:'Unsupported Purchases/AP action.'});
    return lib.json(200,{ok:true,result,data:await getData()});
  }catch(e){console.error('cal-purchases',e);return lib.json(e.status||500,{error:e.message||'Unable to process Purchases / Accounts Payable.'});}
};
