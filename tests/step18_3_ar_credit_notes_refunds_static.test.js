const fs=require('fs'),crypto=require('crypto'),assert=require('assert');
const read=p=>fs.readFileSync(p,'utf8');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function pass(name,cond){assert.ok(cond,name);console.log('PASS:',name)}
const sql=read('supabase/STEP18_3_AR_CREDIT_NOTES_REFUNDS.sql');
const api=read('netlify/functions/cal-receivables.js');
const worker=read('netlify/functions/_cal-accounting-lib.js');
const dash=read('netlify/functions/cal-dashboard-data.js');
const page=read('cal/invoices.html');
const js=read('cal/js/receivables.js');
const app=read('cal/js/app.js');
const doc=read('STEP18_3_AR_CREDIT_NOTES_REFUNDS.md');

pass('STEP 18.3 is additive and preserves operational invoice/payment/provider tables',
  sql.includes('create table if not exists public.accounting_credit_notes')&&
  sql.includes('create table if not exists public.accounting_customer_refunds')&&
  !/alter table public\.(payment_transactions|provider_payments|invoices)\b/i.test(sql)&&
  !/delete from public\.(payment_transactions|provider_payments|invoices)\b/i.test(sql));
pass('Accounting invoices gain Business Partner and operational source linkage',
  sql.includes('alter table public.accounting_invoices add column if not exists party_id')&&
  sql.includes('alter table public.accounting_invoices add column if not exists source_invoice_id')&&
  sql.includes("p.source_system='PLEASE'")&&sql.includes("p.source_table='customers'"));
pass('Credit Notes have controlled Draft Submit Approve Post lifecycle',
  sql.includes("status in ('DRAFT','SUBMITTED','APPROVED','POSTED','VOID')")&&
  sql.includes("v_action='SUBMIT'")&&sql.includes("v_action='APPROVE'")&&sql.includes("v_action='POST'"));
pass('Credit Note save is server-side atomic and validates invoice/tax/revenue limits',
  sql.includes('create or replace function public.accounting_save_credit_note')&&
  sql.includes("Credit note lines must use an active REVENUE account")&&
  sql.includes('remaining creditable invoice subtotal')&&sql.includes('remaining creditable invoice tax')&&
  sql.includes('delete from public.accounting_credit_note_lines where credit_note_id=v_id'));
pass('Credit Note posting serializes same-invoice postings and rechecks subtotal/tax/total',
  sql.includes('Serialize postings for the same invoice')&&
  sql.includes('where id=v_note.invoice_id for update')&&
  sql.includes('would exceed the original invoice subtotal')&&
  sql.includes('would exceed the original invoice tax')&&
  sql.includes('would exceed the original invoice total'));
pass('Posted Credit Notes and completed Refunds are immutable',
  sql.includes('Posted credit note financial fields are immutable')&&
  sql.includes('Lines of a posted credit note are immutable')&&
  sql.includes('Completed customer refunds are immutable')&&
  sql.includes('Completed customer refunds cannot be deleted'));
pass('Refund is separate from original successful payment and cannot exceed customer credit',
  sql.includes('Original successful payment transactions are preserved')&&
  sql.includes('create or replace function public.accounting_customer_credit_available')&&
  sql.includes('Refund exceeds available customer credit')&&
  !/update public\.payment_transactions/i.test(sql));
pass('Concurrent refunds are serialized per customer',sql.includes('pg_advisory_xact_lock(hashtext(p_customer_party_id::text))'));
pass('STEP 17 receives durable Credit Note and Refund events',
  sql.includes("'CREDIT_NOTE_ISSUED'")&&sql.includes("'REFUND_COMPLETED'")&&
  sql.includes('accounting_enqueue_event')&&
  sql.includes("'PLEASE:CREDIT_NOTE_ISSUED:'||new.credit_note_id::text"));
pass('Posting rules preserve non-null debit/credit compatibility',
  sql.includes("('PLEASE','CREDIT_NOTE_ISSUED','4000','1100','2100'")&&
  sql.includes("('PLEASE','REFUND_COMPLETED','1100','1000',null")&&
  sql.includes('on conflict(source_system,event_type,debit_account_code,credit_account_code)'));
pass('Worker posts Credit Note as revenue/tax debit and A/R credit',
  worker.includes("if(type==='CREDIT_NOTE_ISSUED')")&&
  worker.includes("qst_payable_account||'2110'")&&worker.includes("rule.tax_account_code||'2100'")&&
  worker.includes("rule.credit_account_code||'1100'")&&worker.includes('Credit note lines'));
pass('Worker posts Refund as A/R debit and actual mapped financial-account credit',
  worker.includes("if(type==='REFUND_COMPLETED')")&&worker.includes('financialAccount(refund.financial_account_id')&&
  worker.includes("rule.debit_account_code||'1100'")&&worker.includes('credit:amount'));
pass('Credit Note depends on original invoice event and linked Refund depends on Credit Note',
  worker.includes('PLEASE:INVOICE_ISSUED:${inv.source_invoice_id}')&&
  worker.includes('PLEASE:CREDIT_NOTE_ISSUED:${refund.credit_note_id||current.credit_note_id}'));
pass('Recovery scanner includes posted Credit Notes and completed Refunds',
  worker.includes("enqueueLegacy('CREDIT_NOTE_ISSUED'")&&worker.includes("enqueueLegacy('REFUND_COMPLETED'")&&
  worker.includes('credit_notes')&&worker.includes('refunds'));
pass('Receivables API requires Admin and same-origin writes',api.includes('requireAdmin(event)')&&api.includes("event.httpMethod==='POST'&&!lib.sameOrigin(event)"));
pass('Receivables API exposes real customer linkage and server RPC actions',
  api.includes('accounting_parties')&&api.includes('accounting_party_roles')&&
  api.includes('accounting_save_credit_note')&&api.includes('accounting_credit_note_action')&&api.includes('accounting_record_customer_refund'));
pass('A/R UI exposes aging, customer credits, Credit Notes and Refunds',
  page.includes('Accounts Receivable')&&page.includes('A/R Aging')&&page.includes('Customer Credits')&&
  page.includes('Credit Notes')&&page.includes('Refunds')&&js.includes('CREDIT_NOTE_ACTION'));
pass('Credit Note printable document includes prescribed business/original-invoice/tax context',
  js.includes('CREDIT NOTE')&&js.includes('Business Number')&&js.includes('Original invoice')&&
  js.includes('Tax / Rate')&&js.includes('Tax Reduction'));
pass('Refund UI records accounting completion only and does not call Stripe refund API',
  page.includes('does not initiate a Stripe API refund')&&!api.includes('stripe.refunds.create')&&!js.includes('stripe.refunds.create'));
pass('Dashboard and CAL calculations include Credit Notes, Refunds and customer A/R',
  dash.includes('creditNotes')&&dash.includes('refunds')&&dash.includes('customerCredits')&&
  app.includes('creditNotes')&&app.includes('customerCredits'));
pass('Documentation blocks progression until STEP 18.3 acceptance',doc.includes('Only after acceptance proceed to STEP 18.4'));

const protectedHashes={
'index.html':'37606e19e13b019e6ae7465e0723edd5896f2cc5e15760d8de6b341f0f7dae57',
'work-with-us.html':'531bf6b4be655acd9e99bb17ce21efa70cea0f836ab800b0c30a1e890dd6de97',


'service-request.html':'bf8001b0669a45108d6eb71d05e5df11e6902252742e29cdf902c83179d4525d',
'track-request.html':'658412a1179cc9fd47af989394ce438fab4120485aaa14394bb48cd0abd1f33e',


'js/app.js':'a5520c3531073bafdd343d19d0fe62f256cbd9cb52570a042688a2529e52aada',
'stripe-webhook.js':'ae22531e33508826be005cb9d5dc9e0dabba1bef4ed2179af9d37dcc9a567812',
'cal-accounting-worker.js':'f5467c6b3e3129267f8151d5b5d787a2c8cdb558045af20183fa6520242db43d'
};
pass('Protected PLEASE operational files not intentionally evolved by STEP 19 remain byte-identical',Object.entries(protectedHashes).every(([p,h])=>hash(p)===h));
console.log('STEP 18.3 A/R + Credit Notes + Refunds static audit completed successfully.');
