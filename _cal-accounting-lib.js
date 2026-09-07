const crypto=require('crypto');
const lib=require('./_admin-lib');

const SOURCE_SYSTEM='PLEASE';
const MONEY=n=>Math.round((Number(n)||0)*100)/100;
const enc=v=>encodeURIComponent(String(v??''));
const today=()=>new Date().toISOString().slice(0,10);
const clean=(v,n=1000)=>String(v??'').trim().slice(0,n);

function enabled(){return !['false','0','off','no'].includes(String(process.env.CAL_INTEGRATION_ENABLED||process.env.CAL_ACCOUNTING_ENABLED||'true').toLowerCase());}
function schemaMissing(e){const m=String(e?.message||e||'').toLowerCase();return e?.status===404||m.includes('could not find')||m.includes('schema cache')||m.includes('does not exist')||m.includes('relation');}
function hashPayload(payload){return crypto.createHash('sha256').update(JSON.stringify(payload||{})).digest('hex');}
function eventId(type,sourceRecordId,extra=''){return `${SOURCE_SYSTEM}:${type}:${sourceRecordId||'none'}${extra?':'+extra:''}`;}
function journalNo(){return `CAL-JE-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;}

async function safeSb(path,options={}){return lib.sbJson(path,options);}
async function safeOutbox(payload){
  try{
    const key=payload.event_key;
    const rows=await safeSb(`/rest/v1/please_accounting_outbox?event_key=eq.${enc(key)}&select=id,status&limit=1`);
    const body={
      event_key:key,event_type:payload.event_type,source_table:payload.source_table||null,source_record_id:payload.source_record_id||null,
      source_reference:payload.source_reference||null,occurred_at:payload.occurred_at||new Date().toISOString(),payload_json:payload.payload_json||{},
      payload_hash:hashPayload(payload.payload_json||{}),status:payload.status||'PENDING',last_error:payload.last_error||null,updated_at:new Date().toISOString()
    };
    if(rows?.[0]){
      await safeSb(`/rest/v1/please_accounting_outbox?id=eq.${enc(rows[0].id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});
      return rows[0].id;
    }
    const created=await safeSb('/rest/v1/please_accounting_outbox',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(body)});
    return created?.[0]?.id||null;
  }catch(e){
    if(!schemaMissing(e))console.warn('cal-outbox',e?.message||e);
    return null;
  }
}
async function updateOutbox(eventKey,patch){
  try{await safeSb(`/rest/v1/please_accounting_outbox?event_key=eq.${enc(eventKey)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({...patch,updated_at:new Date().toISOString()})});}catch(e){if(!schemaMissing(e))console.warn('cal-outbox-update',e?.message||e);}
}
async function account(code,name,type){
  const rows=await safeSb(`/rest/v1/accounting_accounts?code=eq.${enc(code)}&select=id,code&limit=1`);
  if(rows?.[0])return rows[0].id;
  const created=await safeSb('/rest/v1/accounting_accounts',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({code,name,account_type:type,active:true})});
  return created?.[0]?.id;
}
async function ensureAccounts(){
  const defs=[
    ['1000','Operating Bank','ASSET'],['1090','Stripe Clearing / Undeposited Funds','ASSET'],['1100','Accounts Receivable','ASSET'],['1200','GST/HST Recoverable','ASSET'],['1300','Provider Advances','ASSET'],
    ['2000','Accounts Payable','LIABILITY'],['2010','Provider Payable','LIABILITY'],['2100','GST/HST Payable','LIABILITY'],['3000','Owner Equity / Retained Earnings','EQUITY'],
    ['4000','Service Revenue','REVENUE'],['5000','Subcontractors Expense','EXPENSE'],['5400','Office & Software','EXPENSE'],['5700','Merchant / Bank Fees','EXPENSE']
  ];
  const out={};
  for(const [code,name,type] of defs)out[code]=await account(code,name,type);
  return out;
}
async function external(sourceEventId){
  const rows=await safeSb(`/rest/v1/accounting_external_events?source_system=eq.${SOURCE_SYSTEM}&source_event_id=eq.${enc(sourceEventId)}&select=*&limit=1`);
  return rows?.[0]||null;
}
async function createExternal(payload){
  const created=await safeSb('/rest/v1/accounting_external_events',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(payload)});
  return created?.[0]||null;
}
async function updateExternal(id,patch){
  if(!id)return;
  await safeSb(`/rest/v1/accounting_external_events?id=eq.${enc(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({...patch,processed_at:new Date().toISOString()})});
}
async function postJournal(eventRow,{entryDate,memo,lines}){
  const ids=await ensureAccounts();
  const normalized=(lines||[]).map(l=>({
    account_id:ids[l.code],code:l.code,description:clean(l.description||memo,500),debit:MONEY(l.debit),credit:MONEY(l.credit)
  })).filter(l=>l.account_id&&(l.debit>0||l.credit>0));
  const debits=MONEY(normalized.reduce((n,l)=>n+l.debit,0));
  const credits=MONEY(normalized.reduce((n,l)=>n+l.credit,0));
  if(!normalized.length)return null;
  if(Math.abs(debits-credits)>0.001)throw new Error(`Accounting entry is out of balance: debits ${debits.toFixed(2)} / credits ${credits.toFixed(2)}.`);
  const existing=await safeSb(`/rest/v1/accounting_journal_entries?source_type=eq.PLEASE_EVENT&source_id=eq.${enc(eventRow.id)}&select=id,status&limit=1`).catch(()=>[]);
  if(existing?.[0])return existing[0].id;
  const entry=await safeSb('/rest/v1/accounting_journal_entries',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({
    entry_number:journalNo(),entry_date:entryDate||today(),memo:clean(memo,500),source_type:'PLEASE_EVENT',source_id:eventRow.id,status:'DRAFT'
  })});
  const je=entry?.[0];
  if(!je?.id)throw new Error('Accounting journal entry was not created.');
  await safeSb('/rest/v1/accounting_journal_lines',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(normalized.map(l=>({journal_entry_id:je.id,account_id:l.account_id,debit:l.debit,credit:l.credit,description:l.description})))});
  await safeSb(`/rest/v1/accounting_journal_entries?id=eq.${enc(je.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'POSTED',posted_at:new Date().toISOString()})});
  return je.id;
}
async function postEvent({type,sourceTable,sourceRecordId,sourceReference,occurredAt,payload,entryDate,memo,lines}){
  if(!enabled())return{ok:false,skipped:true,reason:'CAL integration disabled'};
  const source_event_id=eventId(type,sourceRecordId);
  const payload_hash=hashPayload(payload);
  await safeOutbox({event_key:source_event_id,event_type:type,source_table:sourceTable,source_record_id:sourceRecordId,source_reference:sourceReference,occurred_at:occurredAt,payload_json:payload,status:'PENDING'});
  try{
    let evt=await external(source_event_id);
    if(evt?.posting_status==='POSTED'&&evt?.journal_entry_id){
      await updateOutbox(source_event_id,{status:'POSTED',cal_event_id:evt.id,cal_journal_entry_id:evt.journal_entry_id,last_error:null});
      return{ok:true,duplicate:true,event_id:evt.id,journal_entry_id:evt.journal_entry_id};
    }
    if(!evt){
      evt=await createExternal({source_system:SOURCE_SYSTEM,source_event_id,event_type:type,event_version:1,source_table:sourceTable||null,source_record_id:sourceRecordId||null,source_reference:sourceReference||null,occurred_at:occurredAt||new Date().toISOString(),payload_json:payload||{},payload_hash,posting_status:'PENDING'});
    }
    if(!evt?.id)throw new Error('Accounting external event was not created.');
    let journal_entry_id=null;
    if(lines?.length)journal_entry_id=await postJournal(evt,{entryDate,memo,lines});
    await updateExternal(evt.id,{posting_status:journal_entry_id?'POSTED':'IGNORED',journal_entry_id,error_message:null});
    await updateOutbox(source_event_id,{status:journal_entry_id?'POSTED':'IGNORED',cal_event_id:evt.id,cal_journal_entry_id:journal_entry_id,last_error:null,posted_at:new Date().toISOString()});
    return{ok:true,event_id:evt.id,journal_entry_id};
  }catch(e){
    await updateOutbox(source_event_id,{status:'ERROR',last_error:clean(e.message||e,1000)});
    try{const evt=await external(source_event_id); if(evt?.id)await updateExternal(evt.id,{posting_status:'ERROR',error_message:clean(e.message||e,1000)});}catch{}
    if(!schemaMissing(e))console.error('cal-post-event',type,sourceReference,e);
    return{ok:false,error:e.message||String(e),schema_missing:schemaMissing(e)};
  }
}
async function invoice(id){
  const rows=await safeSb(`/rest/v1/invoices?select=id,invoice_number,job_id,customer_id,client_name,client_email,client_phone,invoice_date,due_date,subtotal,gst_rate,gst_amount,total_amount,currency,amount_paid,status,payment_status,payment_method,payment_reference,stripe_checkout_session_id,stripe_payment_intent_id,issued_at,sent_at,paid_at,voided_at,void_reason,created_at,updated_at&id=eq.${enc(id)}&limit=1`);
  return rows?.[0]||null;
}
async function invoiceItems(id){
  return await safeSb(`/rest/v1/invoice_items?select=id,description,qty,unit,unit_rate,line_total,sort_order&invoice_id=eq.${enc(id)}&order=sort_order.asc,id.asc`).catch(()=>[]);
}
async function syncAccountingInvoice(inv,items=[]){
  try{
    const existing=await safeSb(`/rest/v1/accounting_invoices?invoice_number=eq.${enc(inv.invoice_number)}&select=id&limit=1`);
    const body={invoice_number:inv.invoice_number,invoice_date:inv.invoice_date||today(),due_date:inv.due_date||null,status:inv.status==='ISSUED'?'SENT':inv.status,subtotal:MONEY(inv.subtotal),tax_total:MONEY(inv.gst_amount),total:MONEY(inv.total_amount),paid_total:MONEY(inv.amount_paid),currency:inv.currency||'CAD',source_reference:inv.invoice_number,notes:`Imported from PLEASE invoice ${inv.invoice_number}`};
    let accountingInvoiceId=existing?.[0]?.id;
    if(accountingInvoiceId){
      await safeSb(`/rest/v1/accounting_invoices?id=eq.${enc(accountingInvoiceId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});
      await safeSb(`/rest/v1/accounting_invoice_lines?invoice_id=eq.${enc(accountingInvoiceId)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}}).catch(()=>{});
    }else{
      const created=await safeSb('/rest/v1/accounting_invoices',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(body)});
      accountingInvoiceId=created?.[0]?.id;
    }
    if(accountingInvoiceId&&items?.length){
      const accounts=await ensureAccounts();
      await safeSb('/rest/v1/accounting_invoice_lines',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(items.map(x=>({invoice_id:accountingInvoiceId,description:x.description||'PLEASE service',quantity:Number(x.qty)||1,unit_price:Number(x.unit_rate)||0,revenue_account_id:accounts['4000'],line_subtotal:MONEY(x.line_total),line_tax:0})))}).catch(e=>console.warn('cal-invoice-lines',e.message));
    }
  }catch(e){if(!schemaMissing(e))console.warn('cal-sync-invoice',e?.message||e);}
}
async function syncAccountingPayment(inv,tx){
  try{
    const ai=await safeSb(`/rest/v1/accounting_invoices?invoice_number=eq.${enc(inv.invoice_number)}&select=id,paid_total&limit=1`);
    const accountingInvoiceId=ai?.[0]?.id||null;
    const ref=`PLEASE-PAYMENT-${tx.id}`;
    const existing=await safeSb(`/rest/v1/accounting_payments?reference=eq.${enc(ref)}&select=id&limit=1`).catch(()=>[]);
    if(!existing?.[0]){
      await safeSb('/rest/v1/accounting_payments',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({invoice_id:accountingInvoiceId,payment_date:(tx.created_at||inv.paid_at||new Date().toISOString()).slice(0,10),amount:MONEY(tx.amount),method:tx.provider||inv.payment_method||'MANUAL',reference:ref})});
      if(accountingInvoiceId){
        const paid=MONEY(Number(ai?.[0]?.paid_total||0)+Number(tx.amount||0));
        const status=paid+0.001>=Number(inv.total_amount||0)?'PAID':inv.status;
        await safeSb(`/rest/v1/accounting_invoices?id=eq.${enc(accountingInvoiceId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({paid_total:paid,status})}).catch(()=>{});
      }
    }
  }catch(e){if(!schemaMissing(e))console.warn('cal-sync-payment',e?.message||e);}
}
async function paymentTx(id){
  const rows=await safeSb(`/rest/v1/payment_transactions?select=id,invoice_id,amount,currency,provider,status,external_reference,stripe_checkout_session_id,stripe_payment_intent_id,stripe_charge_id,stripe_receipt_url,stripe_balance_transaction_id,stripe_fee_amount,stripe_net_amount,note,created_at&id=eq.${enc(id)}&limit=1`).catch(async e=>{
    if(!schemaMissing(e))throw e;
    return await safeSb(`/rest/v1/payment_transactions?select=id,invoice_id,amount,currency,provider,status,external_reference,stripe_checkout_session_id,stripe_payment_intent_id,note,created_at&id=eq.${enc(id)}&limit=1`);
  });
  return rows?.[0]||null;
}
function parseFee(tx){
  if(tx?.stripe_fee_amount!=null)return MONEY(tx.stripe_fee_amount);
  const m=String(tx?.note||'').match(/Stripe fee:\s*([0-9]+(?:\.[0-9]+)?)/i);
  return m?MONEY(m[1]):0;
}
async function handleInvoiceIssued(invoiceId){
  const inv=await invoice(invoiceId); if(!inv||inv.status==='DRAFT')return{ok:false,skipped:true};
  const items=await invoiceItems(invoiceId);
  await syncAccountingInvoice(inv,items);
  const total=MONEY(inv.total_amount),subtotal=MONEY(inv.subtotal),gst=MONEY(inv.gst_amount);
  const lines=[{code:'1100',debit:total,description:`A/R ${inv.invoice_number}`},{code:'4000',credit:subtotal,description:`Service revenue ${inv.invoice_number}`}];
  if(gst>0)lines.push({code:'2100',credit:gst,description:`GST/HST payable ${inv.invoice_number}`});
  return postEvent({type:'INVOICE_ISSUED',sourceTable:'invoices',sourceRecordId:inv.id,sourceReference:inv.invoice_number,occurredAt:inv.issued_at||inv.sent_at||inv.created_at,payload:{invoice:inv,items},entryDate:inv.invoice_date||today(),memo:`PLEASE invoice issued ${inv.invoice_number}`,lines});
}
async function handleInvoiceVoided(invoiceId){
  const inv=await invoice(invoiceId); if(!inv||inv.status!=='VOID')return{ok:false,skipped:true};
  const items=await invoiceItems(invoiceId);
  await syncAccountingInvoice(inv,items);
  const total=MONEY(inv.total_amount),subtotal=MONEY(inv.subtotal),gst=MONEY(inv.gst_amount);
  const lines=[{code:'4000',debit:subtotal,description:`Reverse revenue ${inv.invoice_number}`}];
  if(gst>0)lines.push({code:'2100',debit:gst,description:`Reverse GST/HST ${inv.invoice_number}`});
  lines.push({code:'1100',credit:total,description:`Reverse A/R ${inv.invoice_number}`});
  return postEvent({type:'INVOICE_VOIDED',sourceTable:'invoices',sourceRecordId:inv.id,sourceReference:inv.invoice_number,occurredAt:inv.voided_at||new Date().toISOString(),payload:{invoice:inv,items},entryDate:(inv.voided_at||new Date().toISOString()).slice(0,10),memo:`PLEASE invoice voided ${inv.invoice_number}`,lines});
}
async function handlePaymentTransaction(paymentTransactionId){
  const tx=await paymentTx(paymentTransactionId); if(!tx||tx.status!=='SUCCEEDED')return{ok:false,skipped:true};
  const inv=await invoice(tx.invoice_id); if(!inv)return{ok:false,error:'Invoice not found for payment transaction'};
  await syncAccountingPayment(inv,tx);
  const amount=MONEY(tx.amount),provider=String(tx.provider||'MANUAL').toUpperCase();
  const debitCode=provider==='STRIPE'?'1090':'1000';
  const lines=[{code:debitCode,debit:amount,description:`${provider} payment ${inv.invoice_number}`},{code:'1100',credit:amount,description:`Close A/R ${inv.invoice_number}`}];
  const res=await postEvent({type:'PAYMENT_RECEIVED',sourceTable:'payment_transactions',sourceRecordId:tx.id,sourceReference:inv.invoice_number,occurredAt:tx.created_at,payload:{invoice:inv,payment_transaction:tx},entryDate:(tx.created_at||new Date().toISOString()).slice(0,10),memo:`PLEASE payment received ${inv.invoice_number}`,lines});
  const fee=parseFee(tx);
  if(provider==='STRIPE'&&fee>0){
    await postEvent({type:'STRIPE_FEE_RECORDED',sourceTable:'payment_transactions',sourceRecordId:tx.id+'-fee',sourceReference:inv.invoice_number,occurredAt:tx.created_at,payload:{invoice:inv,payment_transaction:tx,fee_amount:fee},entryDate:(tx.created_at||new Date().toISOString()).slice(0,10),memo:`Stripe processing fee ${inv.invoice_number}`,lines:[{code:'5700',debit:fee,description:`Stripe fee ${inv.invoice_number}`},{code:'1090',credit:fee,description:`Reduce Stripe clearing ${inv.invoice_number}`}]});
  }
  return res;
}
async function latestPaymentForInvoice(invoiceId){
  const rows=await safeSb(`/rest/v1/payment_transactions?select=id&invoice_id=eq.${enc(invoiceId)}&status=eq.SUCCEEDED&order=created_at.desc&limit=1`).catch(()=>[]);
  return rows?.[0]?.id||null;
}
async function handleInvoicePaid(invoiceId){const id=await latestPaymentForInvoice(invoiceId);return id?handlePaymentTransaction(id):{ok:false,skipped:true,reason:'No payment transaction found'};}
async function providerPayment(id){
  const rows=await safeSb(`/rest/v1/provider_payments?select=id,payment_reference,job_id,assignment_id,provider_id,status,amount,currency,needs_rate_review,paid_at,payment_method,payment_reference_external,payment_note,advance_applied,cash_paid,created_at,updated_at,providers(id,display_name,company_name,worker_type),jobs(id,reference,service_name,completed_at)&id=eq.${enc(id)}&limit=1`).catch(async e=>{
    if(!schemaMissing(e))throw e;
    return await safeSb(`/rest/v1/provider_payments?select=id,payment_reference,job_id,assignment_id,provider_id,status,amount,currency,needs_rate_review,paid_at,payment_method,payment_reference_external,payment_note,created_at,updated_at,providers(id,display_name,company_name),jobs(id,reference,service_name,completed_at)&id=eq.${enc(id)}&limit=1`);
  });
  return rows?.[0]||null;
}
async function syncAccountingProviderExpense(p){
  try{
    const accounts=await ensureAccounts();
    const num=p.payment_reference||`PROVIDER-${p.id}`;
    const existing=await safeSb(`/rest/v1/accounting_expenses?expense_number=eq.${enc(num)}&select=id&limit=1`);
    const body={expense_number:num,expense_date:(p.jobs?.completed_at||p.created_at||new Date().toISOString()).slice(0,10),category_account_id:accounts['5000'],subtotal:MONEY(p.amount),tax_total:0,total:MONEY(p.amount),recoverable_tax:0,status:'POSTED',description:`Provider payable ${p.providers?.display_name||p.providers?.company_name||''} · ${p.jobs?.reference||''}`,source_reference:num};
    if(existing?.[0])await safeSb(`/rest/v1/accounting_expenses?id=eq.${enc(existing[0].id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});
    else await safeSb('/rest/v1/accounting_expenses',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});
  }catch(e){if(!schemaMissing(e))console.warn('cal-sync-provider-expense',e?.message||e);}
}
async function handleProviderPayableCreated(providerPaymentId){
  const p=await providerPayment(providerPaymentId); if(!p||Number(p.amount)<=0)return{ok:false,skipped:true};
  const workerType=String(p.providers?.worker_type||'INDEPENDENT_PROVIDER').toUpperCase();
  if(workerType==='PLEASE_STAFF'){
    return postEvent({type:'PLEASE_STAFF_COST_HELD',sourceTable:'provider_payments',sourceRecordId:p.id,sourceReference:p.payment_reference||p.id,occurredAt:p.created_at,payload:{provider_payment:p,reason:'PLEASE Staff costs require payroll/accountant workflow and are not posted as subcontractor expense.'},entryDate:(p.jobs?.completed_at||p.created_at||new Date().toISOString()).slice(0,10),memo:`PLEASE Staff cost held ${p.payment_reference||p.id}`,lines:[]});
  }
  await syncAccountingProviderExpense(p);
  const amount=MONEY(p.amount);
  return postEvent({type:'PROVIDER_PAYABLE_CREATED',sourceTable:'provider_payments',sourceRecordId:p.id,sourceReference:p.payment_reference||p.id,occurredAt:p.created_at,payload:{provider_payment:p},entryDate:(p.jobs?.completed_at||p.created_at||new Date().toISOString()).slice(0,10),memo:`Provider payable ${p.payment_reference||p.id}`,lines:[{code:'5000',debit:amount,description:`Subcontractor cost ${p.jobs?.reference||''}`},{code:'2010',credit:amount,description:`Provider payable ${p.providers?.display_name||p.providers?.company_name||''}`} ]});
}
async function handleProviderPaymentPaid(providerPaymentId){
  const p=await providerPayment(providerPaymentId); if(!p||p.status!=='PAID')return{ok:false,skipped:true};
  const workerType=String(p.providers?.worker_type||'INDEPENDENT_PROVIDER').toUpperCase();
  if(workerType==='PLEASE_STAFF'){
    return postEvent({type:'PLEASE_STAFF_PAYMENT_HELD',sourceTable:'provider_payments',sourceRecordId:p.id,sourceReference:p.payment_reference||p.id,occurredAt:p.paid_at||new Date().toISOString(),payload:{provider_payment:p,reason:'PLEASE Staff payments require payroll/accountant workflow and are not posted as subcontractor payable.'},entryDate:(p.paid_at||new Date().toISOString()).slice(0,10),memo:`PLEASE Staff payment held ${p.payment_reference||p.id}`,lines:[]});
  }
  await handleProviderPayableCreated(providerPaymentId);
  const amount=MONEY(p.amount),advance=MONEY(p.advance_applied||0),cash=MONEY(p.cash_paid==null?amount:p.cash_paid);
  const lines=[{code:'2010',debit:amount,description:`Provider payable paid ${p.payment_reference||p.id}`}];
  if(advance>0)lines.push({code:'1300',credit:advance,description:'Provider advance applied'});
  if(cash>0)lines.push({code:'1000',credit:cash,description:`Provider payment ${p.payment_method||''} ${p.payment_reference_external||''}`});
  return postEvent({type:'PROVIDER_PAYMENT_PAID',sourceTable:'provider_payments',sourceRecordId:p.id,sourceReference:p.payment_reference||p.id,occurredAt:p.paid_at||new Date().toISOString(),payload:{provider_payment:p},entryDate:(p.paid_at||new Date().toISOString()).slice(0,10),memo:`Provider payment paid ${p.payment_reference||p.id}`,lines});
}
async function reconcile(limit=200){
  const summary={invoices_issued:0,invoices_voided:0,payments:0,provider_payables:0,provider_payments_paid:0,errors:[]};
  const invoices=await safeSb(`/rest/v1/invoices?select=id,status&status=in.(ISSUED,SENT,OVERDUE,PAID,VOID)&order=created_at.asc&limit=${Number(limit)||200}`).catch(e=>{summary.errors.push(e.message);return[];});
  for(const inv of invoices||[]){const a=await handleInvoiceIssued(inv.id); if(a?.ok)summary.invoices_issued++; if(inv.status==='VOID'){const v=await handleInvoiceVoided(inv.id); if(v?.ok)summary.invoices_voided++;}}
  const txs=await safeSb(`/rest/v1/payment_transactions?select=id&status=eq.SUCCEEDED&order=created_at.asc&limit=${Number(limit)||200}`).catch(e=>{summary.errors.push(e.message);return[];});
  for(const tx of txs||[]){const r=await handlePaymentTransaction(tx.id); if(r?.ok)summary.payments++;}
  const pps=await safeSb(`/rest/v1/provider_payments?select=id,status&order=created_at.asc&limit=${Number(limit)||200}`).catch(e=>{summary.errors.push(e.message);return[];});
  for(const p of pps||[]){const a=await handleProviderPayableCreated(p.id); if(a?.ok)summary.provider_payables++; if(p.status==='PAID'){const r=await handleProviderPaymentPaid(p.id); if(r?.ok)summary.provider_payments_paid++;}}
  return summary;
}

module.exports={MONEY,enabled,handleInvoiceIssued,handleInvoiceVoided,handleInvoicePaid,handlePaymentTransaction,handleProviderPayableCreated,handleProviderPaymentPaid,reconcile};
