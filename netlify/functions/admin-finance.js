const lib=require('./_admin-lib');
const crypto=require('crypto');
const enc=v=>encodeURIComponent(String(v??''));
const clean=(v,n=1000)=>String(v??'').trim().slice(0,n);
const money=v=>Math.round((Number(v)||0)*100)/100;
const today=()=>new Date().toISOString().slice(0,10);
function bodyOf(event){try{return JSON.parse(event.body||'{}')}catch{const e=new Error('Invalid JSON body.');e.status=400;throw e}}
function bad(message,status=400){const e=new Error(message);e.status=status;throw e}
function rpcScalar(v){if(Array.isArray(v))v=v[0];if(v&&typeof v==='object'){const k=Object.keys(v);if(k.length===1)return v[k[0]];}return v}

// Business-language categories. The operator never selects GL accounts.
const CATEGORIES={
  FUEL_VEHICLE:{label:'Fuel & Vehicle',code:'5100',classification:'EXPENSE'},
  INSURANCE:{label:'Insurance',code:'5200',classification:'EXPENSE'},
  ADVERTISING_MARKETING:{label:'Advertising & Marketing',code:'5300',classification:'EXPENSE'},
  OFFICE_SOFTWARE:{label:'Office & Software',code:'5400',classification:'EXPENSE'},
  PROFESSIONAL_FEES:{label:'Professional Fees',code:'5500',classification:'EXPENSE'},
  REPAIRS_MAINTENANCE:{label:'Repairs & Maintenance',code:'5600',classification:'EXPENSE'},
  BANK_MERCHANT_FEES:{label:'Bank / Merchant Fees',code:'5700',classification:'EXPENSE'},
  TOOLS_EQUIPMENT:{label:'Tools / Equipment',code:'1500',classification:'FIXED_ASSET',review:'Fixed-asset setup remains an Accountant/Advanced review after the purchase is recorded.'},
  PREPAID_EXPENSE:{label:'Prepaid Expense',code:'1400',classification:'PREPAID'},
  INVENTORY_MATERIALS:{label:'Inventory / Materials',code:'1600',classification:'INVENTORY',inventory:true},
  OTHER_REVIEW:{label:'Other / Needs Review',exception:true,reason:'PLEASE does not guess accounting for Other / Needs Review. The business fact was routed to Finance Exceptions.'}
};

async function safe(path,fallback=[]){try{return await lib.sbJson(path)}catch(e){if(/does not exist|schema cache|42P01|42703|PGRST/i.test(String(e.message||e))){console.warn('admin-finance optional read',path,e.message);return fallback}throw e}}
async function audit(auth,event,objectType,objectId,eventType,afterData){try{await lib.sbJson('/rest/v1/accounting_audit_log',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({actor_user_id:null,event_type:eventType,object_type:objectType,object_id:String(objectId||''),after_data:afterData||null,metadata:{step:'19',source:'PLEASE_ADMIN_FINANCE',please_admin_user_id:auth.user.id,actor_email:auth.user.email,ip:lib.requestIp(event)||null,user_agent:lib.requestUserAgent(event)||null}})});}catch(e){console.warn('admin-finance audit',e?.message||e)}}

async function getData(){
  const [settings,queue,exceptions,invoices,payments,bills,supplierPayments,expenses,bankTx,financialAccounts,accounts,taxCodes,parties,roles,inventoryItems,inventoryLocations,reconciliations,cashCounts]=await Promise.all([
    safe('/rest/v1/operational_finance_settings?select=*&singleton_id=eq.1&limit=1',[]),
    safe('/rest/v1/operational_finance_queue?select=id,event_key,event_type,source_job_id,status,attempts,invoice_id,last_error,created_at,processed_at,updated_at&order=created_at.desc&limit=100',[]),
    safe('/rest/v1/operational_finance_exceptions?select=*&order=created_at.desc&limit=100',[]),
    safe('/rest/v1/invoices?select=id,invoice_number,job_id,status,payment_status,total_amount,amount_paid,currency,client_name,client_email,due_date,created_at&status=neq.VOID&order=created_at.desc&limit=500',[]),
    safe('/rest/v1/payment_transactions?select=id,invoice_id,amount,status,provider,created_at&status=eq.SUCCEEDED&order=created_at.desc&limit=1000',[]),
    safe('/rest/v1/accounting_supplier_bills?select=id,bill_number,supplier_party_id,supplier_invoice_number,bill_date,due_date,status,total,amount_paid,source_document_id,created_at&order=bill_date.desc,created_at.desc&limit=500',[]),
    safe('/rest/v1/accounting_supplier_payments?select=id,supplier_bill_id,amount,status,payment_date,created_at&order=payment_date.desc,created_at.desc&limit=1000',[]),
    safe('/rest/v1/accounting_expense_claims?select=id,expense_number,status,total,receipt_status,expense_date,description,created_at&order=expense_date.desc,created_at.desc&limit=500',[]),
    safe('/rest/v1/accounting_bank_transactions?select=id,reconciliation_id,status,amount,description,statement_date,transaction_date,created_at&order=created_at.desc&limit=1000',[]),
    safe('/rest/v1/accounting_financial_accounts?select=id,name,financial_type,currency,is_primary,active&active=eq.true&order=is_primary.desc,name.asc',[]),
    safe('/rest/v1/accounting_accounts?select=id,code,name,account_type,account_subtype,active&active=eq.true&order=code.asc',[]),
    safe('/rest/v1/accounting_tax_codes?select=id,code,name,federal_rate,provincial_rate,recoverable_default,active&active=eq.true&order=code.asc',[]),
    safe('/rest/v1/accounting_parties?select=id,legal_name,display_name,email,phone,payment_terms_days,active&active=eq.true&order=legal_name.asc',[]),
    safe('/rest/v1/accounting_party_roles?select=party_id,role,active&role=eq.SUPPLIER&active=eq.true',[]),
    safe('/rest/v1/accounting_inventory_items?select=id,sku,name,active&active=eq.true&order=sku.asc',[]),
    safe('/rest/v1/accounting_inventory_locations?select=id,code,name,active&active=eq.true&order=code.asc',[]),
    safe('/rest/v1/accounting_bank_reconciliations?select=id,financial_account_id,period_start,period_end,status,statement_opening_balance,statement_ending_balance,statement_reference,created_at,updated_at&order=period_end.desc,created_at.desc&limit=100',[]),
    safe('/rest/v1/operational_finance_cash_counts?select=id,financial_account_id,count_date,expected_amount,physical_amount,difference,status,reference,created_at&order=count_date.desc,created_at.desc&limit=100',[])
  ]);
  const inv=invoices||[],q=queue||[],ex=exceptions||[],bs=bills||[],xp=expenses||[],bt=bankTx||[];
  const supplierIds=new Set((roles||[]).map(x=>x.party_id)),supplierRows=(parties||[]).filter(x=>supplierIds.has(x.id));
  const partyMap=new Map((parties||[]).map(x=>[x.id,x]));
  const normalizedBills=bs.map(x=>({...x,supplier:partyMap.get(x.supplier_party_id)||null,balance_due:money(Math.max(0,Number(x.total||0)-Number(x.amount_paid||0)))}));
  const receivable=money(inv.filter(x=>!['DRAFT','VOID','PAID'].includes(x.status)&&x.payment_status!=='PAID').reduce((n,x)=>n+Math.max(0,Number(x.total_amount||0)-Number(x.amount_paid||0)),0));
  const collected=money((payments||[]).reduce((n,x)=>n+Number(x.amount||0),0));
  const payable=money(normalizedBills.filter(x=>!['PAID','VOID'].includes(x.status)).reduce((n,x)=>n+x.balance_due,0));
  const openExceptions=ex.filter(x=>x.status==='OPEN').length+q.filter(x=>x.status==='ERROR').length;
  const unmatched=bt.filter(x=>['UNMATCHED','PENDING'].includes(String(x.status||'').toUpperCase())).length;
  return {
    settings:settings?.[0]||{singleton_id:1,auto_create_invoice_draft:true,auto_issue_invoice:false,auto_email_invoice:false,default_gst_rate:5},
    queue:q,exceptions:ex,
    summary:{receivable,collected,payable,open_exceptions:openExceptions,pending_finance:q.filter(x=>['PENDING','PROCESSING','ERROR'].includes(x.status)).length,draft_expenses:xp.filter(x=>x.status==='DRAFT').length,missing_receipts:xp.filter(x=>x.receipt_status==='MISSING'&&x.status!=='VOID').length,unmatched_bank:unmatched},
    financial_accounts:(financialAccounts||[]).filter(x=>['BANK','CASH','CREDIT_CARD'].includes(String(x.financial_type||'').toUpperCase())),
    bank_accounts:(financialAccounts||[]).filter(x=>String(x.financial_type||'').toUpperCase()==='BANK'),
    cash_accounts:(financialAccounts||[]).filter(x=>String(x.financial_type||'').toUpperCase()==='CASH'),
    categories:Object.entries(CATEGORIES).map(([id,x])=>({id,label:x.label,review:!!x.exception||!!x.review,inventory:!!x.inventory})),
    suppliers:supplierRows,inventory_items:inventoryItems||[],inventory_locations:inventoryLocations||[],
    quick_expenses:xp.slice(0,30),supplier_bills:normalizedBills.slice(0,100),supplier_payments:(supplierPayments||[]).slice(0,100),
    open_invoices:inv.filter(x=>x.status!=='VOID'&&x.payment_status!=='PAID').slice(0,100),
    bank_reconciliations:reconciliations||[],unmatched_bank_transactions:bt.filter(x=>['UNMATCHED','PENDING'].includes(String(x.status||'').toUpperCase())).slice(0,50),cash_counts:cashCounts||[],
    schema:{accounts_ready:(accounts||[]).length>0,tax_ready:(taxCodes||[]).some(x=>x.code==='AB-GST'),cash_count_ready:Array.isArray(cashCounts)}
  };
}

async function updateSettings(auth,p){
  const patch={auto_create_invoice_draft:p.auto_create_invoice_draft!==false,auto_issue_invoice:!!p.auto_issue_invoice,auto_email_invoice:!!p.auto_email_invoice,default_gst_rate:Math.max(0,Math.min(100,Number(p.default_gst_rate??5))),updated_by_admin_portal_user:auth.user.id,updated_at:new Date().toISOString()};
  if(patch.auto_email_invoice&&!patch.auto_issue_invoice)bad('Auto-email requires Auto-Issue to be enabled.');
  await lib.sbJson('/rest/v1/operational_finance_settings?singleton_id=eq.1',{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(patch)});
}
async function createException(auth,type,summary,details={}){const rows=await lib.sbJson('/rest/v1/operational_finance_exceptions',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({exception_type:type,status:'OPEN',source_type:'ADMIN_FINANCE',summary:clean(summary,500),details,created_by_admin_portal_user:auth.user.id})});return rows?.[0]?.id||null}
async function categoryChoice(auth,p,kind){
  const key=clean(p.category,60).toUpperCase(),category=CATEGORIES[key];if(!category)bad('Choose a valid business category.');
  if(category.exception){const id=await createException(auth,`${kind}_CLASSIFICATION_REVIEW`,`${category.label}: ${clean(p.description||p.notes,500)||'Needs review'}`,{category:key,amount:money(p.subtotal),reference:clean(p.reference||p.supplier_invoice_number,160)||null,reason:category.reason});return {exception:true,id,message:category.reason}}
  if(category.inventory){if(!clean(p.inventory_item_id,80)||!clean(p.inventory_location_id,80))bad('Inventory / Materials requires the inventory item and the receiving location.');const [it,loc]=await Promise.all([lib.sbJson(`/rest/v1/accounting_inventory_items?select=id&active=eq.true&id=eq.${enc(p.inventory_item_id)}&limit=1`),lib.sbJson(`/rest/v1/accounting_inventory_locations?select=id&active=eq.true&id=eq.${enc(p.inventory_location_id)}&limit=1`)]);if(!it?.[0]||!loc?.[0])bad('Inventory item or location is inactive or missing.');}
  const accts=await lib.sbJson(`/rest/v1/accounting_accounts?select=id,code,name,account_type,active&code=eq.${enc(category.code)}&active=eq.true&limit=1`),account=accts?.[0];if(!account)bad(`Required finance mapping ${category.code} is not installed. Ask an Accountant to review Advanced Accounting.`,409);
  return {key,category,account};
}
async function taxFor(hasGst,subtotal){if(!hasGst)return {tax:null,taxAmount:0,recoverable:0};const taxes=await lib.sbJson('/rest/v1/accounting_tax_codes?select=id,code,federal_rate,provincial_rate,active&code=eq.AB-GST&active=eq.true&limit=1'),tax=taxes?.[0];if(!tax)bad('Alberta GST tax code is not installed.',409);const taxAmount=money(subtotal*(Number(tax.federal_rate||5)+Number(tax.provincial_rate||0))/100);return {tax,taxAmount,recoverable:taxAmount}}
async function financialAccount(id){id=clean(id,80);if(!id)bad('Choose the bank, cash, or credit-card account used.');const rows=await lib.sbJson(`/rest/v1/accounting_financial_accounts?select=id,financial_type,active,currency&id=eq.${enc(id)}&limit=1`),fa=rows?.[0];if(!fa||fa.active===false||!['BANK','CASH','CREDIT_CARD'].includes(String(fa.financial_type||'').toUpperCase()))bad('Choose an active bank, cash, or credit-card account.');return fa}

async function quickExpense(auth,event,p){
  const subtotal=money(p.subtotal),description=clean(p.description,500),expenseDate=clean(p.expense_date,10)||today();if(subtotal<=0)bad('Expense amount must be greater than zero.');if(!description)bad('Expense description is required.');
  const ch=await categoryChoice(auth,p,'EXPENSE');if(ch.exception)return {kind:'EXCEPTION',id:ch.id,message:ch.message};
  await financialAccount(p.financial_account_id);const t=await taxFor(p.gst_5===true||p.gst_5==='true',subtotal);
  const line={sort_order:1,description,classification:ch.category.classification,quantity:1,unit_price:subtotal,posting_account_id:ch.account.id,tax_code_id:t.tax?.id||null,itc_eligibility:t.tax?'FULL':'NONE',recoverable_percent:t.tax?100:0,line_subtotal:subtotal,tax_amount:t.taxAmount,recoverable_tax:t.recoverable,nonrecoverable_tax:0,line_total:money(subtotal+t.taxAmount),inventory_item_id:ch.category.inventory?clean(p.inventory_item_id,80):null,inventory_location_id:ch.category.inventory?clean(p.inventory_location_id,80):null};
  const result=await lib.sbJson('/rest/v1/rpc/accounting_save_expense_claim',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_id:null,p_expense_date:expenseDate,p_posting_date:expenseDate,p_vendor_party_id:null,p_payee_party_id:null,p_payment_mode:'COMPANY_PAID',p_financial_account_id:clean(p.financial_account_id,80),p_currency:'CAD',p_reference:clean(p.reference,160)||null,p_description:description,p_business_purpose:`PLEASE Operational Finance — ${ch.category.label}`,p_department:null,p_project_reference:null,p_receipt_waiver_reason:null,p_lines:[line],p_actor_id:String(auth.user.id)})});
  const id=String(rpcScalar(result)||'');if(!id)throw new Error('Expense did not return an id.');await audit(auth,event,'accounting_expense_claims',id,'OPERATIONAL_EXPENSE_CREATED',{category:ch.key,subtotal,financial_account_id:p.financial_account_id});return {kind:'DRAFT_EXPENSE',id,message:`${ch.category.label} expense created. Upload supporting evidence to finish automatic posting.`};
}
async function finalizeExpense(auth,event,p){const id=clean(p.id,80);if(!id)bad('Expense is required.');const x=(await lib.sbJson(`/rest/v1/accounting_expense_claims?select=id,status,receipt_status&id=eq.${enc(id)}&limit=1`))?.[0];if(!x)bad('Expense not found.',404);if(x.receipt_status==='MISSING')bad('Attach the receipt/invoice before posting.');let status=x.status;for(const action of status==='DRAFT'||status==='REJECTED'?['SUBMIT','APPROVE','POST']:status==='SUBMITTED'?['APPROVE','POST']:status==='APPROVED'?['POST']:[]){const r=await lib.sbJson('/rest/v1/rpc/accounting_expense_claim_action',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_expense_id:id,p_action:action,p_actor_id:String(auth.user.id),p_reason:null})});status=String(rpcScalar(r)||status)}await audit(auth,event,'accounting_expense_claims',id,'OPERATIONAL_EXPENSE_FINALIZED',{status});return {id,status,message:`Expense ${status}. Accounting event is handled automatically by STEP 17.`}}

async function quickBill(auth,event,p){
  const subtotal=money(p.subtotal),description=clean(p.description,500),supplierId=clean(p.supplier_party_id,80),billDate=clean(p.bill_date,10)||today();if(subtotal<=0)bad('Supplier bill amount must be greater than zero.');if(!description)bad('Purchase description is required.');if(!supplierId)bad('Supplier is required.');
  const role=(await lib.sbJson(`/rest/v1/accounting_party_roles?select=party_id&party_id=eq.${enc(supplierId)}&role=eq.SUPPLIER&active=eq.true&limit=1`))?.[0];if(!role)bad('Selected supplier is inactive or missing.');
  const ch=await categoryChoice(auth,p,'PURCHASE');if(ch.exception)return {kind:'EXCEPTION',id:ch.id,message:ch.message};const t=await taxFor(p.gst_5===true||p.gst_5==='true',subtotal);
  let due=clean(p.due_date,10)||null;if(!due){const party=(await lib.sbJson(`/rest/v1/accounting_parties?select=payment_terms_days&id=eq.${enc(supplierId)}&limit=1`))?.[0],d=new Date(`${billDate}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+Math.max(0,Number(party?.payment_terms_days||0)));due=d.toISOString().slice(0,10)}
  const lines=[{sort_order:1,description,quantity:1,unit_price:subtotal,posting_account_id:ch.account.id,tax_code_id:t.tax?.id||null,line_subtotal:subtotal,tax_amount:t.taxAmount,recoverable_tax:t.recoverable,line_total:money(subtotal+t.taxAmount),inventory_item_id:ch.category.inventory?clean(p.inventory_item_id,80):null,inventory_location_id:ch.category.inventory?clean(p.inventory_location_id,80):null}];
  const r=await lib.sbJson('/rest/v1/rpc/accounting_save_supplier_bill',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_id:null,p_supplier_party_id:supplierId,p_supplier_invoice_number:clean(p.supplier_invoice_number,120)||null,p_bill_date:billDate,p_due_date:due,p_currency:'CAD',p_notes:`PLEASE Operational Finance — ${ch.category.label}`,p_source_reference:clean(p.reference,240)||null,p_lines:lines,p_actor_id:String(auth.user.id)})}),id=String(rpcScalar(r)||'');if(!id)throw new Error('Supplier bill did not return an id.');await audit(auth,event,'accounting_supplier_bills',id,'OPERATIONAL_SUPPLIER_BILL_CREATED',{category:ch.key,supplier_party_id:supplierId,subtotal});return {kind:'DRAFT_BILL',id,message:'Supplier bill created. Upload the supplier invoice/receipt to finish automatic posting.'};
}
async function finalizeBill(auth,event,p){const id=clean(p.id,80);if(!id)bad('Supplier bill is required.');const x=(await lib.sbJson(`/rest/v1/accounting_supplier_bills?select=id,status,source_document_id&id=eq.${enc(id)}&limit=1`))?.[0];if(!x)bad('Supplier bill not found.',404);if(!x.source_document_id)bad('Attach the supplier invoice/receipt before posting.');let status=x.status;for(const action of status==='DRAFT'?['SUBMIT','APPROVE','POST']:status==='SUBMITTED'?['APPROVE','POST']:status==='APPROVED'?['POST']:[]){const r=await lib.sbJson('/rest/v1/rpc/accounting_supplier_bill_action',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_bill_id:id,p_action:action,p_actor_id:String(auth.user.id)})});status=String(rpcScalar(r)||status)}await audit(auth,event,'accounting_supplier_bills',id,'OPERATIONAL_SUPPLIER_BILL_FINALIZED',{status});return {id,status,message:`Supplier bill ${status}. Accounts Payable and STEP 17 accounting are updated automatically.`}}
async function paySupplier(auth,event,p){const billId=clean(p.supplier_bill_id,80),fin=clean(p.financial_account_id,80),amount=money(p.amount);if(!billId||!fin||amount<=0)bad('Supplier bill, payment account and positive amount are required.');await financialAccount(fin);const r=await lib.sbJson('/rest/v1/rpc/accounting_record_supplier_payment',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_bill_id:billId,p_financial_account_id:fin,p_payment_date:clean(p.payment_date,10)||today(),p_amount:amount,p_method:clean(p.method,80)||'PLEASE Admin',p_reference:clean(p.reference,160)||null,p_notes:clean(p.notes,1000)||'Supplier payment recorded through Operational Finance',p_actor_id:String(auth.user.id)})}),id=String(rpcScalar(r)||'');if(!id)throw new Error('Supplier payment did not return an id.');await audit(auth,event,'accounting_supplier_payments',id,'OPERATIONAL_SUPPLIER_PAYMENT_RECORDED',{supplier_bill_id:billId,amount,financial_account_id:fin});return {id,message:'Supplier payment recorded. A/P and the accounting event are updated automatically.'}}

async function recordCashCount(auth,event,p){const fin=clean(p.financial_account_id,80),physical=money(p.physical_amount);if(!fin||physical<0)bad('Cash account and a non-negative physical amount are required.');const r=await lib.sbJson('/rest/v1/rpc/operational_finance_record_cash_count',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_financial_account_id:fin,p_count_date:clean(p.count_date,10)||today(),p_physical_amount:physical,p_reference:clean(p.reference,200)||null,p_admin_user_id:auth.user.id})}),id=String(rpcScalar(r)||'');if(!id)throw new Error('Cash count did not return an id.');await audit(auth,event,'operational_finance_cash_counts',id,'OPERATIONAL_CASH_COUNT_RECORDED',{financial_account_id:fin,physical_amount:physical});return {id,message:'Cash count recorded. Any variance is routed to Finance Exceptions; no adjustment journal is guessed.'}}

async function startBank(auth,event,p){const account=clean(p.financial_account_id,80),start=clean(p.period_start,10),end=clean(p.period_end,10);if(!account||!start||!end)bad('Bank account and statement period are required.');const r=await lib.sbJson('/rest/v1/rpc/accounting_start_bank_reconciliation',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_financial_account_id:account,p_period_start:start,p_period_end:end,p_statement_opening_balance:money(p.statement_opening_balance),p_statement_ending_balance:money(p.statement_ending_balance),p_statement_reference:clean(p.statement_reference,200)||null,p_actor_id:String(auth.user.id)})}),id=String(rpcScalar(r)||'');if(!id)throw new Error('Bank reconciliation did not return an id.');await audit(auth,event,'accounting_bank_reconciliations',id,'OPERATIONAL_BANK_RECONCILIATION_STARTED',{financial_account_id:account,period_start:start,period_end:end});return {id,message:'Bank reconciliation started.'}}
async function importBank(auth,event,p){const id=clean(p.reconciliation_id,80),rows=Array.isArray(p.rows)?p.rows:[];if(!id||!rows.length)bad('Reconciliation and statement transactions are required.');if(rows.length>5000)bad('A single statement import cannot exceed 5,000 rows.');const normalized=rows.map((x,i)=>{const amount=money(x.amount);if(!clean(x.date,10)||Math.abs(amount)<0.005)bad(`Statement row ${i+1} requires a date and non-zero amount.`);return{date:clean(x.date,10),value_date:clean(x.value_date,10)||null,description:clean(x.description,500)||'Statement transaction',external_id:clean(x.external_id,180)||null,amount,currency:(clean(x.currency,3)||'CAD').toUpperCase(),source_row:i+1}});const hash=crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');const r=await lib.sbJson('/rest/v1/rpc/accounting_import_bank_rows',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_reconciliation_id:id,p_file_name:clean(p.file_name,240)||'bank-statement.csv',p_file_hash:hash,p_file_format:'CSV',p_rows:normalized,p_actor_id:String(auth.user.id)})});await audit(auth,event,'accounting_bank_reconciliations',id,'OPERATIONAL_BANK_STATEMENT_IMPORTED',{rows:normalized.length,file_name:p.file_name||null});return {result:rpcScalar(r)||r,message:`Imported ${normalized.length} bank statement row(s).`}}
async function autoMatchBank(auth,event,p){const id=clean(p.reconciliation_id,80);if(!id)bad('Reconciliation is required.');const r=await lib.sbJson('/rest/v1/rpc/accounting_auto_match_bank_reconciliation',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_reconciliation_id:id,p_actor_id:String(auth.user.id)})});await audit(auth,event,'accounting_bank_reconciliations',id,'OPERATIONAL_BANK_AUTO_MATCH',{result:rpcScalar(r)||r});return {result:rpcScalar(r)||r,message:'Automatic bank matching completed. Unmatched items remain visible for review.'}}
async function closeBank(auth,event,p){const id=clean(p.reconciliation_id,80);if(!id)bad('Reconciliation is required.');const r=await lib.sbJson('/rest/v1/rpc/accounting_close_bank_reconciliation',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_reconciliation_id:id,p_actor_id:String(auth.user.id)})});await audit(auth,event,'accounting_bank_reconciliations',id,'OPERATIONAL_BANK_RECONCILIATION_CLOSED',{result:rpcScalar(r)||r});return {result:rpcScalar(r)||r,message:'Bank reconciliation closed.'}}

async function retryQueue(p){const id=clean(p.id,80);if(!id)bad('Queue item is required.');await lib.sbJson(`/rest/v1/operational_finance_queue?id=eq.${enc(id)}&status=in.(ERROR,SKIPPED)`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'PENDING',next_attempt_at:new Date().toISOString(),last_error:null,processed_at:null,updated_at:new Date().toISOString()})})}
async function resolveException(auth,p){const id=clean(p.id,80);if(!id)bad('Exception is required.');const status=clean(p.status,20).toUpperCase();if(!['RESOLVED','DISMISSED'].includes(status))bad('Invalid exception resolution.');await lib.sbJson(`/rest/v1/operational_finance_exceptions?id=eq.${enc(id)}&status=eq.OPEN`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status,resolution_note:clean(p.note,1000)||null,resolved_by_admin_portal_user:auth.user.id,resolved_at:new Date().toISOString(),updated_at:new Date().toISOString()})})}

exports.handler=async event=>{
  if(!['GET','POST'].includes(event.httpMethod))return lib.json(405,{error:'Method not allowed'});if(event.httpMethod==='POST'&&!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin.'});
  try{const auth=await lib.requireAdmin(event);if(event.httpMethod==='GET')return lib.json(200,{ok:true,data:await getData()});const b=bodyOf(event),action=clean(b.action,60).toUpperCase(),p=b.payload||{};let result={};
    if(action==='UPDATE_SETTINGS'){await updateSettings(auth,p);result={updated:true,message:'Automation settings saved.'}}
    else if(action==='QUICK_EXPENSE')result=await quickExpense(auth,event,p);
    else if(action==='FINALIZE_EXPENSE')result=await finalizeExpense(auth,event,p);
    else if(action==='QUICK_BILL')result=await quickBill(auth,event,p);
    else if(action==='FINALIZE_BILL')result=await finalizeBill(auth,event,p);
    else if(action==='PAY_SUPPLIER')result=await paySupplier(auth,event,p);
    else if(action==='RECORD_CASH_COUNT')result=await recordCashCount(auth,event,p);
    else if(action==='START_BANK_RECONCILIATION')result=await startBank(auth,event,p);
    else if(action==='IMPORT_BANK_ROWS')result=await importBank(auth,event,p);
    else if(action==='AUTO_MATCH_BANK')result=await autoMatchBank(auth,event,p);
    else if(action==='CLOSE_BANK_RECONCILIATION')result=await closeBank(auth,event,p);
    else if(action==='RETRY_QUEUE'){await retryQueue(p);result={retried:true,message:'Queue item returned to PENDING.'}}
    else if(action==='RESOLVE_EXCEPTION'){await resolveException(auth,p);result={resolved:true,message:'Finance Exception resolved.'}}
    else return lib.json(400,{error:'Unsupported Finance action.'});
    return lib.json(200,{ok:true,result,data:await getData()});
  }catch(e){console.error('admin-finance',e);return lib.json(e.status||500,{error:e.message||'Unable to process Finance.'})}
};
