const lib=require('./_admin-lib');
const {enabled}=require('./_cal-accounting-lib');
const AGREEMENT_VERSION='CAL-LEGAL-1.0-2026-09-05';
const enc=v=>encodeURIComponent(String(v??''));
const MONEY=n=>Math.round((Number(n)||0)*100)/100;
async function safe(label,fn,fallback=[]){try{return await fn()}catch(e){console.warn('cal-dashboard-data',label,e?.message||e);return fallback;}}
function entryNo(e){return e?.entry_number||e?.id||'';}
function dateOf(v){return v?String(v).slice(0,10):'';}
function partyName(p){return p?.display_name||p?.legal_name||p?.party_number||'';}
function txAudit(events=[],outbox=[]){
  const rows=[];
  for(const e of events||[])rows.push({at:e.processed_at||e.created_at||e.occurred_at,actor:'PLEASE Accounting Engine',action:e.event_type,object:e.source_reference||e.source_record_id||e.source_table,detail:e.posting_status+(e.error_message?` · ${e.error_message}`:'')});
  for(const o of outbox||[])if(['RETRY','ERROR','DEAD_LETTER'].includes(String(o.status||'')))rows.push({at:o.updated_at||o.created_at,actor:'PLEASE Durable Queue',action:o.event_type,object:o.source_reference||o.source_record_id,detail:(o.status||'')+(o.last_error?` · ${o.last_error}`:'')});
  return rows.sort((a,b)=>String(b.at||'').localeCompare(String(a.at||''))).slice(0,250);
}
function normalizeHealth(raw,outbox=[]){
  const h=Array.isArray(raw)?(raw[0]||{}):(raw||{});
  if(h&&typeof h==='object'&&Object.keys(h).length)return h;
  const ready=(outbox||[]).filter(x=>['PENDING','RETRY','ERROR','PROCESSING'].includes(x.status));
  const last=(outbox||[]).find(x=>['POSTED','IGNORED','DEAD_LETTER'].includes(x.status));
  return{status:(outbox||[]).some(x=>x.status==='DEAD_LETTER')?'ACTION_REQUIRED':((outbox||[]).some(x=>['RETRY','ERROR'].includes(x.status))?'DEGRADED':'HEALTHY'),pending:(outbox||[]).filter(x=>x.status==='PENDING').length,processing:(outbox||[]).filter(x=>x.status==='PROCESSING').length,retrying:(outbox||[]).filter(x=>['RETRY','ERROR'].includes(x.status)).length,dead_letter:(outbox||[]).filter(x=>x.status==='DEAD_LETTER').length,processed_today:(outbox||[]).filter(x=>['POSTED','IGNORED'].includes(x.status)&&String(x.processed_at||x.posted_at||'').slice(0,10)===new Date().toISOString().slice(0,10)).length,average_ms:0,oldest_pending_at:ready.map(x=>x.created_at).filter(Boolean).sort()[0]||null,last_event:last?{event_type:last.event_type,source_reference:last.source_reference,status:last.status,processed_at:last.processed_at||last.posted_at,occurred_at:last.occurred_at}:null};
}
exports.handler=async event=>{
  if(event.httpMethod!=='GET')return lib.json(405,{error:'Method not allowed'});
  try{
    const auth=await lib.requireAdmin(event);
    const [legal,company,accounts,entries,lines,invoices,expenses,advancedExpenses,advancedExpenseLines,payments,creditNotes,refunds,parties,operationalInvoices,events,outbox,healthRaw]=await Promise.all([
      safe('legal',()=>lib.sbJson(`/rest/v1/accounting_legal_acceptances?select=id,accepted_at,signer_name,signer_email,agreement_version&external_user_id=eq.${enc(auth.user.id)}&agreement_version=eq.${enc(AGREEMENT_VERSION)}&order=accepted_at.desc&limit=1`),[]),
      safe('company',()=>lib.sbJson('/rest/v1/accounting_company?select=*&limit=1'),[]),
      safe('accounts',()=>lib.sbJson('/rest/v1/accounting_accounts?select=id,code,name,account_type,active&order=code.asc'),[]),
      safe('entries',()=>lib.sbJson('/rest/v1/accounting_journal_entries?select=id,entry_number,entry_date,memo,status,source_type,source_id,posted_at,created_at&order=entry_date.desc,created_at.desc&limit=500'),[]),
      safe('lines',()=>lib.sbJson('/rest/v1/accounting_journal_lines?select=id,journal_entry_id,account_id,debit,credit,description'),[]),
      safe('invoices',()=>lib.sbJson('/rest/v1/accounting_invoices?select=id,invoice_number,party_id,source_invoice_id,invoice_date,due_date,status,subtotal,tax_total,total,paid_total,currency,source_reference,created_at&order=invoice_date.desc,created_at.desc&limit=500'),[]),
      safe('expenses',()=>lib.sbJson('/rest/v1/accounting_expenses?select=id,expense_number,expense_date,status,subtotal,tax_total,total,recoverable_tax,description,source_reference,created_at&order=expense_date.desc,created_at.desc&limit=500'),[]),
      safe('advancedExpenses',()=>lib.sbJson('/rest/v1/accounting_expense_claims?select=id,expense_number,expense_date,vendor_party_id,payee_party_id,payment_mode,status,subtotal,tax_total,recoverable_tax,total,description,reference,created_at&status=in.(POSTED,PAID)&order=expense_date.desc,created_at.desc&limit=500'),[]),
      safe('advancedExpenseLines',()=>lib.sbJson('/rest/v1/accounting_expense_claim_lines?select=expense_claim_id,classification,line_subtotal,nonrecoverable_tax,recoverable_tax&order=expense_claim_id.asc'),[]),
      safe('payments',()=>lib.sbJson('/rest/v1/accounting_payments?select=id,invoice_id,payment_date,amount,method,reference,created_at&order=payment_date.desc,created_at.desc&limit=1000'),[]),
      safe('creditNotes',()=>lib.sbJson('/rest/v1/accounting_credit_notes?select=id,credit_note_number,invoice_id,customer_party_id,credit_date,status,subtotal_reduction,tax_reduction,total,currency,posted_at,created_at&status=eq.POSTED&order=credit_date.desc,created_at.desc&limit=1000'),[]),
      safe('refunds',()=>lib.sbJson('/rest/v1/accounting_customer_refunds?select=id,refund_number,customer_party_id,financial_account_id,refund_date,amount,currency,method,reference,status,completed_at,created_at&status=eq.COMPLETED&order=refund_date.desc,created_at.desc&limit=1000'),[]),
      safe('parties',()=>lib.sbJson('/rest/v1/accounting_parties?select=id,party_number,legal_name,display_name,email,source_system,source_table,source_record_id,active&order=legal_name.asc'),[]),
      safe('operationalInvoices',()=>lib.sbJson('/rest/v1/invoices?select=id,invoice_number,customer_id,client_name,client_email,status&order=created_at.desc&limit=500'),[]),
      safe('events',()=>lib.sbJson('/rest/v1/accounting_external_events?select=id,event_type,event_version,source_table,source_record_id,source_reference,occurred_at,posting_status,journal_entry_id,error_message,correlation_id,causation_id,actor_id,worker_id,duration_ms,created_at,processed_at&source_system=eq.PLEASE&order=created_at.desc&limit=500'),[]),
      safe('outbox',()=>lib.sbJson('/rest/v1/please_accounting_outbox?select=id,event_key,event_type,event_version,source_record_id,source_reference,occurred_at,status,attempts,last_error,correlation_id,processing_by,created_at,updated_at,posted_at,processed_at,dead_letter_at,last_duration_ms&order=created_at.desc&limit=1500'),[]),
      safe('health',()=>lib.sbJson('/rest/v1/rpc/accounting_engine_health',{method:'POST',headers:{Prefer:'return=representation'},body:'{}'}),{})
    ]);
    const lineByEntry=new Map();
    for(const l of lines||[]){if(!lineByEntry.has(l.journal_entry_id))lineByEntry.set(l.journal_entry_id,[]);lineByEntry.get(l.journal_entry_id).push(l);}
    const journals=(entries||[]).map(e=>{const ls=lineByEntry.get(e.id)||[];return{id:entryNo(e),date:dateOf(e.entry_date),memo:e.memo,debits:MONEY(ls.reduce((n,l)=>n+Number(l.debit||0),0)),credits:MONEY(ls.reduce((n,l)=>n+Number(l.credit||0),0)),status:e.status,lines:ls};});
    const partyMap=new Map((parties||[]).map(p=>[p.id,p]));
    const opMap=new Map((operationalInvoices||[]).map(i=>[i.invoice_number,i]));
    const paidByInvoice=new Map();
    for(const p of payments||[])if(p.invoice_id)paidByInvoice.set(p.invoice_id,MONEY((paidByInvoice.get(p.invoice_id)||0)+Number(p.amount||0)));
    const creditsByInvoice=new Map();
    for(const n of creditNotes||[])if(n.invoice_id)creditsByInvoice.set(n.invoice_id,MONEY((creditsByInvoice.get(n.invoice_id)||0)+Number(n.total||0)));
    const calInvoices=(invoices||[]).map(x=>{
      const paid=MONEY(paidByInvoice.get(x.id)||0),credited=MONEY(creditsByInvoice.get(x.id)||0),raw=MONEY(Number(x.total||0)-paid-credited),balance=Math.max(0,raw),p=partyMap.get(x.party_id),op=opMap.get(x.invoice_number)||{};
      const status=x.status==='VOID'?'VOID':balance>0?(paid+credited>0?'PARTIAL':'OPEN'):(credited>0?(credited+0.001>=Number(x.total||0)&&paid===0?'CREDITED':'SETTLED'):'PAID');
      return{id:x.invoice_number,date:dateOf(x.invoice_date),dueDate:dateOf(x.due_date),customer:partyName(p)||op.client_name||x.source_reference||x.invoice_number,customerEmail:p?.email||op.client_email||'',partyId:x.party_id||null,subtotal:MONEY(x.subtotal),tax:MONEY(x.tax_total),total:MONEY(x.total),paid,credited,balance:MONEY(balance),status};
    });
    const calCredits=(creditNotes||[]).map(x=>({id:x.credit_note_number,date:dateOf(x.credit_date),invoiceId:x.invoice_id,partyId:x.customer_party_id,subtotal:MONEY(x.subtotal_reduction),tax:MONEY(x.tax_reduction),total:MONEY(x.total),status:x.status}));
    const calRefunds=(refunds||[]).map(x=>({id:x.refund_number,date:dateOf(x.refund_date),partyId:x.customer_party_id,amount:MONEY(x.amount),method:x.method||'REFUND',reference:x.reference||''}));
    const bank=[...(payments||[]).map(x=>({id:x.id,date:dateOf(x.payment_date),description:x.reference||x.method||'Payment',amount:MONEY(x.amount),type:'CREDIT',matched:true})),...(refunds||[]).map(x=>({id:x.id,date:dateOf(x.refund_date),description:x.reference||x.refund_number||'Customer refund',amount:MONEY(x.amount),type:'DEBIT',matched:true}))].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    const advancedExpensePnl=new Map(),advancedExpenseItc=new Map();for(const l of advancedExpenseLines||[]){if(String(l.classification||'EXPENSE').toUpperCase()==='EXPENSE')advancedExpensePnl.set(l.expense_claim_id,MONEY((advancedExpensePnl.get(l.expense_claim_id)||0)+Number(l.line_subtotal||0)+Number(l.nonrecoverable_tax||0)));advancedExpenseItc.set(l.expense_claim_id,MONEY((advancedExpenseItc.get(l.expense_claim_id)||0)+Number(l.recoverable_tax||0)));}
    const calExpenses=[...(expenses||[]).map(x=>({id:x.expense_number,date:dateOf(x.expense_date),vendor:x.source_reference||'PLEASE Operations',category:x.description||'Operating expense',subtotal:MONEY(x.subtotal),tax:MONEY(x.tax_total),total:MONEY(x.total),status:x.status})),...(advancedExpenses||[]).map(x=>{const vendor=partyMap.get(x.vendor_party_id),payee=partyMap.get(x.payee_party_id);return{id:x.expense_number,date:dateOf(x.expense_date),vendor:partyName(vendor)||partyName(payee)||x.reference||'Direct expense',category:x.description||'Advanced expense',subtotal:MONEY(advancedExpensePnl.get(x.id)||0),tax:MONEY(advancedExpenseItc.get(x.id)||0),total:MONEY(x.total),status:x.status};})].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    const partyAgg=new Map();
    for(const x of invoices||[]){if(!x.party_id||x.status==='VOID')continue;const a=partyAgg.get(x.party_id)||{invoice:0,payment:0,credit:0,refund:0};a.invoice=MONEY(a.invoice+Number(x.total||0));partyAgg.set(x.party_id,a);}
    for(const p of payments||[]){const inv=(invoices||[]).find(x=>x.id===p.invoice_id);if(!inv?.party_id||inv.status==='VOID')continue;const a=partyAgg.get(inv.party_id)||{invoice:0,payment:0,credit:0,refund:0};a.payment=MONEY(a.payment+Number(p.amount||0));partyAgg.set(inv.party_id,a);}
    for(const n of creditNotes||[]){const a=partyAgg.get(n.customer_party_id)||{invoice:0,payment:0,credit:0,refund:0};a.credit=MONEY(a.credit+Number(n.total||0));partyAgg.set(n.customer_party_id,a);}
    for(const r of refunds||[]){const a=partyAgg.get(r.customer_party_id)||{invoice:0,payment:0,credit:0,refund:0};a.refund=MONEY(a.refund+Number(r.amount||0));partyAgg.set(r.customer_party_id,a);}
    let openAR=0,customerCredits=0;for(const a of partyAgg.values()){const net=MONEY(a.invoice-a.payment-a.credit+a.refund);if(net>0)openAR=MONEY(openAR+net);if(net<0)customerCredits=MONEY(customerCredits-net);}
    const activeCompany=company?.[0]||{},health=normalizeHealth(healthRaw,outbox);
    const bridge={enabled:enabled(),mode:'EVENT_DRIVEN',status:enabled()?(health.status||'HEALTHY'):'PAUSED',pending:Number(health.pending||0),processing:Number(health.processing||0),retrying:Number(health.retrying||0),deadLetter:Number(health.dead_letter||0),processedToday:Number(health.processed_today||0),averageMs:Number(health.average_ms||0),oldestPendingAt:health.oldest_pending_at||null,lastEvent:health.last_event||null,posted:(events||[]).filter(x=>x.posting_status==='POSTED').length};
    return lib.json(200,{session:{user:{id:auth.user.id,email:auth.user.email,display_name:auth.user.display_name,role:auth.user.role},legalAccepted:Boolean(legal?.length),agreementVersion:AGREEMENT_VERSION},data:{company:{legalName:activeCompany.legal_name||'PLEASE Services',operatingName:activeCompany.operating_name||'PLEASE Services',businessNumber:activeCompany.business_number||'',province:activeCompany.province||'AB',fiscalYearEnd:activeCompany.fiscal_year_end||'12-31',currency:activeCompany.currency||'CAD',gstRegistered:activeCompany.gst_registered!==false,gstNumber:activeCompany.sales_tax_account_number||'',storageMode:'PLEASE_SUPABASE_CONNECTED',retentionYears:Math.max(6,Number(activeCompany.retention_years||6))},accounts:(accounts||[]).map((a,i)=>({id:a.id||i+1,code:a.code,name:a.name,type:a.account_type,active:a.active!==false})),invoices:calInvoices,creditNotes:calCredits,refunds:calRefunds,receivables:{openAR,customerCredits},expenses:calExpenses,bank,journals,audit:txAudit(events,outbox),documents:[],legalAcceptances:legal||[],externalEvents:events||[],outbox:outbox||[],bridge}});
  }catch(e){console.error('cal-dashboard-data',e);return lib.json(e.status||500,{error:e.status===401?'Unauthorized':(e.message||'Unable to load CAL data.')});}
};
