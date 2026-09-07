const crypto=require('crypto');
const lib=require('./_admin-lib');

const SOURCE_SYSTEM='PLEASE';
const MONEY=n=>Math.round((Number(n)||0)*100)/100;
const enc=v=>encodeURIComponent(String(v??''));
const today=()=>new Date().toISOString().slice(0,10);
const clean=(v,n=1000)=>String(v??'').trim().slice(0,n);
const sleepMs=attempt=>Math.min(60*60*1000,Math.max(5*1000,Math.pow(2,Math.max(0,attempt-1))*15*1000));

function enabled(){return !['false','0','off','no'].includes(String(process.env.CAL_INTEGRATION_ENABLED||process.env.CAL_ACCOUNTING_ENABLED||'true').toLowerCase());}
function schemaMissing(e){const m=String(e?.message||e||'').toLowerCase();return e?.status===404||m.includes('could not find')||m.includes('schema cache')||m.includes('does not exist')||m.includes('relation');}
function hashPayload(payload){return crypto.createHash('sha256').update(JSON.stringify(payload||{})).digest('hex');}
function journalNo(){return `CAL-JE-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;}
async function safeSb(path,options={}){return lib.sbJson(path,options);}

async function account(code,name,type){
  const rows=await safeSb(`/rest/v1/accounting_accounts?code=eq.${enc(code)}&select=id,code&limit=1`);
  if(rows?.[0])return rows[0].id;
  const created=await safeSb('/rest/v1/accounting_accounts',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({code,name,account_type:type,active:true})});
  return created?.[0]?.id;
}
async function ensureAccounts(){
  const defs=[
    ['1000','Operating Bank','ASSET'],['1090','Stripe Clearing / Undeposited Funds','ASSET'],['1100','Accounts Receivable','ASSET'],['1200','GST/HST Recoverable','ASSET'],['1300','Provider Advances','ASSET'],
    ['2000','Accounts Payable','LIABILITY'],['2010','Provider Payable','LIABILITY'],['2020','Employee / Contractor Reimbursements Payable','LIABILITY'],['2100','GST/HST Payable','LIABILITY'],['2110','QST Payable','LIABILITY'],['3000','Owner Equity / Retained Earnings','EQUITY'],
    ['4000','Service Revenue','REVENUE'],['5000','Subcontractors Expense','EXPENSE'],['5100','Fuel & Vehicle','EXPENSE'],['5200','Insurance','EXPENSE'],['5300','Advertising','EXPENSE'],['5400','Office & Software','EXPENSE'],['5500','Professional Fees','EXPENSE'],['5600','Repairs & Maintenance','EXPENSE'],['5700','Merchant / Bank Fees','EXPENSE']
  ];
  const out={};
  for(const [code,name,type] of defs)out[code]=await account(code,name,type);
  return out;
}
async function postingRule(eventType){
  const rows=await safeSb(`/rest/v1/accounting_posting_rules?source_system=eq.${SOURCE_SYSTEM}&event_type=eq.${enc(eventType)}&enabled=eq.true&select=*&order=rule_version.desc&limit=1`).catch(()=>[]);
  return rows?.[0]||null;
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
async function updateOutboxById(id,patch){
  if(!id)return;
  await safeSb(`/rest/v1/please_accounting_outbox?id=eq.${enc(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({...patch,updated_at:new Date().toISOString()})});
}
async function outboxByKey(key){
  const rows=await safeSb(`/rest/v1/please_accounting_outbox?event_key=eq.${enc(key)}&select=*&limit=1`).catch(()=>[]);
  return rows?.[0]||null;
}

async function postJournal(eventRow,{entryDate,memo,lines}){
  // STEP 17 posts header + lines + POSTED state inside one PostgreSQL transaction.
  // This prevents a worker crash from leaving a partial DRAFT that could be mistaken for a completed journal.
  await ensureAccounts();
  const normalized=(lines||[]).map(l=>({
    code:clean(l.code,30),description:clean(l.description||memo,500),debit:MONEY(l.debit),credit:MONEY(l.credit)
  })).filter(l=>l.code&&(l.debit>0||l.credit>0));
  const debits=MONEY(normalized.reduce((n,l)=>n+l.debit,0));
  const credits=MONEY(normalized.reduce((n,l)=>n+l.credit,0));
  if(!normalized.length)throw new Error('Accounting journal requires at least one line.');
  if(Math.abs(debits-credits)>0.001)throw new Error(`Accounting entry is out of balance: debits ${debits.toFixed(2)} / credits ${credits.toFixed(2)}.`);
  const result=await safeSb('/rest/v1/rpc/accounting_post_event_journal',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({
    p_event_id:eventRow.id,p_entry_date:entryDate||today(),p_memo:clean(memo,500),p_lines:normalized
  })});
  const id=Array.isArray(result)?(result[0]?.accounting_post_event_journal||result[0]?.id||result[0]):(result?.accounting_post_event_journal||result?.id||result);
  if(!id)throw new Error('Accounting journal transaction did not return a journal entry id.');
  return String(id);
}

async function invoice(id){
  const rows=await safeSb(`/rest/v1/invoices?select=id,invoice_number,job_id,customer_id,client_name,client_email,client_phone,invoice_date,due_date,subtotal,gst_rate,gst_amount,total_amount,currency,amount_paid,status,payment_status,payment_method,payment_reference,stripe_checkout_session_id,stripe_payment_intent_id,issued_at,sent_at,paid_at,voided_at,void_reason,created_at,updated_at&id=eq.${enc(id)}&limit=1`);
  return rows?.[0]||null;
}
async function invoiceItems(id){
  return await safeSb(`/rest/v1/invoice_items?select=id,description,qty,unit,unit_rate,line_total,sort_order&invoice_id=eq.${enc(id)}&order=sort_order.asc,id.asc`).catch(()=>[]);
}
async function partyForOperationalCustomer(customerId){
  if(!customerId)return null;
  const rows=await safeSb(`/rest/v1/accounting_parties?source_system=eq.PLEASE&source_table=eq.customers&source_record_id=eq.${enc(customerId)}&select=id,party_number,legal_name,display_name&limit=1`).catch(()=>[]);
  return rows?.[0]||null;
}
async function accountingPaidTotal(accountingInvoiceId){
  if(!accountingInvoiceId)return 0;
  const rows=await safeSb(`/rest/v1/accounting_payments?select=amount&invoice_id=eq.${enc(accountingInvoiceId)}`).catch(()=>[]);
  return MONEY((rows||[]).reduce((sum,row)=>sum+Number(row.amount||0),0));
}
async function upsertAccountingInvoiceMirror(inv,items=[]){
  try{
    const existing=await safeSb(`/rest/v1/accounting_invoices?invoice_number=eq.${enc(inv.invoice_number)}&select=id,total,party_id,source_invoice_id&limit=1`);
    const party=await partyForOperationalCustomer(inv.customer_id);
    const body={invoice_number:inv.invoice_number,invoice_date:inv.invoice_date||today(),due_date:inv.due_date||null,status:inv.status==='ISSUED'?'SENT':inv.status,subtotal:MONEY(inv.subtotal),tax_total:MONEY(inv.gst_amount),total:MONEY(inv.total_amount),currency:inv.currency||'CAD',source_reference:inv.invoice_number,notes:`Imported from PLEASE invoice ${inv.invoice_number}`};
    if(inv.id)body.source_invoice_id=String(inv.id);
    if(party?.id)body.party_id=party.id;
    let accountingInvoiceId=existing?.[0]?.id;
    if(accountingInvoiceId){
      // paid_total is payment-derived. Never overwrite it from PLEASE invoices.amount_paid,
      // otherwise the same payment can be counted once here and again when PAYMENT_RECEIVED is mirrored.
      await safeSb(`/rest/v1/accounting_invoices?id=eq.${enc(accountingInvoiceId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});
      await safeSb(`/rest/v1/accounting_invoice_lines?invoice_id=eq.${enc(accountingInvoiceId)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}}).catch(()=>{});
    }else{
      const created=await safeSb('/rest/v1/accounting_invoices',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({...body,paid_total:0})});
      accountingInvoiceId=created?.[0]?.id;
    }
    if(accountingInvoiceId&&items?.length){
      const accounts=await ensureAccounts();
      await safeSb('/rest/v1/accounting_invoice_lines',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(items.map(x=>({invoice_id:accountingInvoiceId,description:x.description||'PLEASE service',quantity:Number(x.qty)||1,unit_price:Number(x.unit_rate)||0,revenue_account_id:accounts['4000'],line_subtotal:MONEY(x.line_total),line_tax:0})))}).catch(e=>console.warn('cal-invoice-lines',e.message));
    }
  }catch(e){if(!schemaMissing(e))console.warn('cal-sync-invoice',e?.message||e);}
}
async function upsertAccountingPaymentMirror(inv,tx){
  try{
    const ai=await safeSb(`/rest/v1/accounting_invoices?invoice_number=eq.${enc(inv.invoice_number)}&select=id,total,status&limit=1`);
    const accountingInvoiceId=ai?.[0]?.id||null;
    const ref=`PLEASE-PAYMENT-${tx.id}`;
    const existing=await safeSb(`/rest/v1/accounting_payments?reference=eq.${enc(ref)}&select=id&limit=1`).catch(()=>[]);
    if(!existing?.[0]){
      await safeSb('/rest/v1/accounting_payments',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({invoice_id:accountingInvoiceId,payment_date:(tx.created_at||inv.paid_at||new Date().toISOString()).slice(0,10),amount:MONEY(tx.amount),method:tx.provider||inv.payment_method||'MANUAL',reference:ref})});
    }
    // Recompute from the idempotent accounting_payments mirror instead of incrementing paid_total.
    // This makes retries harmless and also self-heals any stale paid_total on the next payment event.
    if(accountingInvoiceId){
      const paid=await accountingPaidTotal(accountingInvoiceId);
      const total=MONEY(ai?.[0]?.total??inv.total_amount);
      const status=paid+0.001>=total?'PAID':(paid>0?'PARTIAL':(inv.status==='PAID'?'SENT':inv.status));
      await safeSb(`/rest/v1/accounting_invoices?id=eq.${enc(accountingInvoiceId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({paid_total:paid,status})}).catch(()=>{});
    }
  }catch(e){if(!schemaMissing(e))console.warn('cal-sync-payment',e?.message||e);}
}
async function paymentTx(id){
  const rows=await safeSb(`/rest/v1/payment_transactions?select=id,invoice_id,amount,currency,provider,status,external_reference,stripe_checkout_session_id,stripe_payment_intent_id,stripe_charge_id,stripe_receipt_url,stripe_balance_transaction_id,stripe_fee_amount,stripe_net_amount,stripe_webhook_event_id,note,created_at&id=eq.${enc(id)}&limit=1`).catch(async e=>{
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
async function providerPayment(id){
  const rows=await safeSb(`/rest/v1/provider_payments?select=id,payment_reference,job_id,assignment_id,provider_id,status,amount,currency,needs_rate_review,paid_at,payment_method,payment_reference_external,payment_note,advance_applied,cash_paid,created_at,updated_at,providers(id,display_name,company_name,worker_type),jobs(id,reference,service_name,completed_at)&id=eq.${enc(id)}&limit=1`).catch(async e=>{
    if(!schemaMissing(e))throw e;
    return await safeSb(`/rest/v1/provider_payments?select=id,payment_reference,job_id,assignment_id,provider_id,status,amount,currency,needs_rate_review,paid_at,payment_method,payment_reference_external,payment_note,created_at,updated_at,providers(id,display_name,company_name),jobs(id,reference,service_name,completed_at)&id=eq.${enc(id)}&limit=1`);
  });
  return rows?.[0]||null;
}
async function upsertAccountingProviderExpenseMirror(p){
  try{
    const accounts=await ensureAccounts();
    const num=p.payment_reference||`PROVIDER-${p.id}`;
    const existing=await safeSb(`/rest/v1/accounting_expenses?expense_number=eq.${enc(num)}&select=id&limit=1`);
    const body={expense_number:num,expense_date:(p.jobs?.completed_at||p.created_at||new Date().toISOString()).slice(0,10),category_account_id:accounts['5000'],subtotal:MONEY(p.amount),tax_total:0,total:MONEY(p.amount),recoverable_tax:0,status:'POSTED',description:`Provider payable ${p.providers?.display_name||p.providers?.company_name||''} · ${p.jobs?.reference||''}`,source_reference:num};
    if(existing?.[0])await safeSb(`/rest/v1/accounting_expenses?id=eq.${enc(existing[0].id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});
    else await safeSb('/rest/v1/accounting_expenses',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});
  }catch(e){if(!schemaMissing(e))console.warn('cal-sync-provider-expense',e?.message||e);}
}

async function supplierBill(id){
  const rows=await safeSb(`/rest/v1/accounting_supplier_bills?select=*&id=eq.${enc(id)}&limit=1`);
  return rows?.[0]||null;
}
async function supplierBillLines(id){
  return await safeSb(`/rest/v1/accounting_supplier_bill_lines?select=id,supplier_bill_id,sort_order,description,quantity,unit_price,posting_account_id,tax_code_id,line_subtotal,tax_amount,recoverable_tax,line_total&supplier_bill_id=eq.${enc(id)}&order=sort_order.asc,id.asc`).catch(()=>[]);
}
async function supplierPayment(id){
  const rows=await safeSb(`/rest/v1/accounting_supplier_payments?select=*&id=eq.${enc(id)}&limit=1`);
  return rows?.[0]||null;
}
async function glAccountById(id){
  if(!id)return null;
  const rows=await safeSb(`/rest/v1/accounting_accounts?id=eq.${enc(id)}&select=id,code,name,account_type,active&limit=1`);
  return rows?.[0]||null;
}
async function taxCodeById(id){
  if(!id)return null;
  const rows=await safeSb(`/rest/v1/accounting_tax_codes?id=eq.${enc(id)}&select=id,code,tax_kind,federal_rate,provincial_rate,recoverable_default&limit=1`);
  return rows?.[0]||null;
}
async function financialAccount(id){
  if(!id)return null;
  const rows=await safeSb(`/rest/v1/accounting_financial_accounts?id=eq.${enc(id)}&select=id,name,financial_type,currency,gl_account_id,active&limit=1`);
  return rows?.[0]||null;
}
async function accountingInvoice(id){
  if(!id)return null;
  const rows=await safeSb(`/rest/v1/accounting_invoices?id=eq.${enc(id)}&select=id,invoice_number,party_id,source_invoice_id,invoice_date,status,subtotal,tax_total,total,currency&limit=1`);
  return rows?.[0]||null;
}
async function creditNote(id){
  if(!id)return null;
  const rows=await safeSb(`/rest/v1/accounting_credit_notes?id=eq.${enc(id)}&select=*&limit=1`);
  return rows?.[0]||null;
}
async function creditNoteLines(id){
  return await safeSb(`/rest/v1/accounting_credit_note_lines?credit_note_id=eq.${enc(id)}&select=id,credit_note_id,sort_order,description,quantity,unit_price,revenue_account_id,tax_code_id,tax_amount_override,line_subtotal,line_tax,line_total&order=sort_order.asc,id.asc`).catch(()=>[]);
}
async function customerRefund(id){
  if(!id)return null;
  const rows=await safeSb(`/rest/v1/accounting_customer_refunds?id=eq.${enc(id)}&select=*&limit=1`);
  return rows?.[0]||null;
}
async function expenseClaim(id){
  if(!id)return null;
  const rows=await safeSb(`/rest/v1/accounting_expense_claims?id=eq.${enc(id)}&select=*&limit=1`);
  return rows?.[0]||null;
}
async function expenseClaimLines(id){
  return await safeSb(`/rest/v1/accounting_expense_claim_lines?expense_claim_id=eq.${enc(id)}&select=*&order=sort_order.asc,id.asc`).catch(()=>[]);
}
async function expenseReimbursement(id){
  if(!id)return null;
  const rows=await safeSb(`/rest/v1/accounting_expense_reimbursements?id=eq.${enc(id)}&select=*&limit=1`);
  return rows?.[0]||null;
}

function snap(row,key,current){return row?.payload_json?.[key]||current||{};}
async function dependencyPosted(eventKey,{allowIgnored=false}={}){
  const dep=await outboxByKey(eventKey);
  if(!dep)return false;
  return dep.status==='POSTED'||(allowIgnored&&dep.status==='IGNORED');
}

async function buildPosting(row){
  const type=String(row.event_type||'').toUpperCase();
  const rule=await postingRule(type);
  if(['INVOICE_ISSUED','INVOICE_VOIDED','PAYMENT_RECEIVED','STRIPE_FEE_RECORDED','PROVIDER_PAYABLE_CREATED','PROVIDER_PAYMENT_PAID','VENDOR_BILL_POSTED','SUPPLIER_PAYMENT_PAID','CREDIT_NOTE_ISSUED','REFUND_COMPLETED','EXPENSE_POSTED','EXPENSE_REIMBURSEMENT_PAID'].includes(type)&&!rule){
    throw new Error(`No enabled CAL posting rule is configured for ${type}.`);
  }

  if(type==='INVOICE_ISSUED'){
    const current=await invoice(row.source_record_id); if(!current)throw new Error('Invoice source record not found.');
    const inv=snap(row,'invoice',current),items=await invoiceItems(row.source_record_id);
    await upsertAccountingInvoiceMirror({...current,...inv},items);
    const total=MONEY(inv.total_amount),subtotal=MONEY(inv.subtotal),gst=MONEY(inv.gst_amount);
    if(total<=0)return{ignored:true,reason:'Invoice total is zero; no journal posting required.',payload:{invoice:inv,items}};
    const lines=[{code:rule.debit_account_code||'1100',debit:total,description:`A/R ${inv.invoice_number||current.invoice_number}`},{code:rule.credit_account_code||'4000',credit:subtotal,description:`Service revenue ${inv.invoice_number||current.invoice_number}`}];
    if(gst>0)lines.push({code:rule.tax_account_code||'2100',credit:gst,description:`GST/HST payable ${inv.invoice_number||current.invoice_number}`});
    return{payload:{invoice:inv,items},entryDate:inv.invoice_date||today(),memo:`PLEASE invoice issued ${inv.invoice_number||current.invoice_number}`,lines};
  }

  if(type==='INVOICE_VOIDED'){
    const current=await invoice(row.source_record_id); if(!current)throw new Error('Voided invoice source record not found.');
    const inv=snap(row,'invoice',current),previous=String(row?.payload_json?.previous_status||'').toUpperCase();
    if(previous==='DRAFT')return{ignored:true,reason:'Draft invoice voided before issue; no accounting reversal required.',payload:{invoice:inv,previous_status:previous}};
    const issueKey=`PLEASE:INVOICE_ISSUED:${row.source_record_id}`;
    if(!(await dependencyPosted(issueKey,{allowIgnored:true})))throw new Error(`Dependency pending: ${issueKey}`);
    const items=await invoiceItems(row.source_record_id); await upsertAccountingInvoiceMirror({...current,...inv},items);
    const total=MONEY(inv.total_amount),subtotal=MONEY(inv.subtotal),gst=MONEY(inv.gst_amount);
    const lines=[{code:rule.debit_account_code||'4000',debit:subtotal,description:`Reverse revenue ${inv.invoice_number||current.invoice_number}`}];
    if(gst>0)lines.push({code:rule.tax_account_code||'2100',debit:gst,description:`Reverse GST/HST ${inv.invoice_number||current.invoice_number}`});
    lines.push({code:rule.credit_account_code||'1100',credit:total,description:`Reverse A/R ${inv.invoice_number||current.invoice_number}`});
    return{payload:{invoice:inv,items,previous_status:previous},entryDate:String(inv.voided_at||row.occurred_at||new Date().toISOString()).slice(0,10),memo:`PLEASE invoice voided ${inv.invoice_number||current.invoice_number}`,lines};
  }

  if(type==='PAYMENT_RECEIVED'){
    const current=await paymentTx(row.source_record_id); if(!current)throw new Error('Payment transaction source record not found.');
    const tx=snap(row,'payment_transaction',current); if(String(tx.status||current.status).toUpperCase()!=='SUCCEEDED')return{ignored:true,reason:'Payment is not in SUCCEEDED state.',payload:{payment_transaction:tx}};
    const inv=await invoice(tx.invoice_id||current.invoice_id); if(!inv)throw new Error('Invoice not found for payment transaction.');
    await upsertAccountingPaymentMirror(inv,{...current,...tx});
    const amount=MONEY(tx.amount),provider=String(tx.provider||'MANUAL').toUpperCase();
    const cfg=rule.configuration_json||{};
    const debitCode=provider==='STRIPE'?(cfg.stripe_debit||rule.debit_account_code||'1090'):(cfg.manual_debit||'1000');
    const lines=[{code:debitCode,debit:amount,description:`${provider} payment ${inv.invoice_number}`},{code:rule.credit_account_code||'1100',credit:amount,description:`Close A/R ${inv.invoice_number}`}];
    return{payload:{invoice:inv,payment_transaction:tx},entryDate:String(tx.created_at||row.occurred_at||new Date().toISOString()).slice(0,10),memo:`PLEASE payment received ${inv.invoice_number}`,lines};
  }

  if(type==='STRIPE_FEE_RECORDED'){
    const paymentKey=`PLEASE:PAYMENT_RECEIVED:${row.source_record_id}`;
    if(!(await dependencyPosted(paymentKey)))throw new Error(`Dependency pending: ${paymentKey}`);
    const current=await paymentTx(row.source_record_id); if(!current)throw new Error('Stripe payment transaction source record not found.');
    const tx=snap(row,'payment_transaction',current),fee=MONEY(row?.payload_json?.fee_amount??parseFee(tx));
    if(fee<=0)return{ignored:true,reason:'Stripe fee is zero or unavailable.',payload:{payment_transaction:tx}};
    const inv=await invoice(tx.invoice_id||current.invoice_id); if(!inv)throw new Error('Invoice not found for Stripe fee.');
    return{payload:{invoice:inv,payment_transaction:tx,fee_amount:fee},entryDate:String(tx.created_at||row.occurred_at||new Date().toISOString()).slice(0,10),memo:`Stripe processing fee ${inv.invoice_number}`,lines:[{code:rule.debit_account_code||'5700',debit:fee,description:`Stripe fee ${inv.invoice_number}`},{code:rule.credit_account_code||'1090',credit:fee,description:`Reduce Stripe clearing ${inv.invoice_number}`}]};
  }

  if(type==='PROVIDER_PAYABLE_CREATED'){
    const current=await providerPayment(row.source_record_id); if(!current)throw new Error('Provider payable source record not found.');
    const snapP=snap(row,'provider_payment',current),p={...current,...snapP,providers:current.providers,jobs:current.jobs};
    if(Number(p.amount)<=0||p.needs_rate_review)return{ignored:true,reason:'Provider payable has no approved positive amount.',payload:{provider_payment:p}};
    const workerType=String(p.providers?.worker_type||'INDEPENDENT_PROVIDER').toUpperCase();
    if(workerType==='PLEASE_STAFF')return{ignored:true,reason:'PLEASE Staff cost requires payroll/accountant workflow and is not posted as subcontractor expense.',payload:{provider_payment:p,classification:workerType}};
    await upsertAccountingProviderExpenseMirror(p);
    const amount=MONEY(p.amount);
    return{payload:{provider_payment:p},entryDate:String(p.jobs?.completed_at||p.created_at||row.occurred_at||new Date().toISOString()).slice(0,10),memo:`Provider payable ${p.payment_reference||p.id}`,lines:[{code:rule.debit_account_code||'5000',debit:amount,description:`Subcontractor cost ${p.jobs?.reference||''}`},{code:rule.credit_account_code||'2010',credit:amount,description:`Provider payable ${p.providers?.display_name||p.providers?.company_name||''}`}]};
  }

  if(type==='PROVIDER_PAYMENT_PAID'){
    const payableKey=`PLEASE:PROVIDER_PAYABLE_CREATED:${row.source_record_id}`;
    if(!(await dependencyPosted(payableKey,{allowIgnored:true})))throw new Error(`Dependency pending: ${payableKey}`);
    const current=await providerPayment(row.source_record_id); if(!current)throw new Error('Provider payment source record not found.');
    const snapP=snap(row,'provider_payment',current),p={...current,...snapP,providers:current.providers,jobs:current.jobs};
    if(String(p.status||'').toUpperCase()!=='PAID')return{ignored:true,reason:'Provider payment is not PAID.',payload:{provider_payment:p}};
    const workerType=String(p.providers?.worker_type||'INDEPENDENT_PROVIDER').toUpperCase();
    if(workerType==='PLEASE_STAFF')return{ignored:true,reason:'PLEASE Staff payment requires payroll/accountant workflow and is not posted through subcontractor payable.',payload:{provider_payment:p,classification:workerType}};
    const amount=MONEY(p.amount),advance=MONEY(p.advance_applied||0),cash=MONEY(p.cash_paid==null?amount:p.cash_paid);
    const lines=[{code:rule.debit_account_code||'2010',debit:amount,description:`Provider payable paid ${p.payment_reference||p.id}`}];
    if(advance>0)lines.push({code:'1300',credit:advance,description:'Provider advance applied'});
    if(cash>0)lines.push({code:rule.credit_account_code||'1000',credit:cash,description:`Provider payment ${p.payment_method||''} ${p.payment_reference_external||''}`});
    return{payload:{provider_payment:p},entryDate:String(p.paid_at||row.occurred_at||new Date().toISOString()).slice(0,10),memo:`Provider payment paid ${p.payment_reference||p.id}`,lines};
  }


  if(type==='VENDOR_BILL_POSTED'){
    const current=await supplierBill(row.source_record_id); if(!current)throw new Error('Supplier bill source record not found.');
    const bill=snap(row,'supplier_bill',current);
    if(!['POSTED','PARTIAL','PAID'].includes(String(current.status||bill.status||'').toUpperCase()))return{ignored:true,reason:'Supplier bill is not posted.',payload:{supplier_bill:bill}};
    const currentLines=await supplierBillLines(row.source_record_id);
    const linesSnap=Array.isArray(row?.payload_json?.lines)&&row.payload_json.lines.length?row.payload_json.lines:currentLines;
    if(!linesSnap.length)throw new Error('Posted supplier bill has no lines.');
    const journalLines=[];
    let controlTotal=0;
    const taxBuckets=new Map();
    for(const l of linesSnap){
      const acct=await glAccountById(l.posting_account_id);if(!acct||acct.active===false)throw new Error(`Supplier bill posting account is missing or inactive for line ${l.description||l.id||''}.`);
      if(!['EXPENSE','ASSET'].includes(String(acct.account_type||'').toUpperCase()))throw new Error(`Supplier bill line must post to EXPENSE or ASSET account ${acct.code}.`);
      const subtotal=MONEY(l.line_subtotal),tax=MONEY(l.tax_amount),recoverable=MONEY(l.recoverable_tax),nonRecoverable=MONEY(Math.max(0,tax-recoverable));
      const expenseDebit=MONEY(subtotal+nonRecoverable);
      if(expenseDebit>0)journalLines.push({code:acct.code,debit:expenseDebit,description:`Purchase ${bill.bill_number||current.bill_number} · ${l.description||acct.name}`});
      if(recoverable>0){
        const tc=await taxCodeById(l.tax_code_id);
        const taxKind=String(tc?.tax_kind||'GST').toUpperCase();
        const taxCode=taxKind==='QST'?(rule.configuration_json?.qst_recoverable_account||'1210'):(rule.tax_account_code||'1200');
        taxBuckets.set(taxCode,MONEY((taxBuckets.get(taxCode)||0)+recoverable));
      }
      controlTotal=MONEY(controlTotal+subtotal+tax);
    }
    for(const [code,amount] of taxBuckets.entries())if(amount>0)journalLines.push({code,debit:amount,description:`Recoverable purchase tax ${bill.bill_number||current.bill_number}`});
    const expected=MONEY(bill.total||current.total);
    if(Math.abs(controlTotal-expected)>0.02)throw new Error(`Supplier bill line totals ${controlTotal.toFixed(2)} do not match bill total ${expected.toFixed(2)}.`);
    journalLines.push({code:rule.credit_account_code||'2000',credit:expected,description:`Accounts Payable ${bill.bill_number||current.bill_number}`});
    return{payload:{supplier_bill:bill,lines:linesSnap},entryDate:String(bill.bill_date||current.bill_date||row.occurred_at||new Date().toISOString()).slice(0,10),memo:`Supplier bill posted ${bill.bill_number||current.bill_number}`,lines:journalLines};
  }

  if(type==='SUPPLIER_PAYMENT_PAID'){
    const current=await supplierPayment(row.source_record_id); if(!current)throw new Error('Supplier payment source record not found.');
    const payment=snap(row,'supplier_payment',current);
    if(String(current.status||payment.status||'').toUpperCase()!=='PAID')return{ignored:true,reason:'Supplier payment is not PAID.',payload:{supplier_payment:payment}};
    const billId=payment.supplier_bill_id||current.supplier_bill_id;
    const billKey=`PLEASE:VENDOR_BILL_POSTED:${billId}`;
    if(!(await dependencyPosted(billKey)))throw new Error(`Dependency pending: ${billKey}`);
    const bill=await supplierBill(billId);if(!bill)throw new Error('Supplier bill not found for supplier payment.');
    const fin=await financialAccount(payment.financial_account_id||current.financial_account_id);if(!fin||fin.active===false)throw new Error('Supplier payment financial account is missing or inactive.');
    const gl=await glAccountById(fin.gl_account_id);if(!gl||gl.active===false)throw new Error('Supplier payment GL mapping is missing or inactive.');
    const amount=MONEY(payment.amount||current.amount);
    return{payload:{supplier_bill:bill,supplier_payment:payment,financial_account:fin},entryDate:String(payment.payment_date||current.payment_date||row.occurred_at||new Date().toISOString()).slice(0,10),memo:`Supplier payment ${payment.payment_number||current.payment_number}`,lines:[{code:rule.debit_account_code||'2000',debit:amount,description:`Reduce A/P ${bill.bill_number}`},{code:gl.code,credit:amount,description:`Supplier payment via ${fin.name}`}]};
  }

  if(type==='CREDIT_NOTE_ISSUED'){
    const current=await creditNote(row.source_record_id);if(!current)throw new Error('Credit note source record not found.');
    const note=snap(row,'credit_note',current);
    if(String(current.status||note.status||'').toUpperCase()!=='POSTED')return{ignored:true,reason:'Credit note is not POSTED.',payload:{credit_note:note}};
    const inv=await accountingInvoice(note.invoice_id||current.invoice_id);if(!inv)throw new Error('Original accounting invoice not found for credit note.');
    if(inv.source_invoice_id){const issueKey=`PLEASE:INVOICE_ISSUED:${inv.source_invoice_id}`;if(!(await dependencyPosted(issueKey,{allowIgnored:true})))throw new Error(`Dependency pending: ${issueKey}`);}
    const currentLines=await creditNoteLines(row.source_record_id),linesSnap=Array.isArray(row?.payload_json?.lines)&&row.payload_json.lines.length?row.payload_json.lines:currentLines;
    if(!linesSnap.length)throw new Error('Posted credit note has no lines.');
    const journalLines=[],revenueBuckets=new Map(),taxBuckets=new Map();let control=0;
    for(const l of linesSnap){
      const acct=await glAccountById(l.revenue_account_id);if(!acct||acct.active===false||String(acct.account_type).toUpperCase()!=='REVENUE')throw new Error('Credit note revenue account is missing, inactive, or not REVENUE.');
      const sub=MONEY(l.line_subtotal),tax=MONEY(l.line_tax);if(sub>0)revenueBuckets.set(acct.code,MONEY((revenueBuckets.get(acct.code)||0)+sub));
      if(tax>0){const tc=await taxCodeById(l.tax_code_id);const kind=String(tc?.tax_kind||'GST').toUpperCase(),code=kind==='QST'?(rule.configuration_json?.qst_payable_account||'2110'):(rule.tax_account_code||'2100');taxBuckets.set(code,MONEY((taxBuckets.get(code)||0)+tax));}
      control=MONEY(control+sub+tax);
    }
    for(const [code,amount] of revenueBuckets)journalLines.push({code,debit:amount,description:`Credit note revenue reduction ${note.credit_note_number}`});
    for(const [code,amount] of taxBuckets)journalLines.push({code,debit:amount,description:`Credit note sales-tax reduction ${note.credit_note_number}`});
    const expected=MONEY(note.total||current.total);if(Math.abs(control-expected)>0.02)throw new Error(`Credit note lines ${control.toFixed(2)} do not match credit note total ${expected.toFixed(2)}.`);
    journalLines.push({code:rule.credit_account_code||'1100',credit:expected,description:`Reduce A/R ${inv.invoice_number}`});
    return{payload:{credit_note:note,invoice:inv,lines:linesSnap},entryDate:String(note.credit_date||current.credit_date||row.occurred_at||new Date().toISOString()).slice(0,10),memo:`Credit note issued ${note.credit_note_number} · ${inv.invoice_number}`,lines:journalLines};
  }

  if(type==='REFUND_COMPLETED'){
    const current=await customerRefund(row.source_record_id);if(!current)throw new Error('Customer refund source record not found.');
    const refund=snap(row,'customer_refund',current);
    if(String(current.status||refund.status||'').toUpperCase()!=='COMPLETED')return{ignored:true,reason:'Customer refund is not COMPLETED.',payload:{customer_refund:refund}};
    if(refund.credit_note_id||current.credit_note_id){const creditKey=`PLEASE:CREDIT_NOTE_ISSUED:${refund.credit_note_id||current.credit_note_id}`;if(!(await dependencyPosted(creditKey)))throw new Error(`Dependency pending: ${creditKey}`);}
    const fin=await financialAccount(refund.financial_account_id||current.financial_account_id);if(!fin||fin.active===false)throw new Error('Refund financial account is missing or inactive.');
    const gl=await glAccountById(fin.gl_account_id);if(!gl||gl.active===false)throw new Error('Refund financial account GL mapping is missing or inactive.');
    const amount=MONEY(refund.amount||current.amount);
    return{payload:{customer_refund:refund,financial_account:fin},entryDate:String(refund.refund_date||current.refund_date||row.occurred_at||new Date().toISOString()).slice(0,10),memo:`Customer refund ${refund.refund_number||current.refund_number}`,lines:[{code:rule.debit_account_code||'1100',debit:amount,description:`Consume customer credit ${refund.refund_number||current.refund_number}`},{code:gl.code,credit:amount,description:`Refund via ${fin.name}`}]};
  }

  if(type==='EXPENSE_POSTED'){
    const current=await expenseClaim(row.source_record_id);if(!current)throw new Error('Expense source record not found.');
    const claim=snap(row,'expense_claim',current),status=String(current.status||claim.status||'').toUpperCase();
    if(!['POSTED','PAID'].includes(status))return{ignored:true,reason:'Expense is not posted.',payload:{expense_claim:claim}};
    const currentLines=await expenseClaimLines(row.source_record_id),linesSnap=Array.isArray(row?.payload_json?.lines)&&row.payload_json.lines.length?row.payload_json.lines:currentLines;
    if(!linesSnap.length)throw new Error('Posted expense has no lines.');
    const journalLines=[],taxBuckets=new Map();let control=0;
    for(const l of linesSnap){
      const acct=await glAccountById(l.posting_account_id);if(!acct||acct.active===false||!['EXPENSE','ASSET'].includes(String(acct.account_type||'').toUpperCase()))throw new Error('Expense posting account is missing, inactive, or invalid.');
      const sub=MONEY(l.line_subtotal),tax=MONEY(l.tax_amount),rec=MONEY(l.recoverable_tax),non=MONEY(l.nonrecoverable_tax),base=MONEY(sub+non);
      if(base>0)journalLines.push({code:acct.code,debit:base,description:`Expense ${claim.expense_number||current.expense_number} · ${l.description||acct.name}`});
      if(rec>0){const tc=await taxCodeById(l.tax_code_id),kind=String(tc?.tax_kind||'GST').toUpperCase(),code=kind==='QST'?(rule.configuration_json?.qst_recoverable_account||'1210'):(rule.tax_account_code||'1200');taxBuckets.set(code,MONEY((taxBuckets.get(code)||0)+rec));}
      control=MONEY(control+sub+tax);
    }
    for(const [code,amount] of taxBuckets)journalLines.push({code,debit:amount,description:`Recoverable expense tax ${claim.expense_number||current.expense_number}`});
    const expected=MONEY(claim.total||current.total);if(Math.abs(control-expected)>0.02)throw new Error(`Expense lines ${control.toFixed(2)} do not match expense total ${expected.toFixed(2)}.`);
    if(String(claim.payment_mode||current.payment_mode).toUpperCase()==='REIMBURSEMENT')journalLines.push({code:rule.configuration_json?.reimbursement_payable_account||'2020',credit:expected,description:`Reimbursement payable ${claim.expense_number||current.expense_number}`});
    else{const fin=await financialAccount(claim.financial_account_id||current.financial_account_id);if(!fin||fin.active===false)throw new Error('Expense financial account is missing or inactive.');const gl=await glAccountById(fin.gl_account_id);if(!gl||gl.active===false)throw new Error('Expense financial-account GL mapping is missing or inactive.');journalLines.push({code:gl.code,credit:expected,description:`Company-paid expense via ${fin.name}`});}
    return{payload:{expense_claim:claim,lines:linesSnap},entryDate:String(claim.posting_date||current.posting_date||row.occurred_at||new Date().toISOString()).slice(0,10),memo:`Expense posted ${claim.expense_number||current.expense_number}`,lines:journalLines};
  }

  if(type==='EXPENSE_REIMBURSEMENT_PAID'){
    const current=await expenseReimbursement(row.source_record_id);if(!current)throw new Error('Expense reimbursement source record not found.');
    const pay=snap(row,'expense_reimbursement',current);if(String(current.status||pay.status||'').toUpperCase()!=='PAID')return{ignored:true,reason:'Expense reimbursement is not PAID.',payload:{expense_reimbursement:pay}};
    const claimId=pay.expense_claim_id||current.expense_claim_id,dep=`PLEASE:EXPENSE_POSTED:${claimId}`;if(!(await dependencyPosted(dep)))throw new Error(`Dependency pending: ${dep}`);
    const claim=await expenseClaim(claimId);if(!claim)throw new Error('Expense not found for reimbursement.');
    const fin=await financialAccount(pay.financial_account_id||current.financial_account_id);if(!fin||fin.active===false)throw new Error('Reimbursement financial account is missing or inactive.');const gl=await glAccountById(fin.gl_account_id);if(!gl||gl.active===false)throw new Error('Reimbursement GL mapping is missing or inactive.');
    const amount=MONEY(pay.amount||current.amount);return{payload:{expense_claim:claim,expense_reimbursement:pay,financial_account:fin},entryDate:String(pay.payment_date||current.payment_date||row.occurred_at||new Date().toISOString()).slice(0,10),memo:`Expense reimbursement ${pay.reimbursement_number||current.reimbursement_number}`,lines:[{code:rule.debit_account_code||'2020',debit:amount,description:`Reduce reimbursement payable ${claim.expense_number}`},{code:gl.code,credit:amount,description:`Reimbursement via ${fin.name}`}]};
  }

  return{ignored:true,reason:`No automatic posting handler is configured for ${type}.`,payload:row.payload_json||{}};
}

async function ensureExternalForOutbox(row,payload,workerId){
  let evt=await external(row.event_key);
  const payloadHash=hashPayload(payload||{});
  if(evt?.posting_status==='POSTED'&&evt?.journal_entry_id)return{evt,duplicate:true};
  if(evt?.posting_status==='IGNORED')return{evt,duplicate:true};
  if(evt&&evt.payload_hash&&evt.payload_hash!==payloadHash&&evt.posting_status!=='POSTED'){
    await updateExternal(evt.id,{payload_json:payload||{},payload_hash:payloadHash,event_version:row.event_version||1,correlation_id:row.correlation_id||null,causation_id:row.causation_id||null,actor_id:row.actor_id||null,worker_id:workerId||null,error_message:null,posting_status:'PENDING'});
    evt=await external(row.event_key);
  }
  if(!evt){
    evt=await createExternal({source_system:SOURCE_SYSTEM,source_event_id:row.event_key,event_type:row.event_type,event_version:row.event_version||1,source_table:row.source_table||null,source_record_id:row.source_record_id||null,source_reference:row.source_reference||null,occurred_at:row.occurred_at||new Date().toISOString(),payload_json:payload||{},payload_hash:payloadHash,posting_status:'PENDING',correlation_id:row.correlation_id||null,causation_id:row.causation_id||null,actor_id:row.actor_id||null,worker_id:workerId||null});
  }
  if(!evt?.id)throw new Error('Accounting external event was not created.');
  return{evt,duplicate:false};
}

async function processOutboxEvent(row,{workerId='cal-worker'}={}){
  const started=Date.now();
  try{
    const posting=await buildPosting(row);
    const {evt,duplicate}=await ensureExternalForOutbox(row,posting.payload||row.payload_json||{},workerId);
    if(duplicate){
      const status=evt.posting_status==='IGNORED'?'IGNORED':'POSTED';
      await updateOutboxById(row.id,{status,cal_event_id:evt.id,cal_journal_entry_id:evt.journal_entry_id||null,last_error:null,processed_at:new Date().toISOString(),posted_at:status==='POSTED'?(evt.processed_at||new Date().toISOString()):null,processing_started_at:null,processing_by:null,last_duration_ms:Date.now()-started});
      return{ok:true,duplicate:true,status,event_id:evt.id,journal_entry_id:evt.journal_entry_id||null};
    }
    if(posting.ignored){
      await updateExternal(evt.id,{posting_status:'IGNORED',journal_entry_id:null,error_message:clean(posting.reason,1000),worker_id:workerId,duration_ms:Date.now()-started});
      await updateOutboxById(row.id,{status:'IGNORED',cal_event_id:evt.id,cal_journal_entry_id:null,last_error:clean(posting.reason,1000),processed_at:new Date().toISOString(),processing_started_at:null,processing_by:null,last_duration_ms:Date.now()-started});
      return{ok:true,status:'IGNORED',event_id:evt.id,reason:posting.reason};
    }
    const journalEntryId=await postJournal(evt,posting);
    await updateExternal(evt.id,{posting_status:'POSTED',journal_entry_id:journalEntryId,error_message:null,worker_id:workerId,duration_ms:Date.now()-started});
    await updateOutboxById(row.id,{status:'POSTED',cal_event_id:evt.id,cal_journal_entry_id:journalEntryId,last_error:null,posted_at:new Date().toISOString(),processed_at:new Date().toISOString(),processing_started_at:null,processing_by:null,last_duration_ms:Date.now()-started});
    return{ok:true,status:'POSTED',event_id:evt.id,journal_entry_id:journalEntryId};
  }catch(e){
    const message=clean(e.message||e,1000);
    const dependencyPending=message.startsWith('Dependency pending:');
    const attempts=Math.max(1,Number(row.attempts||1));
    const effectiveAttempts=dependencyPending?Math.max(0,attempts-1):attempts;
    const maxAttempts=Math.max(1,Math.min(20,Number(process.env.CAL_ACCOUNTING_MAX_ATTEMPTS||5)));
    const dead=!dependencyPending&&effectiveAttempts>=maxAttempts;
    const next=new Date(Date.now()+sleepMs(Math.max(1,effectiveAttempts))).toISOString();
    await updateOutboxById(row.id,{status:dead?'DEAD_LETTER':'RETRY',attempts:effectiveAttempts,last_error:message,next_attempt_at:dead?null:next,dead_letter_at:dead?new Date().toISOString():null,processed_at:dead?new Date().toISOString():null,processing_started_at:null,processing_by:null,last_duration_ms:Date.now()-started});
    try{const evt=await external(row.event_key);if(evt?.id&&evt.posting_status!=='POSTED')await updateExternal(evt.id,{posting_status:'ERROR',error_message:message,worker_id:workerId,duration_ms:Date.now()-started});}catch{}
    if(!schemaMissing(e))console.error('cal-accounting-event',row.event_key,e);
    return{ok:false,status:dead?'DEAD_LETTER':'RETRY',error:message};
  }
}

async function releaseStaleClaims(minutes=10){
  try{return await safeSb('/rest/v1/rpc/accounting_release_stale_claims',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_stale_minutes:minutes})});}
  catch(e){if(schemaMissing(e))return 0;throw e;}
}
async function claimEvents(limit=25,workerId='cal-worker'){
  return await safeSb('/rest/v1/rpc/accounting_claim_outbox',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_limit:Math.max(1,Math.min(100,Number(limit)||25)),p_worker_id:workerId})});
}
async function runWorker({limit=25,workerId=`netlify-${crypto.randomBytes(4).toString('hex')}`}={}){
  if(!enabled())return{ok:true,enabled:false,claimed:0,posted:0,ignored:0,retried:0,dead_letter:0};
  await releaseStaleClaims(Number(process.env.CAL_ACCOUNTING_STALE_MINUTES||10)).catch(e=>console.warn('cal-release-stale',e?.message||e));
  let rows=[];
  try{rows=await claimEvents(limit,workerId)||[];}catch(e){if(schemaMissing(e))return{ok:false,schema_missing:true,error:e.message||String(e),claimed:0};throw e;}
  const priority={INVOICE_ISSUED:10,PROVIDER_PAYABLE_CREATED:10,VENDOR_BILL_POSTED:10,EXPENSE_POSTED:10,PAYMENT_RECEIVED:20,INVOICE_VOIDED:30,PROVIDER_PAYMENT_PAID:30,SUPPLIER_PAYMENT_PAID:30,EXPENSE_REIMBURSEMENT_PAID:30,STRIPE_FEE_RECORDED:40};
  rows=[...rows].sort((a,b)=>(priority[String(a.event_type||'').toUpperCase()]||100)-(priority[String(b.event_type||'').toUpperCase()]||100)||String(a.occurred_at||a.created_at||'').localeCompare(String(b.occurred_at||b.created_at||'')));
  const summary={ok:true,enabled:true,worker_id:workerId,claimed:rows.length,posted:0,ignored:0,duplicates:0,retried:0,dead_letter:0,errors:[]};
  for(const row of rows){
    const r=await processOutboxEvent(row,{workerId});
    if(r.duplicate)summary.duplicates++;
    if(r.status==='POSTED')summary.posted++;
    else if(r.status==='IGNORED')summary.ignored++;
    else if(r.status==='RETRY')summary.retried++;
    else if(r.status==='DEAD_LETTER')summary.dead_letter++;
    if(!r.ok)summary.errors.push({event_key:row.event_key,error:r.error,status:r.status});
  }
  return summary;
}

// Recovery scanner: idempotently rebuilds MISSING durable queue events only.
// It never posts journals directly and is not part of normal Admin workflow.
async function enqueueLegacy(type,sourceTable,id,reference,payload,occurredAt,correlationId=null,causationId=null){
  try{
    return await safeSb('/rest/v1/rpc/accounting_enqueue_event',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_event_type:type,p_source_table:sourceTable,p_source_record_id:String(id),p_source_reference:reference||String(id),p_payload:payload||{},p_occurred_at:occurredAt||new Date().toISOString(),p_event_version:1,p_actor_id:null,p_correlation_id:correlationId,p_causation_id:causationId})});
  }catch(e){if(schemaMissing(e))return null;throw e;}
}
async function reconcile(limit=200){
  const max=Math.max(25,Math.min(500,Number(limit)||200));
  const summary={queued:0,invoices:0,payments:0,provider_payments:0,supplier_bills:0,supplier_payments:0,credit_notes:0,refunds:0,expenses:0,expense_reimbursements:0,errors:[]};
  const invoices=await safeSb(`/rest/v1/invoices?select=*&status=in.(ISSUED,SENT,OVERDUE,PAID,VOID)&order=created_at.asc&limit=${max}`).catch(e=>{summary.errors.push(e.message);return[];});
  for(const inv of invoices||[]){
    try{
      if(inv.status!=='VOID'||inv.issued_at||inv.sent_at){await enqueueLegacy('INVOICE_ISSUED','invoices',inv.id,inv.invoice_number,{invoice:inv},inv.issued_at||inv.sent_at||inv.created_at,inv.job_id||inv.id);summary.queued++;summary.invoices++;}
      if(inv.status==='VOID'){await enqueueLegacy('INVOICE_VOIDED','invoices',inv.id,inv.invoice_number,{invoice:inv,previous_status:'RECOVERY_SCAN'},inv.voided_at||inv.updated_at||inv.created_at,inv.job_id||inv.id,`PLEASE:INVOICE_ISSUED:${inv.id}`);summary.queued++;}
    }catch(e){summary.errors.push(e.message||String(e));}
  }
  const txs=await safeSb(`/rest/v1/payment_transactions?select=*&status=eq.SUCCEEDED&order=created_at.asc&limit=${max}`).catch(e=>{summary.errors.push(e.message);return[];});
  for(const tx of txs||[]){try{await enqueueLegacy('PAYMENT_RECEIVED','payment_transactions',tx.id,tx.external_reference||tx.id,{payment_transaction:tx},tx.created_at,tx.invoice_id||tx.id);summary.queued++;summary.payments++;if(String(tx.provider).toUpperCase()==='STRIPE'&&parseFee(tx)>0){await enqueueLegacy('STRIPE_FEE_RECORDED','payment_transactions',tx.id,tx.external_reference||tx.id,{payment_transaction:tx,fee_amount:parseFee(tx)},tx.created_at,tx.invoice_id||tx.id,`PLEASE:PAYMENT_RECEIVED:${tx.id}`);summary.queued++;}}catch(e){summary.errors.push(e.message||String(e));}}
  const pps=await safeSb(`/rest/v1/provider_payments?select=*&amount=gt.0&needs_rate_review=eq.false&order=created_at.asc&limit=${max}`).catch(e=>{summary.errors.push(e.message);return[];});
  for(const p of pps||[]){try{await enqueueLegacy('PROVIDER_PAYABLE_CREATED','provider_payments',p.id,p.payment_reference||p.id,{provider_payment:p},p.created_at,p.job_id||p.id);summary.queued++;summary.provider_payments++;if(p.status==='PAID'){await enqueueLegacy('PROVIDER_PAYMENT_PAID','provider_payments',p.id,p.payment_reference||p.id,{provider_payment:p},p.paid_at||p.updated_at||p.created_at,p.job_id||p.id,`PLEASE:PROVIDER_PAYABLE_CREATED:${p.id}`);summary.queued++;}}catch(e){summary.errors.push(e.message||String(e));}}
  const bills=await safeSb(`/rest/v1/accounting_supplier_bills?select=*&status=in.(POSTED,PARTIAL,PAID)&order=created_at.asc&limit=${max}`).catch(e=>{if(!schemaMissing(e))summary.errors.push(e.message);return[];});
  for(const b of bills||[]){try{const lines=await supplierBillLines(b.id);await enqueueLegacy('VENDOR_BILL_POSTED','accounting_supplier_bills',b.id,b.bill_number,{supplier_bill:b,lines},b.posted_at||b.updated_at||b.created_at,b.id);summary.queued++;summary.supplier_bills++;}catch(e){summary.errors.push(e.message||String(e));}}
  const sps=await safeSb(`/rest/v1/accounting_supplier_payments?select=*&status=eq.PAID&order=created_at.asc&limit=${max}`).catch(e=>{if(!schemaMissing(e))summary.errors.push(e.message);return[];});
  for(const p of sps||[]){try{await enqueueLegacy('SUPPLIER_PAYMENT_PAID','accounting_supplier_payments',p.id,p.payment_number,{supplier_payment:p},p.paid_at||p.created_at,p.supplier_bill_id,`PLEASE:VENDOR_BILL_POSTED:${p.supplier_bill_id}`);summary.queued++;summary.supplier_payments++;}catch(e){summary.errors.push(e.message||String(e));}}
  const cns=await safeSb(`/rest/v1/accounting_credit_notes?select=*&status=eq.POSTED&order=created_at.asc&limit=${max}`).catch(e=>{if(!schemaMissing(e))summary.errors.push(e.message);return[];});
  for(const n of cns||[]){try{const lines=await creditNoteLines(n.id),inv=await accountingInvoice(n.invoice_id),cause=inv?.source_invoice_id?`PLEASE:INVOICE_ISSUED:${inv.source_invoice_id}`:null;await enqueueLegacy('CREDIT_NOTE_ISSUED','accounting_credit_notes',n.id,n.credit_note_number,{credit_note:n,lines},n.posted_at||n.updated_at||n.created_at,n.invoice_id,cause);summary.queued++;summary.credit_notes++;}catch(e){summary.errors.push(e.message||String(e));}}
  const refs=await safeSb(`/rest/v1/accounting_customer_refunds?select=*&status=eq.COMPLETED&order=created_at.asc&limit=${max}`).catch(e=>{if(!schemaMissing(e))summary.errors.push(e.message);return[];});
  for(const r of refs||[]){try{await enqueueLegacy('REFUND_COMPLETED','accounting_customer_refunds',r.id,r.refund_number,{customer_refund:r},r.completed_at||r.created_at,r.customer_party_id,r.credit_note_id?`PLEASE:CREDIT_NOTE_ISSUED:${r.credit_note_id}`:null);summary.queued++;summary.refunds++;}catch(e){summary.errors.push(e.message||String(e));}}
  const exps=await safeSb(`/rest/v1/accounting_expense_claims?select=*&status=in.(POSTED,PAID)&order=created_at.asc&limit=${max}`).catch(e=>{if(!schemaMissing(e))summary.errors.push(e.message);return[];});
  for(const x of exps||[]){try{const lines=await expenseClaimLines(x.id);await enqueueLegacy('EXPENSE_POSTED','accounting_expense_claims',x.id,x.expense_number,{expense_claim:x,lines},x.posted_at||x.updated_at||x.created_at,x.id);summary.queued++;summary.expenses++;}catch(e){summary.errors.push(e.message||String(e));}}
  const ers=await safeSb(`/rest/v1/accounting_expense_reimbursements?select=*&status=eq.PAID&order=created_at.asc&limit=${max}`).catch(e=>{if(!schemaMissing(e))summary.errors.push(e.message);return[];});
  for(const r of ers||[]){try{await enqueueLegacy('EXPENSE_REIMBURSEMENT_PAID','accounting_expense_reimbursements',r.id,r.reimbursement_number,{expense_reimbursement:r},r.paid_at||r.created_at,r.expense_claim_id,`PLEASE:EXPENSE_POSTED:${r.expense_claim_id}`);summary.queued++;summary.expense_reimbursements++;}catch(e){summary.errors.push(e.message||String(e));}}
  return summary;
}

// Backward-compatible exports. They enqueue only; they do not post synchronously.
async function handleInvoiceIssued(id){const inv=await invoice(id);return inv?enqueueLegacy('INVOICE_ISSUED','invoices',id,inv.invoice_number,{invoice:inv},inv.issued_at||inv.sent_at||inv.created_at,inv.job_id||id):null;}
async function handleInvoiceVoided(id){const inv=await invoice(id);return inv?enqueueLegacy('INVOICE_VOIDED','invoices',id,inv.invoice_number,{invoice:inv,previous_status:'LEGACY_CALL'},inv.voided_at||inv.updated_at||new Date().toISOString(),inv.job_id||id,`PLEASE:INVOICE_ISSUED:${id}`):null;}
async function handlePaymentTransaction(id){const tx=await paymentTx(id);return tx?enqueueLegacy('PAYMENT_RECEIVED','payment_transactions',id,tx.external_reference||id,{payment_transaction:tx},tx.created_at,tx.invoice_id||id):null;}
async function handleInvoicePaid(id){const rows=await safeSb(`/rest/v1/payment_transactions?select=id&invoice_id=eq.${enc(id)}&status=eq.SUCCEEDED&order=created_at.desc&limit=1`).catch(()=>[]);return rows?.[0]?.id?handlePaymentTransaction(rows[0].id):null;}
async function handleProviderPayableCreated(id){const p=await providerPayment(id);return p?enqueueLegacy('PROVIDER_PAYABLE_CREATED','provider_payments',id,p.payment_reference||id,{provider_payment:p},p.created_at,p.job_id||id):null;}
async function handleProviderPaymentPaid(id){const p=await providerPayment(id);return p?enqueueLegacy('PROVIDER_PAYMENT_PAID','provider_payments',id,p.payment_reference||id,{provider_payment:p},p.paid_at||p.updated_at||p.created_at,p.job_id||id,`PLEASE:PROVIDER_PAYABLE_CREATED:${id}`):null;}

module.exports={MONEY,enabled,runWorker,processOutboxEvent,reconcile,handleInvoiceIssued,handleInvoiceVoided,handleInvoicePaid,handlePaymentTransaction,handleProviderPayableCreated,handleProviderPaymentPaid};
