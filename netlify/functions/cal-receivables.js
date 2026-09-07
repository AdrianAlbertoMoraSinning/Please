const lib=require('./_admin-lib');

const enc=v=>encodeURIComponent(String(v??''));
const clean=(v,n=1000)=>String(v??'').trim().slice(0,n);
const money=v=>Math.round((Number(v)||0)*100)/100;
const today=()=>new Date().toISOString().slice(0,10);
function bodyOf(event){try{return JSON.parse(event.body||'{}')}catch{const e=new Error('Invalid JSON body.');e.status=400;throw e}}
function bad(message,status=400){const e=new Error(message);e.status=status;throw e}
function rpcScalar(v){if(Array.isArray(v))v=v[0];if(v&&typeof v==='object'){const keys=Object.keys(v);if(keys.length===1)return v[keys[0]];}return v}

async function audit(auth,event,objectType,objectId,eventType,afterData){
  try{
    await lib.sbJson('/rest/v1/accounting_audit_log',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({
      actor_user_id:null,event_type:eventType,object_type:objectType,object_id:String(objectId||''),after_data:afterData||null,
      metadata:{step:'18.3',source:'CAL_RECEIVABLES_API',please_admin_user_id:auth.user.id,actor_email:auth.user.email,ip:lib.requestIp(event)||null,user_agent:lib.requestUserAgent(event)||null}
    })});
  }catch(e){console.warn('cal-receivables audit',e?.message||e);}
}

function partyName(p){return p?.display_name||p?.legal_name||p?.party_number||'Customer'}
function ageBucket(due,balance){
  if(!(balance>0))return 'CLOSED';
  const d=due||today(),days=Math.floor((new Date(today()+'T00:00:00Z')-new Date(d+'T00:00:00Z'))/86400000);
  return days<=0?'CURRENT':days<=30?'1-30':days<=60?'31-60':days<=90?'61-90':'90+';
}

async function getData(){
  const [parties,roles,accounts,taxCodes,financialAccounts,invoices,invoiceLines,payments,creditNotes,creditLines,refunds,outbox,company,operationalInvoices]=await Promise.all([
    lib.sbJson('/rest/v1/accounting_parties?select=id,party_number,legal_name,display_name,email,phone,address,business_number,tax_number,default_currency,active,source_system,source_table,source_record_id&active=eq.true&order=legal_name.asc'),
    lib.sbJson('/rest/v1/accounting_party_roles?select=party_id,role,active&role=eq.CUSTOMER&active=eq.true'),
    lib.sbJson('/rest/v1/accounting_accounts?select=id,code,name,account_type,active,system_managed&active=eq.true&order=code.asc'),
    lib.sbJson('/rest/v1/accounting_tax_codes?select=id,code,name,federal_rate,provincial_rate,tax_kind,province,effective_from,effective_to,active&active=eq.true&order=code.asc'),
    lib.sbJson('/rest/v1/accounting_financial_accounts?select=id,name,financial_type,institution_name,account_last4,currency,gl_account_id,is_primary,active&active=eq.true&order=is_primary.desc,name.asc'),
    lib.sbJson('/rest/v1/accounting_invoices?select=id,invoice_number,party_id,source_invoice_id,invoice_date,due_date,status,subtotal,tax_total,total,paid_total,currency,source_reference,created_at,updated_at&order=invoice_date.desc,created_at.desc&limit=1000'),
    lib.sbJson('/rest/v1/accounting_invoice_lines?select=id,invoice_id,description,quantity,unit_price,revenue_account_id,tax_code_id,line_subtotal,line_tax&order=invoice_id.asc,id.asc&limit=5000'),
    lib.sbJson('/rest/v1/accounting_payments?select=id,invoice_id,payment_date,amount,method,reference,bank_account_id,created_at&order=payment_date.desc,created_at.desc&limit=5000'),
    lib.sbJson('/rest/v1/accounting_credit_notes?select=*&order=credit_date.desc,created_at.desc&limit=1500'),
    lib.sbJson('/rest/v1/accounting_credit_note_lines?select=*&order=credit_note_id.asc,sort_order.asc,id.asc&limit=5000'),
    lib.sbJson('/rest/v1/accounting_customer_refunds?select=*&order=refund_date.desc,created_at.desc&limit=1500'),
    lib.sbJson('/rest/v1/please_accounting_outbox?select=id,event_type,source_record_id,source_reference,status,last_error,posted_at,processed_at,created_at&event_type=in.(CREDIT_NOTE_ISSUED,REFUND_COMPLETED)&order=created_at.desc&limit=3000'),
    lib.sbJson('/rest/v1/accounting_company?select=legal_name,operating_name,business_number,province,currency,gst_registered,sales_tax_account_number&limit=1'),
    lib.sbJson('/rest/v1/invoices?select=id,invoice_number,customer_id,client_name,client_email,invoice_date,due_date,status&order=invoice_date.desc&limit=1000').catch(()=>[])
  ]);
  const customerIds=new Set((roles||[]).map(r=>r.party_id));
  const customers=(parties||[]).filter(p=>customerIds.has(p.id));
  const partyMap=new Map((parties||[]).map(p=>[p.id,p]));
  const accountMap=new Map((accounts||[]).map(a=>[a.id,a]));
  const taxMap=new Map((taxCodes||[]).map(t=>[t.id,t]));
  const finMap=new Map((financialAccounts||[]).map(f=>[f.id,{...f,gl_account:accountMap.get(f.gl_account_id)||null}]));
  const opByNumber=new Map((operationalInvoices||[]).map(i=>[i.invoice_number,i]));
  const invoiceLineMap=new Map();for(const l of invoiceLines||[]){if(!invoiceLineMap.has(l.invoice_id))invoiceLineMap.set(l.invoice_id,[]);invoiceLineMap.get(l.invoice_id).push({...l,revenue_account:accountMap.get(l.revenue_account_id)||null,tax_code:taxMap.get(l.tax_code_id)||null});}
  const paymentMap=new Map();for(const p of payments||[]){if(!paymentMap.has(p.invoice_id))paymentMap.set(p.invoice_id,[]);paymentMap.get(p.invoice_id).push(p);}
  const noteLineMap=new Map();for(const l of creditLines||[]){if(!noteLineMap.has(l.credit_note_id))noteLineMap.set(l.credit_note_id,[]);noteLineMap.get(l.credit_note_id).push({...l,revenue_account:accountMap.get(l.revenue_account_id)||null,tax_code:taxMap.get(l.tax_code_id)||null});}
  const noteMapByInvoice=new Map();for(const n of creditNotes||[]){if(!noteMapByInvoice.has(n.invoice_id))noteMapByInvoice.set(n.invoice_id,[]);noteMapByInvoice.get(n.invoice_id).push(n);}
  const eventMap=new Map();for(const o of outbox||[]){const k=`${o.event_type}:${o.source_record_id}`;if(!eventMap.has(k))eventMap.set(k,o);}

  const normalizedInvoices=(invoices||[]).map(i=>{
    const pays=paymentMap.get(i.id)||[],notes=noteMapByInvoice.get(i.id)||[],postedNotes=notes.filter(n=>n.status==='POSTED');
    const paid=money(pays.reduce((n,p)=>n+Number(p.amount||0),0)),credited=money(postedNotes.reduce((n,x)=>n+Number(x.total||0),0));
    const creditSub=money(postedNotes.reduce((n,x)=>n+Number(x.subtotal_reduction||0),0)),creditTax=money(postedNotes.reduce((n,x)=>n+Number(x.tax_reduction||0),0));
    const raw=money(Number(i.total||0)-paid-credited),balance=Math.max(0,raw),creditGenerated=Math.max(0,-raw),aging=ageBucket(i.due_date||i.invoice_date,balance);
    const op=opByNumber.get(i.invoice_number)||{},customer=partyMap.get(i.party_id)||null;
    let arStatus=i.status==='VOID'?'VOID':balance>0?(paid+credited>0?'PARTIAL':'OPEN'):(credited>0?(credited+0.001>=Number(i.total||0)&&paid===0?'CREDITED':'SETTLED'):'PAID');
    return{...i,customer,customer_name:partyName(customer)||op.client_name||i.source_reference||i.invoice_number,customer_email:customer?.email||op.client_email||'',paid,credited,balance_due:money(balance),credit_generated:money(creditGenerated),aging_bucket:aging,ar_status:arStatus,
      remaining_creditable_subtotal:money(Math.max(0,Number(i.subtotal||0)-creditSub)),remaining_creditable_tax:money(Math.max(0,Number(i.tax_total||0)-creditTax)),remaining_creditable_total:money(Math.max(0,Number(i.total||0)-credited)),
      lines:invoiceLineMap.get(i.id)||[],payments:pays,credit_notes:notes};
  });
  const invoiceMap=new Map(normalizedInvoices.map(i=>[i.id,i]));
  const normalizedNotes=(creditNotes||[]).map(n=>({...n,invoice:invoiceMap.get(n.invoice_id)||null,customer:partyMap.get(n.customer_party_id)||null,lines:noteLineMap.get(n.id)||[],accounting_event:eventMap.get(`CREDIT_NOTE_ISSUED:${n.id}`)||null}));
  const noteMap=new Map(normalizedNotes.map(n=>[n.id,n]));
  const normalizedRefunds=(refunds||[]).map(r=>({...r,customer:partyMap.get(r.customer_party_id)||null,credit_note:noteMap.get(r.credit_note_id)||null,financial_account:finMap.get(r.financial_account_id)||null,accounting_event:eventMap.get(`REFUND_COMPLETED:${r.id}`)||null}));

  const partyAgg=new Map();
  for(const p of customers)partyAgg.set(p.id,{party:p,invoices:0,payments:0,credits:0,refunds:0,net:0,available_credit:0});
  for(const i of normalizedInvoices){if(!i.party_id||i.status==='VOID')continue;const a=partyAgg.get(i.party_id)||{party:partyMap.get(i.party_id),invoices:0,payments:0,credits:0,refunds:0,net:0,available_credit:0};a.invoices=money(a.invoices+Number(i.total||0));a.payments=money(a.payments+Number(i.paid||0));a.credits=money(a.credits+Number(i.credited||0));partyAgg.set(i.party_id,a);}
  for(const r of normalizedRefunds){const a=partyAgg.get(r.customer_party_id);if(a)a.refunds=money(a.refunds+Number(r.amount||0));}
  for(const a of partyAgg.values()){a.net=money(a.invoices-a.payments-a.credits+a.refunds);a.available_credit=money(Math.max(0,-a.net));}
  const customerCredits=[...partyAgg.values()].filter(a=>a.available_credit>0.001).sort((a,b)=>b.available_credit-a.available_credit);
  const openInvoices=normalizedInvoices.filter(i=>i.balance_due>0&&i.status!=='VOID');
  const aging={CURRENT:0,'1-30':0,'31-60':0,'61-90':0,'90+':0};for(const i of openInvoices)aging[i.aging_bucket]=money((aging[i.aging_bucket]||0)+i.balance_due);
  const counts={
    openAR:money(openInvoices.reduce((n,i)=>n+i.balance_due,0)),
    overdueAR:money(openInvoices.filter(i=>i.aging_bucket!=='CURRENT').reduce((n,i)=>n+i.balance_due,0)),
    customerCredits:money(customerCredits.reduce((n,a)=>n+a.available_credit,0)),
    postedCreditNotes:normalizedNotes.filter(n=>n.status==='POSTED').length,
    pendingCreditNotes:normalizedNotes.filter(n=>['SUBMITTED','APPROVED'].includes(n.status)).length,
    refunds:money(normalizedRefunds.reduce((n,r)=>n+Number(r.amount||0),0))
  };
  return{company:company?.[0]||{},invoices:normalizedInvoices,creditNotes:normalizedNotes,refunds:normalizedRefunds,customers,customerCredits,accounts:(accounts||[]).filter(a=>a.account_type==='REVENUE'),taxCodes:taxCodes||[],financialAccounts:[...finMap.values()],counts,aging};
}

async function normalizeCreditLines(rawLines,invoiceId,adjustTax){
  const lines=Array.isArray(rawLines)?rawLines:[];if(!lines.length)bad('At least one credit note line is required.');if(lines.length>100)bad('A credit note cannot exceed 100 lines.');
  const [invoiceRows,accounts,taxes]=await Promise.all([
    lib.sbJson(`/rest/v1/accounting_invoices?id=eq.${enc(invoiceId)}&select=id,invoice_date&limit=1`),
    lib.sbJson('/rest/v1/accounting_accounts?select=id,code,name,account_type,active&active=eq.true'),
    lib.sbJson('/rest/v1/accounting_tax_codes?select=id,code,name,federal_rate,provincial_rate,tax_kind,effective_from,effective_to,active&active=eq.true')
  ]);
  const inv=invoiceRows?.[0];if(!inv)bad('Accounting invoice not found.',404);
  const am=new Map((accounts||[]).map(x=>[x.id,x])),tm=new Map((taxes||[]).map(x=>[x.id,x]));
  return lines.map((x,i)=>{
    const description=clean(x.description,500);if(!description)bad(`Line ${i+1}: description is required.`);
    const quantity=Number(x.quantity||1),unitPrice=Number(x.unit_price||0);if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unitPrice)||unitPrice<0)bad(`Line ${i+1}: invalid quantity or unit price.`);
    const account=am.get(clean(x.revenue_account_id,80));if(!account||account.account_type!=='REVENUE')bad(`Line ${i+1}: choose an active Revenue account.`);
    const taxId=clean(x.tax_code_id,80)||null;let tax=null;
    if(adjustTax&&taxId){tax=tm.get(taxId);if(!tax)bad(`Line ${i+1}: tax code is inactive or missing.`);if(tax.effective_from&&inv.invoice_date<tax.effective_from)bad(`Line ${i+1}: ${tax.code} was not effective on the invoice date.`);if(tax.effective_to&&inv.invoice_date>tax.effective_to)bad(`Line ${i+1}: ${tax.code} had expired on the invoice date.`);}
    let override=x.tax_amount_override==null||x.tax_amount_override===''?null:Number(x.tax_amount_override);if(override!=null&&(!Number.isFinite(override)||override<0))bad(`Line ${i+1}: invalid tax override.`);
    return{sort_order:i+1,original_invoice_line_id:clean(x.original_invoice_line_id,80)||null,description,quantity,unit_price:unitPrice,revenue_account_id:account.id,tax_code_id:adjustTax?taxId:null,tax_amount_override:adjustTax?override:null};
  });
}

async function saveCreditNote(auth,event,payload){
  const invoiceId=clean(payload.invoice_id,80);if(!invoiceId)bad('Invoice is required.');
  const adjustTax=payload.tax_adjustment_included!==false&&String(payload.tax_adjustment_included)!=='false';
  const lines=await normalizeCreditLines(payload.lines,invoiceId,adjustTax);
  const result=await lib.sbJson('/rest/v1/rpc/accounting_save_credit_note',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({
    p_id:clean(payload.id,80)||null,p_invoice_id:invoiceId,p_credit_date:clean(payload.credit_date,10)||today(),p_reason_code:clean(payload.reason_code,40)||'OTHER',p_reason:clean(payload.reason,1000),p_tax_adjustment_included:adjustTax,p_source_reference:clean(payload.source_reference,240)||null,p_lines:lines,p_actor_id:String(auth.user.id)
  })});
  const id=String(rpcScalar(result)||'');if(!id)throw new Error('Credit note save did not return an id.');
  await audit(auth,event,'accounting_credit_notes',id,'CREDIT_NOTE_SAVED',{invoice_id:invoiceId,reason_code:payload.reason_code,line_count:lines.length,tax_adjustment_included:adjustTax});
  return id;
}
async function creditAction(auth,event,payload){
  const id=clean(payload.id,80),action=clean(payload.credit_action||payload.action,40).toUpperCase();if(!id||!action)bad('Credit note id and action are required.');
  const result=await lib.sbJson('/rest/v1/rpc/accounting_credit_note_action',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_credit_note_id:id,p_action:action,p_actor_id:String(auth.user.id)})});
  const status=String(rpcScalar(result)||'');await audit(auth,event,'accounting_credit_notes',id,`CREDIT_NOTE_${action}`,{status});return status;
}
async function recordRefund(auth,event,payload){
  const partyId=clean(payload.customer_party_id,80),finId=clean(payload.financial_account_id,80),amount=money(payload.amount);if(!partyId||!finId||amount<=0)bad('Customer, financial account and positive refund amount are required.');
  const result=await lib.sbJson('/rest/v1/rpc/accounting_record_customer_refund',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({
    p_customer_party_id:partyId,p_credit_note_id:clean(payload.credit_note_id,80)||null,p_financial_account_id:finId,p_refund_date:clean(payload.refund_date,10)||today(),p_amount:amount,p_method:clean(payload.method,80)||null,p_reference:clean(payload.reference,160)||null,p_notes:clean(payload.notes,1000)||null,p_actor_id:String(auth.user.id)
  })});
  const id=String(rpcScalar(result)||'');if(!id)throw new Error('Customer refund did not return an id.');
  await audit(auth,event,'accounting_customer_refunds',id,'CUSTOMER_REFUND_RECORDED',{customer_party_id:partyId,credit_note_id:payload.credit_note_id||null,amount,financial_account_id:finId});return id;
}

exports.handler=async event=>{
  if(!['GET','POST'].includes(event.httpMethod))return lib.json(405,{error:'Method not allowed'});
  if(event.httpMethod==='POST'&&!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin.'});
  try{
    const auth=await lib.requireAdmin(event);
    if(event.httpMethod==='GET')return lib.json(200,{ok:true,data:await getData()});
    const b=bodyOf(event),action=String(b.action||'').toUpperCase(),payload=b.payload||{};let result=null;
    if(action==='SAVE_CREDIT_NOTE')result={id:await saveCreditNote(auth,event,payload)};
    else if(action==='CREDIT_NOTE_ACTION')result={status:await creditAction(auth,event,payload)};
    else if(action==='RECORD_REFUND')result={id:await recordRefund(auth,event,payload)};
    else return lib.json(400,{error:'Unsupported Accounts Receivable action.'});
    return lib.json(200,{ok:true,result,data:await getData()});
  }catch(e){console.error('cal-receivables',e);return lib.json(e.status||500,{error:e.message||'Unable to process Accounts Receivable.'});}
};
