const lib=require('./_admin-lib');
const enc=v=>encodeURIComponent(String(v??''));
const clean=(v,n=1000)=>String(v??'').trim().slice(0,n);
const money=v=>Math.round((Number(v)||0)*100)/100;
const today=()=>new Date().toISOString().slice(0,10);
function bodyOf(event){try{return JSON.parse(event.body||'{}')}catch{const e=new Error('Invalid JSON body.');e.status=400;throw e}}
function bad(message,status=400){const e=new Error(message);e.status=status;throw e}
function rpcScalar(v){if(Array.isArray(v))v=v[0];if(v&&typeof v==='object'){const k=Object.keys(v);if(k.length===1)return v[k[0]];}return v}
function addDays(date,n){const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function lineEffect(line,accountType){return money(String(accountType||'').toUpperCase()==='LIABILITY'?Number(line.credit||0)-Number(line.debit||0):Number(line.debit||0)-Number(line.credit||0))}
async function safe(path,fallback=[]){try{return await lib.sbJson(path)}catch(e){if(/does not exist|schema cache|42P01|42703/i.test(String(e.message||e)))return fallback;throw e}}
async function audit(auth,event,objectType,objectId,eventType,afterData){try{await lib.sbJson('/rest/v1/accounting_audit_log',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({actor_user_id:null,event_type:eventType,object_type:objectType,object_id:String(objectId||''),after_data:afterData||null,metadata:{step:'18.5',source:'CAL_BANKING_API',please_admin_user_id:auth.user.id,actor_email:auth.user.email,ip:lib.requestIp(event)||null,user_agent:lib.requestUserAgent(event)||null}})});}catch(e){console.warn('cal-banking audit',e?.message||e)}}

async function coreLedger(){
  const [accounts,financialAccounts,entries,lines]=await Promise.all([
    lib.sbJson('/rest/v1/accounting_accounts?select=id,code,name,account_type,active&active=eq.true&order=code.asc'),
    lib.sbJson('/rest/v1/accounting_financial_accounts?select=id,name,financial_type,institution_name,account_last4,currency,gl_account_id,is_primary,active,source_reference&active=eq.true&order=is_primary.desc,name.asc'),
    lib.sbJson('/rest/v1/accounting_journal_entries?select=id,entry_number,entry_date,memo,status,source_type,source_id,posted_at,created_at&status=eq.POSTED&order=entry_date.desc,created_at.desc&limit=5000'),
    lib.sbJson('/rest/v1/accounting_journal_lines?select=id,journal_entry_id,account_id,debit,credit,description&limit=20000')
  ]);
  const am=new Map((accounts||[]).map(a=>[a.id,a])),em=new Map((entries||[]).map(e=>[e.id,e]));
  const fm=(financialAccounts||[]).map(f=>({...f,gl_account:am.get(f.gl_account_id)||null})).filter(f=>f.gl_account);
  const linesByAccount=new Map();for(const l of lines||[]){const e=em.get(l.journal_entry_id);if(!e)continue;if(!linesByAccount.has(l.account_id))linesByAccount.set(l.account_id,[]);linesByAccount.get(l.account_id).push({...l,journal:e});}
  // Use the SQL ledger-balance function for exact account balances. The movement list
  // remains available for matching/detail, but Treasury totals do not depend on REST row limits.
  const balances=await Promise.all(fm.map(async f=>{
    const movements=linesByAccount.get(f.gl_account_id)||[];
    let balance=money(movements.reduce((n,l)=>n+lineEffect(l,f.gl_account.account_type),0));
    try{
      const raw=await lib.sbJson('/rest/v1/rpc/accounting_financial_account_balance',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_financial_account_id:f.id,p_as_of:today()})});
      const exact=Number(rpcScalar(raw));if(Number.isFinite(exact))balance=money(exact);
    }catch(e){console.warn('cal-banking balance RPC fallback',f.id,e?.message||e)}
    return{...f,balance,movements};
  }));
  return{accounts:accounts||[],financialAccounts:balances,entries:entries||[],lines:lines||[],entryMap:em,accountMap:am};
}
function balanceAsOf(fin,date){return money((fin.movements||[]).filter(l=>String(l.journal.entry_date)<=date).reduce((n,l)=>n+lineEffect(l,fin.gl_account.account_type),0))}

async function treasuryPosition(ledger){
  const asOf=today(),d7=addDays(asOf,7),d30=addDays(asOf,30);
  const [bills,reimbursements,providerPayments,invoices,creditNotes]=await Promise.all([
    safe('/rest/v1/accounting_supplier_bills?select=id,due_date,status,total,amount_paid&status=in.(POSTED,PARTIAL)&limit=5000',[]),
    safe('/rest/v1/accounting_expense_claims?select=id,status,payment_mode,total,amount_reimbursed&payment_mode=eq.REIMBURSEMENT&status=eq.POSTED&limit=5000',[]),
    safe('/rest/v1/provider_payments?select=id,status,amount,needs_rate_review,created_at&status=eq.PENDING&needs_rate_review=eq.false&limit=5000',[]),
    safe('/rest/v1/accounting_invoices?select=id,due_date,status,total,paid_total&status=in.(SENT,PARTIAL,OVERDUE,PAID)&limit=5000',[]),
    safe('/rest/v1/accounting_credit_notes?select=invoice_id,status,total&status=eq.POSTED&limit=5000',[])
  ]);
  const creditByInvoice=new Map();for(const c of creditNotes||[])creditByInvoice.set(c.invoice_id,money((creditByInvoice.get(c.invoice_id)||0)+Number(c.total||0)));
  const bankCash=money(ledger.financialAccounts.filter(f=>['BANK','CASH'].includes(String(f.financial_type).toUpperCase())).reduce((n,f)=>n+Number(f.balance||0),0));
  const clearing=money(ledger.financialAccounts.filter(f=>String(f.financial_type).toUpperCase()==='CLEARING').reduce((n,f)=>n+f.balance,0));
  const cardDebt=money(ledger.financialAccounts.filter(f=>['CREDIT_CARD','LOAN'].includes(String(f.financial_type).toUpperCase())).reduce((n,f)=>n+Math.max(0,f.balance),0));
  const openBill=b=>money(Math.max(0,Number(b.total||0)-Number(b.amount_paid||0)));
  const apDue=cut=>money((bills||[]).filter(b=>!b.due_date||String(b.due_date)<=cut).reduce((n,b)=>n+openBill(b),0));
  const reimburseDue=money((reimbursements||[]).reduce((n,x)=>n+Math.max(0,Number(x.total||0)-Number(x.amount_reimbursed||0)),0));
  const providerDue=money((providerPayments||[]).reduce((n,x)=>n+Number(x.amount||0),0));
  const commitmentsToday=money(apDue(asOf)+reimburseDue+providerDue),commitments7=money(apDue(d7)+reimburseDue+providerDue),commitments30=money(apDue(d30)+reimburseDue+providerDue);
  const receivableDue=cut=>money((invoices||[]).filter(i=>i.status!=='VOID'&&(!i.due_date||String(i.due_date)<=cut)).reduce((n,i)=>n+Math.max(0,Number(i.total||0)-Number(i.paid_total||0)-Number(creditByInvoice.get(i.id)||0)),0));
  return{asOf,bankCash,clearing,liquidResources:money(bankCash+clearing),creditCardAndLoanBalance:cardDebt,commitmentsToday,commitments7,commitments30,availableResources:money(bankCash+clearing-commitmentsToday),receivables7:receivableDue(d7),receivables30:receivableDue(d30),components:{supplierAPToday:apDue(asOf),reimbursements:reimburseDue,providerPayables:providerDue}};
}

async function getData(event){
  const ledger=await coreLedger(),q=event.queryStringParameters||{};
  const [reconciliations,allMatches]=await Promise.all([
    safe('/rest/v1/accounting_bank_reconciliations?select=*&order=period_end.desc,created_at.desc&limit=150',[]),
    safe('/rest/v1/accounting_bank_matches?select=id,bank_transaction_id,journal_line_id,matched_amount,match_method,matched_by,matched_at&order=matched_at.desc&limit=10000',[])
  ]);
  let selectedId=clean(q.reconciliation_id,80)||null;
  if(!selectedId){const accountId=clean(q.financial_account_id,80);const open=(reconciliations||[]).find(r=>(!accountId||r.financial_account_id===accountId)&&r.status!=='CLOSED');selectedId=open?.id||null;}
  const selected=(reconciliations||[]).find(r=>r.id===selectedId)||null;
  let transactions=[],snapshot=null,imports=[];
  if(selected){[transactions,imports,snapshot]=await Promise.all([
    safe(`/rest/v1/accounting_bank_transactions?select=*&reconciliation_id=eq.${enc(selected.id)}&order=statement_date.asc,id.asc`,[]),
    safe(`/rest/v1/accounting_bank_imports?select=*&reconciliation_id=eq.${enc(selected.id)}&order=imported_at.desc`,[]),
    lib.sbJson('/rest/v1/rpc/accounting_bank_reconciliation_snapshot',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_reconciliation_id:selected.id})}).catch(()=>null)
  ]);}
  if(Array.isArray(snapshot))snapshot=snapshot[0]||null;
  const matchByTx=new Map();for(const m of allMatches||[]){if(!matchByTx.has(m.bank_transaction_id))matchByTx.set(m.bank_transaction_id,[]);matchByTx.get(m.bank_transaction_id).push(m)}
  const fin=selected?ledger.financialAccounts.find(f=>f.id===selected.financial_account_id):null;
  const matchedLineIds=new Set((allMatches||[]).map(m=>m.journal_line_id));
  const outstandingIds=new Set(Array.isArray(snapshot?.outstanding_line_ids)?snapshot.outstanding_line_ids:[]);
  let candidates=[];
  if(fin&&selected){candidates=(fin.movements||[]).filter(l=>outstandingIds.has(l.id)&&!matchedLineIds.has(l.id)).map(l=>({id:l.id,journal_entry_id:l.journal_entry_id,entry_number:l.journal.entry_number,entry_date:l.journal.entry_date,memo:l.journal.memo,description:l.description,effect:lineEffect(l,fin.gl_account.account_type)})).filter(x=>Math.abs(x.effect)>0.004).sort((a,b)=>String(b.entry_date).localeCompare(String(a.entry_date)));}
  const txRows=(transactions||[]).map(t=>({...t,matches:(matchByTx.get(t.id)||[]).map(m=>{const line=(ledger.lines||[]).find(l=>l.id===m.journal_line_id),entry=line?ledger.entryMap.get(line.journal_entry_id):null;return{...m,entry_number:entry?.entry_number||'',entry_date:entry?.entry_date||'',memo:entry?.memo||'',description:line?.description||''}})}));
  return{financialAccounts:ledger.financialAccounts.map(({movements,...f})=>f),reconciliations:reconciliations||[],selectedReconciliation:selected?{...selected,snapshot:snapshot||{}}:null,imports,transactions:txRows,ledgerCandidates:candidates,treasury:await treasuryPosition(ledger)};
}

async function startReconciliation(auth,event,p){
  const account=clean(p.financial_account_id,80),start=clean(p.period_start,10),end=clean(p.period_end,10);if(!account||!start||!end)bad('Financial account and reconciliation period are required.');
  const result=await lib.sbJson('/rest/v1/rpc/accounting_start_bank_reconciliation',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_financial_account_id:account,p_period_start:start,p_period_end:end,p_statement_opening_balance:money(p.statement_opening_balance),p_statement_ending_balance:money(p.statement_ending_balance),p_statement_reference:clean(p.statement_reference,200)||null,p_actor_id:String(auth.user.id)})});
  const id=String(rpcScalar(result)||'');if(!id)throw new Error('Reconciliation start did not return an id.');await audit(auth,event,'accounting_bank_reconciliations',id,'BANK_RECONCILIATION_STARTED',{financial_account_id:account,period_start:start,period_end:end});return id;
}
async function updateControl(auth,event,p){const id=clean(p.reconciliation_id,80);if(!id)bad('Reconciliation is required.');const result=await lib.sbJson('/rest/v1/rpc/accounting_update_bank_reconciliation_control',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_reconciliation_id:id,p_statement_opening_balance:money(p.statement_opening_balance),p_statement_ending_balance:money(p.statement_ending_balance),p_statement_reference:clean(p.statement_reference,200)||null,p_actor_id:String(auth.user.id)})});await audit(auth,event,'accounting_bank_reconciliations',id,'BANK_RECONCILIATION_CONTROL_UPDATED',{statement_opening_balance:money(p.statement_opening_balance),statement_ending_balance:money(p.statement_ending_balance),statement_reference:p.statement_reference||null});return String(rpcScalar(result)||id)}
async function importRows(auth,event,p){
  const id=clean(p.reconciliation_id,80),rows=Array.isArray(p.rows)?p.rows:[];if(!id||!rows.length)bad('Reconciliation and statement transactions are required.');
  const normalized=rows.slice(0,5000).map((r,i)=>{const amount=money(r.amount);if(!r.date||Math.abs(amount)<0.005)bad(`Statement row ${i+1} requires a date and non-zero amount.`);return{date:clean(r.date,10),value_date:clean(r.value_date,10)||null,description:clean(r.description,500)||'Statement transaction',external_id:clean(r.external_id,180)||null,amount,currency:(clean(r.currency,3)||'CAD').toUpperCase(),source_row:i+1}});
  const result=await lib.sbJson('/rest/v1/rpc/accounting_import_bank_rows',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_reconciliation_id:id,p_file_name:clean(p.file_name,240)||null,p_file_hash:clean(p.file_hash,128)||null,p_file_format:(clean(p.file_format,10)||'CSV').toUpperCase(),p_rows:normalized,p_actor_id:String(auth.user.id)})});
  const x=rpcScalar(result)||result;await audit(auth,event,'accounting_bank_reconciliations',id,'BANK_STATEMENT_IMPORTED',{file_name:p.file_name||null,file_format:p.file_format||'CSV',row_count:normalized.length,result:x});return x;
}
async function autoMatch(auth,event,p){const id=clean(p.reconciliation_id,80);if(!id)bad('Reconciliation is required.');const r=await lib.sbJson('/rest/v1/rpc/accounting_auto_match_bank_reconciliation',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_reconciliation_id:id,p_actor_id:String(auth.user.id)})});const x=rpcScalar(r)||r;await audit(auth,event,'accounting_bank_reconciliations',id,'BANK_AUTO_MATCH',{result:x});return x}
async function matchTx(auth,event,p){const tx=clean(p.bank_transaction_id,80),ids=(Array.isArray(p.journal_line_ids)?p.journal_line_ids:[]).map(x=>clean(x,80)).filter(Boolean);if(!tx||!ids.length)bad('Statement transaction and ledger line(s) are required.');const r=await lib.sbJson('/rest/v1/rpc/accounting_match_bank_transaction',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_bank_transaction_id:tx,p_journal_line_ids:ids,p_actor_id:String(auth.user.id),p_match_method:'MANUAL'})});const x=rpcScalar(r)||r;await audit(auth,event,'accounting_bank_transactions',tx,'BANK_TRANSACTION_MATCHED',{journal_line_ids:ids,result:x});return x}
async function unmatchTx(auth,event,p){const tx=clean(p.bank_transaction_id,80);if(!tx)bad('Statement transaction is required.');const r=await lib.sbJson('/rest/v1/rpc/accounting_unmatch_bank_transaction',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_bank_transaction_id:tx,p_actor_id:String(auth.user.id)})});await audit(auth,event,'accounting_bank_transactions',tx,'BANK_TRANSACTION_UNMATCHED',{removed:rpcScalar(r)});return rpcScalar(r)}
async function closeRecon(auth,event,p){const id=clean(p.reconciliation_id,80);if(!id)bad('Reconciliation is required.');const r=await lib.sbJson('/rest/v1/rpc/accounting_close_bank_reconciliation',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_reconciliation_id:id,p_actor_id:String(auth.user.id)})});const x=rpcScalar(r)||r;await audit(auth,event,'accounting_bank_reconciliations',id,'BANK_RECONCILIATION_CLOSED',{summary:x});return x}

exports.handler=async event=>{if(!['GET','POST'].includes(event.httpMethod))return lib.json(405,{error:'Method not allowed'});if(event.httpMethod==='POST'&&!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin.'});try{const auth=await lib.requireAdmin(event);if(event.httpMethod==='GET')return lib.json(200,{ok:true,data:await getData(event)});const b=bodyOf(event),action=String(b.action||'').toUpperCase(),p=b.payload||{};let result;if(action==='START_RECONCILIATION')result={id:await startReconciliation(auth,event,p)};else if(action==='UPDATE_RECONCILIATION_CONTROL')result={id:await updateControl(auth,event,p)};else if(action==='IMPORT_STATEMENT')result=await importRows(auth,event,p);else if(action==='AUTO_MATCH')result=await autoMatch(auth,event,p);else if(action==='MATCH_TRANSACTION')result=await matchTx(auth,event,p);else if(action==='UNMATCH_TRANSACTION')result=await unmatchTx(auth,event,p);else if(action==='CLOSE_RECONCILIATION')result=await closeRecon(auth,event,p);else return lib.json(400,{error:'Unsupported Banking action.'});return lib.json(200,{ok:true,result,data:await getData(event)});}catch(e){console.error('cal-banking',e);return lib.json(e.status||500,{error:e.message||'Unable to process Banking & Reconciliation.'})}};
