const lib=require('./_admin-lib');
const {enabled}=require('./_cal-accounting-lib');
const AGREEMENT_VERSION='CAL-LEGAL-1.0-2026-09-05';
const enc=v=>encodeURIComponent(String(v??''));
const MONEY=n=>Math.round((Number(n)||0)*100)/100;
async function safe(label,fn,fallback=[]){try{return await fn()}catch(e){console.warn('cal-dashboard-data',label,e?.message||e);return fallback;}}
function entryNo(e){return e?.entry_number||e?.id||'';}
function dateOf(v){return v?String(v).slice(0,10):'';}
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
    const [legal,company,accounts,entries,lines,invoices,expenses,payments,events,outbox,healthRaw]=await Promise.all([
      safe('legal',()=>lib.sbJson(`/rest/v1/accounting_legal_acceptances?select=id,accepted_at,signer_name,signer_email,agreement_version&external_user_id=eq.${enc(auth.user.id)}&agreement_version=eq.${enc(AGREEMENT_VERSION)}&order=accepted_at.desc&limit=1`),[]),
      safe('company',()=>lib.sbJson('/rest/v1/accounting_company?select=*&limit=1'),[]),
      safe('accounts',()=>lib.sbJson('/rest/v1/accounting_accounts?select=id,code,name,account_type,active&order=code.asc'),[]),
      safe('entries',()=>lib.sbJson('/rest/v1/accounting_journal_entries?select=id,entry_number,entry_date,memo,status,source_type,source_id,posted_at,created_at&order=entry_date.desc,created_at.desc&limit=250'),[]),
      safe('lines',()=>lib.sbJson('/rest/v1/accounting_journal_lines?select=id,journal_entry_id,account_id,debit,credit,description'),[]),
      safe('invoices',()=>lib.sbJson('/rest/v1/accounting_invoices?select=id,invoice_number,invoice_date,due_date,status,subtotal,tax_total,total,paid_total,currency,source_reference,created_at&order=invoice_date.desc,created_at.desc&limit=250'),[]),
      safe('expenses',()=>lib.sbJson('/rest/v1/accounting_expenses?select=id,expense_number,expense_date,status,subtotal,tax_total,total,recoverable_tax,description,source_reference,created_at&order=expense_date.desc,created_at.desc&limit=250'),[]),
      safe('payments',()=>lib.sbJson('/rest/v1/accounting_payments?select=id,invoice_id,payment_date,amount,method,reference,created_at&order=payment_date.desc,created_at.desc&limit=250'),[]),
      safe('events',()=>lib.sbJson('/rest/v1/accounting_external_events?select=id,event_type,event_version,source_table,source_record_id,source_reference,occurred_at,posting_status,journal_entry_id,error_message,correlation_id,causation_id,actor_id,worker_id,duration_ms,created_at,processed_at&source_system=eq.PLEASE&order=created_at.desc&limit=250'),[]),
      safe('outbox',()=>lib.sbJson('/rest/v1/please_accounting_outbox?select=id,event_key,event_type,event_version,source_record_id,source_reference,occurred_at,status,attempts,last_error,correlation_id,processing_by,created_at,updated_at,posted_at,processed_at,dead_letter_at,last_duration_ms&order=created_at.desc&limit=1000'),[]),
      safe('health',()=>lib.sbJson('/rest/v1/rpc/accounting_engine_health',{method:'POST',headers:{Prefer:'return=representation'},body:'{}'}),{})
    ]);
    const lineByEntry=new Map();
    for(const l of lines||[]){if(!lineByEntry.has(l.journal_entry_id))lineByEntry.set(l.journal_entry_id,[]);lineByEntry.get(l.journal_entry_id).push(l);}
    const journals=(entries||[]).map(e=>{const ls=lineByEntry.get(e.id)||[];return{id:entryNo(e),date:dateOf(e.entry_date),memo:e.memo,debits:MONEY(ls.reduce((n,l)=>n+Number(l.debit||0),0)),credits:MONEY(ls.reduce((n,l)=>n+Number(l.credit||0),0)),status:e.status,lines:ls};});
    const calInvoices=(invoices||[]).map(x=>({id:x.invoice_number,date:dateOf(x.invoice_date),customer:x.source_reference||x.invoice_number,subtotal:MONEY(x.subtotal),tax:MONEY(x.tax_total),total:MONEY(x.total),paid:MONEY(x.paid_total),status:x.status}));
    const calExpenses=(expenses||[]).map(x=>({id:x.expense_number,date:dateOf(x.expense_date),vendor:x.source_reference||'PLEASE Operations',category:x.description||'Operating expense',subtotal:MONEY(x.subtotal),tax:MONEY(x.tax_total),total:MONEY(x.total),status:x.status}));
    const bank=(payments||[]).map(x=>({id:x.id,date:dateOf(x.payment_date),description:x.reference||x.method||'Payment',amount:MONEY(x.amount),type:'CREDIT',matched:true}));
    const activeCompany=company?.[0]||{},health=normalizeHealth(healthRaw,outbox);
    const bridge={enabled:enabled(),mode:'EVENT_DRIVEN',status:enabled()?(health.status||'HEALTHY'):'PAUSED',pending:Number(health.pending||0),processing:Number(health.processing||0),retrying:Number(health.retrying||0),deadLetter:Number(health.dead_letter||0),processedToday:Number(health.processed_today||0),averageMs:Number(health.average_ms||0),oldestPendingAt:health.oldest_pending_at||null,lastEvent:health.last_event||null,posted:(events||[]).filter(x=>x.posting_status==='POSTED').length};
    return lib.json(200,{session:{user:{id:auth.user.id,email:auth.user.email,display_name:auth.user.display_name,role:auth.user.role},legalAccepted:Boolean(legal?.length),agreementVersion:AGREEMENT_VERSION},data:{company:{legalName:activeCompany.legal_name||'PLEASE Services',operatingName:activeCompany.operating_name||'PLEASE Services',businessNumber:activeCompany.business_number||'',province:activeCompany.province||'AB',fiscalYearEnd:activeCompany.fiscal_year_end||'12-31',currency:activeCompany.currency||'CAD',gstRegistered:activeCompany.gst_registered!==false,gstNumber:activeCompany.sales_tax_account_number||'',storageMode:'PLEASE_SUPABASE_CONNECTED',retentionYears:Math.max(6,Number(activeCompany.retention_years||6))},accounts:(accounts||[]).map((a,i)=>({id:a.id||i+1,code:a.code,name:a.name,type:a.account_type,active:a.active!==false})),invoices:calInvoices,expenses:calExpenses,bank,journals,audit:txAudit(events,outbox),documents:[],legalAcceptances:legal||[],externalEvents:events||[],outbox:outbox||[],bridge}});
  }catch(e){console.error('cal-dashboard-data',e);return lib.json(e.status||500,{error:e.status===401?'Unauthorized':(e.message||'Unable to load CAL data.')});}
};
