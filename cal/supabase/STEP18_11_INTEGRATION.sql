-- STEP 18.11 — Integration
-- Central event contracts, STEP 17 coverage health, non-financial compliance domain bridge,
-- and durable-event/journal integrity controls. Additive migration; requires STEP 17 through STEP 18.10.
begin;

create extension if not exists pgcrypto;

do $$ begin
  if to_regclass('public.please_accounting_outbox') is null
     or to_regclass('public.please_domain_events') is null
     or to_regclass('public.accounting_external_events') is null
     or to_regclass('public.accounting_journal_entries') is null
     or to_regclass('public.accounting_posting_rules') is null
     or to_regclass('public.accounting_compliance_approvals') is null
     or to_regprocedure('public.accounting_enqueue_event(text,text,text,text,jsonb,timestamptz,integer,text,text,text)') is null
     or to_regprocedure('public.please_append_domain_event(text,text,text,text,jsonb,timestamptz,integer,text,text,text)') is null then
    raise exception 'STEP 18.11 prerequisites missing. Install STEP 17 through STEP 18.10 first.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1) Explicit event contracts. Financial facts route through STEP 17; compliance
--    workflow facts route only to the immutable domain-event ledger.
-- -----------------------------------------------------------------------------
create table if not exists public.accounting_integration_contracts (
  event_type text primary key,
  domain text not null,
  source_table text not null,
  route text not null check(route in ('FINANCIAL_OUTBOX','DOMAIN_EVENT_ONLY')),
  producer_kind text not null check(producer_kind in ('TRIGGER','RPC')),
  producer_name text not null,
  posting_mode text not null check(posting_mode in ('RULE','CUSTOM','NONE')),
  dependency_event_type text,
  priority integer not null default 100 check(priority between 1 and 1000),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((route='FINANCIAL_OUTBOX' and posting_mode in ('RULE','CUSTOM')) or (route='DOMAIN_EVENT_ONLY' and posting_mode='NONE'))
);

insert into public.accounting_integration_contracts(event_type,domain,source_table,route,producer_kind,producer_name,posting_mode,dependency_event_type,priority,notes) values
 ('INVOICE_ISSUED','A/R','invoices','FINANCIAL_OUTBOX','TRIGGER','trg_step17_accounting_invoice_event','RULE',null,10,'Invoice economic fact.'),
 ('INVOICE_VOIDED','A/R','invoices','FINANCIAL_OUTBOX','TRIGGER','trg_step17_accounting_invoice_event','RULE','INVOICE_ISSUED',30,'Reversal of an issued invoice; draft void may be IGNORED.'),
 ('PAYMENT_RECEIVED','A/R','payment_transactions','FINANCIAL_OUTBOX','TRIGGER','trg_step17_accounting_payment_event','RULE',null,20,'Successful customer payment.'),
 ('STRIPE_FEE_RECORDED','A/R','payment_transactions','FINANCIAL_OUTBOX','TRIGGER','trg_step17_accounting_payment_event','RULE','PAYMENT_RECEIVED',40,'Stripe processing fee follows the payment.'),
 ('PROVIDER_PAYABLE_CREATED','Provider Payments','provider_payments','FINANCIAL_OUTBOX','TRIGGER','trg_step17_accounting_provider_payment_event','RULE',null,10,'Independent-provider payable; PLEASE staff is IGNORED for payroll.'),
 ('PROVIDER_PAYMENT_PAID','Provider Payments','provider_payments','FINANCIAL_OUTBOX','TRIGGER','trg_step17_accounting_provider_payment_event','RULE','PROVIDER_PAYABLE_CREATED',30,'Provider payable settlement.'),
 ('VENDOR_BILL_POSTED','A/P','accounting_supplier_bills','FINANCIAL_OUTBOX','TRIGGER','trg_step18_2_supplier_bill_event','RULE',null,10,'Posted supplier bill.'),
 ('SUPPLIER_PAYMENT_PAID','A/P','accounting_supplier_payments','FINANCIAL_OUTBOX','TRIGGER','trg_step18_2_supplier_payment_event','RULE','VENDOR_BILL_POSTED',30,'Supplier bill settlement.'),
 ('CREDIT_NOTE_ISSUED','A/R','accounting_credit_notes','FINANCIAL_OUTBOX','TRIGGER','trg_step18_3_credit_note_event','RULE','INVOICE_ISSUED',20,'Posted customer credit note.'),
 ('REFUND_COMPLETED','A/R','accounting_customer_refunds','FINANCIAL_OUTBOX','TRIGGER','trg_step18_3_customer_refund_event','RULE','CREDIT_NOTE_ISSUED',30,'Customer refund against actual credit.'),
 ('EXPENSE_POSTED','Expenses','accounting_expense_claims','FINANCIAL_OUTBOX','TRIGGER','trg_step18_4_expense_event','RULE',null,10,'Posted company-paid or reimbursement expense.'),
 ('EXPENSE_REIMBURSEMENT_PAID','Expenses','accounting_expense_reimbursements','FINANCIAL_OUTBOX','TRIGGER','trg_step18_4_expense_reimbursement_event','RULE','EXPENSE_POSTED',30,'Employee/contractor reimbursement settlement.'),
 ('INVENTORY_OPENING_POSTED','Inventory','accounting_inventory_movements','FINANCIAL_OUTBOX','RPC','accounting_inventory_apply_movement','RULE',null,10,'Inventory opening movement.'),
 ('INVENTORY_ISSUE_POSTED','Inventory','accounting_inventory_movements','FINANCIAL_OUTBOX','RPC','accounting_inventory_apply_movement','RULE',null,20,'Inventory issue to COGS.'),
 ('INVENTORY_ADJUSTMENT_POSTED','Inventory','accounting_inventory_movements','FINANCIAL_OUTBOX','RPC','accounting_inventory_apply_movement','RULE',null,20,'Inventory gain/loss adjustment.'),
 ('FIXED_ASSET_OPENING_POSTED','Fixed Assets','accounting_fixed_assets','FINANCIAL_OUTBOX','RPC','accounting_create_opening_fixed_asset','RULE',null,10,'Migrated/opening fixed asset.'),
 ('FIXED_ASSET_DEPRECIATION_POSTED','Fixed Assets','accounting_fixed_asset_depreciation_runs','FINANCIAL_OUTBOX','RPC','accounting_post_fixed_asset_depreciation_run','RULE',null,20,'Book depreciation run.'),
 ('FIXED_ASSET_DISPOSAL_POSTED','Fixed Assets','accounting_fixed_assets','FINANCIAL_OUTBOX','RPC','accounting_dispose_fixed_asset','RULE',null,30,'Asset disposal; worker enforces source dependency.'),
 ('PAYROLL_POSTED','Payroll','accounting_payroll_runs','FINANCIAL_OUTBOX','RPC','accounting_post_payroll_run','RULE',null,10,'Approved payroll posting.'),
 ('PAYROLL_PAID','Payroll','accounting_payroll_runs','FINANCIAL_OUTBOX','RPC','accounting_pay_payroll_run','RULE','PAYROLL_POSTED',30,'Net-pay settlement.'),
 ('PAYROLL_REMITTANCE_PAID','Payroll','accounting_payroll_remittances','FINANCIAL_OUTBOX','RPC','accounting_record_payroll_remittance','RULE',null,30,'CRA source-deduction remittance.'),
 ('PERIOD_CLOSE_ADJUSTMENT_POSTED','Period Close','accounting_period_adjustments','FINANCIAL_OUTBOX','RPC','accounting_create_period_close_adjustment','CUSTOM',null,15,'Balanced adjusting entry supplied as controlled lines.'),
 ('GIFI_WORKING_PAPER_CREATED','Compliance','accounting_gifi_working_papers','DOMAIN_EVENT_ONLY','TRIGGER','trg_step18_11_gifi_domain_event','NONE',null,100,'Compliance trace only; no financial side effect.'),
 ('COMPLIANCE_OBLIGATION_CREATED','Compliance','accounting_compliance_obligations','DOMAIN_EVENT_ONLY','TRIGGER','trg_step18_11_obligation_domain_event','NONE',null,100,'Compliance calendar trace only.'),
 ('COMPLIANCE_APPROVAL_RECORDED','Compliance','accounting_compliance_approvals','DOMAIN_EVENT_ONLY','TRIGGER','trg_step18_11_approval_domain_event','NONE',null,100,'Review/approval trace only.'),
 ('COMPLIANCE_EVIDENCE_RECORDED','Compliance','accounting_filing_evidence','DOMAIN_EVENT_ONLY','TRIGGER','trg_step18_11_evidence_domain_event','NONE',null,100,'External filing/payment evidence trace only.'),
 ('ACCOUNTANT_PACKAGE_CREATED','Compliance','accounting_accountant_packages','DOMAIN_EVENT_ONLY','TRIGGER','trg_step18_11_package_domain_event','NONE',null,100,'Accountant package creation trace only.')
on conflict(event_type) do update set
 domain=excluded.domain,source_table=excluded.source_table,route=excluded.route,producer_kind=excluded.producer_kind,
 producer_name=excluded.producer_name,posting_mode=excluded.posting_mode,dependency_event_type=excluded.dependency_event_type,
 priority=excluded.priority,active=true,notes=excluded.notes,updated_at=now();

alter table public.accounting_integration_contracts enable row level security;
revoke all on public.accounting_integration_contracts from anon,authenticated;
grant select on public.accounting_integration_contracts to service_role;

-- -----------------------------------------------------------------------------
-- 2) Outbox contract guard. This does not replace STEP 17 atomic enqueue; it
--    prevents an unregistered/misrouted financial event from entering the queue.
-- -----------------------------------------------------------------------------
create or replace function public.accounting_integration_outbox_contract_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare c public.accounting_integration_contracts%rowtype;
begin
  if upper(coalesce(new.source_system,'PLEASE'))<>'PLEASE' then return new; end if;
  new.event_type:=upper(btrim(new.event_type));
  select * into c from public.accounting_integration_contracts
   where event_type=new.event_type and active=true and route='FINANCIAL_OUTBOX';
  if not found then raise exception 'Unregistered STEP 17 financial event type: %',new.event_type; end if;
  if coalesce(new.source_table,'')<>c.source_table then
    raise exception 'Financial event % must originate from %, not %',new.event_type,c.source_table,coalesce(new.source_table,'NULL');
  end if;
  return new;
end $$;

drop trigger if exists trg_step18_11_outbox_contract_guard on public.please_accounting_outbox;
create trigger trg_step18_11_outbox_contract_guard
before insert or update of event_type,source_table,source_system on public.please_accounting_outbox
for each row execute function public.accounting_integration_outbox_contract_guard();

-- -----------------------------------------------------------------------------
-- 3) Compliance bridge to immutable PLEASE domain events. These events NEVER use
--    please_accounting_outbox and therefore NEVER create a journal.
-- -----------------------------------------------------------------------------
create or replace function public.accounting_integration_compliance_domain_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v jsonb:=to_jsonb(new);
  v_payload jsonb;
  v_id text:=v->>'id';
  v_ref text;
  v_actor text;
  v_corr text;
begin
  v_payload:=v - 'snapshot_json' - 'payload_json';
  v_ref:=coalesce(v->>'package_number',v->>'paper_number',v->>'confirmation_reference',v->>'obligation_type',v->>'action',v_id);
  v_actor:=coalesce(v->>'actor_id',v->>'recorded_by',v->>'prepared_by',v->>'created_by',v->>'completed_by');
  v_corr:=coalesce(v->>'object_id',v->>'obligation_id',v->>'working_paper_id',v_id);
  perform public.please_append_domain_event(tg_argv[0],tg_table_name,v_id,v_ref,
    jsonb_build_object('step','18.11','route','DOMAIN_EVENT_ONLY','record',v_payload),now(),1,v_actor,v_corr,null);
  return new;
end $$;

drop trigger if exists trg_step18_11_gifi_domain_event on public.accounting_gifi_working_papers;
create trigger trg_step18_11_gifi_domain_event after insert on public.accounting_gifi_working_papers
for each row execute function public.accounting_integration_compliance_domain_trigger('GIFI_WORKING_PAPER_CREATED');
drop trigger if exists trg_step18_11_obligation_domain_event on public.accounting_compliance_obligations;
create trigger trg_step18_11_obligation_domain_event after insert on public.accounting_compliance_obligations
for each row execute function public.accounting_integration_compliance_domain_trigger('COMPLIANCE_OBLIGATION_CREATED');
drop trigger if exists trg_step18_11_approval_domain_event on public.accounting_compliance_approvals;
create trigger trg_step18_11_approval_domain_event after insert on public.accounting_compliance_approvals
for each row execute function public.accounting_integration_compliance_domain_trigger('COMPLIANCE_APPROVAL_RECORDED');
drop trigger if exists trg_step18_11_evidence_domain_event on public.accounting_filing_evidence;
create trigger trg_step18_11_evidence_domain_event after insert on public.accounting_filing_evidence
for each row execute function public.accounting_integration_compliance_domain_trigger('COMPLIANCE_EVIDENCE_RECORDED');
drop trigger if exists trg_step18_11_package_domain_event on public.accounting_accountant_packages;
create trigger trg_step18_11_package_domain_event after insert on public.accounting_accountant_packages
for each row execute function public.accounting_integration_compliance_domain_trigger('ACCOUNTANT_PACKAGE_CREATED');

-- -----------------------------------------------------------------------------
-- 4) Source-fact coverage view. Every row represents one business fact that MUST
--    have one durable STEP 17 event key. Source subledger-only effects (inventory
--    receipts from a bill/expense; fixed-asset source registration) intentionally
--    do not create duplicate financial events.
-- -----------------------------------------------------------------------------
create or replace view public.accounting_expected_financial_events as
select 'INVOICE_ISSUED'::text event_type,'invoices'::text source_table,i.id::text source_record_id,i.invoice_number::text source_reference,
       ('PLEASE:INVOICE_ISSUED:'||i.id::text)::text event_key,coalesce(i.invoice_date,i.created_at::date) effective_date
from public.invoices i where i.status in ('ISSUED','SENT','OVERDUE','PAID')
union all
select 'INVOICE_VOIDED','invoices',i.id::text,i.invoice_number,'PLEASE:INVOICE_VOIDED:'||i.id::text,coalesce(i.voided_at::date,i.updated_at::date,i.created_at::date)
from public.invoices i where i.status='VOID'
union all
select 'PAYMENT_RECEIVED','payment_transactions',p.id::text,coalesce(p.external_reference,p.id::text),'PLEASE:PAYMENT_RECEIVED:'||p.id::text,p.created_at::date
from public.payment_transactions p where p.status='SUCCEEDED'
union all
select 'STRIPE_FEE_RECORDED','payment_transactions',p.id::text,coalesce(p.external_reference,p.id::text),'PLEASE:STRIPE_FEE_RECORDED:'||p.id::text,p.created_at::date
from public.payment_transactions p where p.status='SUCCEEDED' and upper(coalesce(p.provider,''))='STRIPE' and coalesce(p.stripe_fee_amount,0)>0
union all
select 'PROVIDER_PAYABLE_CREATED','provider_payments',p.id::text,coalesce(p.payment_reference,p.id::text),'PLEASE:PROVIDER_PAYABLE_CREATED:'||p.id::text,p.created_at::date
from public.provider_payments p where p.amount>0 and coalesce(p.needs_rate_review,false)=false
union all
select 'PROVIDER_PAYMENT_PAID','provider_payments',p.id::text,coalesce(p.payment_reference,p.id::text),'PLEASE:PROVIDER_PAYMENT_PAID:'||p.id::text,coalesce(p.paid_at::date,p.updated_at::date,p.created_at::date)
from public.provider_payments p where p.status='PAID' and p.amount>0 and coalesce(p.needs_rate_review,false)=false
union all
select 'VENDOR_BILL_POSTED','accounting_supplier_bills',b.id::text,b.bill_number,'PLEASE:VENDOR_BILL_POSTED:'||b.id::text,coalesce(b.posted_at::date,b.updated_at::date,b.created_at::date)
from public.accounting_supplier_bills b where b.status in ('POSTED','PARTIAL','PAID')
union all
select 'SUPPLIER_PAYMENT_PAID','accounting_supplier_payments',p.id::text,p.payment_number,'PLEASE:SUPPLIER_PAYMENT_PAID:'||p.id::text,coalesce(p.paid_at::date,p.created_at::date)
from public.accounting_supplier_payments p where p.status='PAID'
union all
select 'CREDIT_NOTE_ISSUED','accounting_credit_notes',n.id::text,n.credit_note_number,'PLEASE:CREDIT_NOTE_ISSUED:'||n.id::text,coalesce(n.posted_at::date,n.updated_at::date,n.created_at::date)
from public.accounting_credit_notes n where n.status='POSTED'
union all
select 'REFUND_COMPLETED','accounting_customer_refunds',r.id::text,r.refund_number,'PLEASE:REFUND_COMPLETED:'||r.id::text,coalesce(r.completed_at::date,r.created_at::date)
from public.accounting_customer_refunds r where r.status='COMPLETED'
union all
select 'EXPENSE_POSTED','accounting_expense_claims',e.id::text,e.expense_number,'PLEASE:EXPENSE_POSTED:'||e.id::text,coalesce(e.posted_at::date,e.updated_at::date,e.created_at::date)
from public.accounting_expense_claims e where e.status in ('POSTED','PAID')
union all
select 'EXPENSE_REIMBURSEMENT_PAID','accounting_expense_reimbursements',r.id::text,r.reimbursement_number,'PLEASE:EXPENSE_REIMBURSEMENT_PAID:'||r.id::text,coalesce(r.paid_at::date,r.created_at::date)
from public.accounting_expense_reimbursements r where r.status='PAID'
union all
select m.financial_event_type,'accounting_inventory_movements',m.id::text,m.movement_number,'PLEASE:'||m.financial_event_type||':'||m.id::text,m.movement_date
from public.accounting_inventory_movements m where m.financial_event_type is not null
union all
select 'FIXED_ASSET_OPENING_POSTED','accounting_fixed_assets',a.id::text,a.asset_number,'PLEASE:FIXED_ASSET_OPENING_POSTED:'||a.id::text,a.purchase_date
from public.accounting_fixed_assets a where upper(coalesce(a.source_type,''))='OPENING'
union all
select 'FIXED_ASSET_DEPRECIATION_POSTED','accounting_fixed_asset_depreciation_runs',r.id::text,r.run_number,'PLEASE:FIXED_ASSET_DEPRECIATION_POSTED:'||r.id::text,r.period_end
from public.accounting_fixed_asset_depreciation_runs r where r.status='POSTED'
union all
select 'FIXED_ASSET_DISPOSAL_POSTED','accounting_fixed_assets',a.id::text,a.asset_number,'PLEASE:FIXED_ASSET_DISPOSAL_POSTED:'||a.id::text,a.disposal_date
from public.accounting_fixed_assets a where a.status='DISPOSED'
union all
select 'PAYROLL_POSTED','accounting_payroll_runs',r.id::text,r.run_number,'PLEASE:PAYROLL_POSTED:'||r.id::text,r.payment_date
from public.accounting_payroll_runs r where r.status in ('POSTED','PAID')
union all
select 'PAYROLL_PAID','accounting_payroll_runs',r.id::text,r.run_number,'PLEASE:PAYROLL_PAID:'||r.id::text,coalesce(r.paid_at::date,r.payment_date)
from public.accounting_payroll_runs r where r.status='PAID'
union all
select 'PAYROLL_REMITTANCE_PAID','accounting_payroll_remittances',r.id::text,r.remittance_number,'PLEASE:PAYROLL_REMITTANCE_PAID:'||r.id::text,r.remittance_date
from public.accounting_payroll_remittances r where r.status='PAID'
union all
select 'PERIOD_CLOSE_ADJUSTMENT_POSTED','accounting_period_adjustments',a.id::text,a.adjustment_number,'PLEASE:PERIOD_CLOSE_ADJUSTMENT_POSTED:'||a.id::text,a.entry_date
from public.accounting_period_adjustments a where a.status='POSTED';

revoke all on public.accounting_expected_financial_events from anon,authenticated;
grant select on public.accounting_expected_financial_events to service_role;

-- -----------------------------------------------------------------------------
-- 5) Contract/data exceptions and aggregate health.
-- -----------------------------------------------------------------------------
create or replace function public.accounting_integration_exceptions(p_limit integer default 500)
returns table(
  severity text,issue_code text,event_key text,event_type text,source_table text,source_record_id text,
  outbox_status text,journal_entry_id uuid,details text,detected_at timestamptz
) language sql security definer set search_path=public as $$
with contract_issues as (
  select 'BLOCKER'::text severity,'SOURCE_TABLE_MISSING'::text issue_code,null::text event_key,c.event_type,c.source_table,null::text source_record_id,null::text outbox_status,null::uuid journal_entry_id,
         ('Registered source table is missing: '||c.source_table)::text details,now() detected_at
  from public.accounting_integration_contracts c where c.active and to_regclass('public.'||c.source_table) is null
  union all
  select 'BLOCKER','PRODUCER_MISSING',null,c.event_type,c.source_table,null,null,null,
         ('Registered producer is missing: '||c.producer_name),now()
  from public.accounting_integration_contracts c
  where c.active and ((c.producer_kind='TRIGGER' and not exists(select 1 from pg_trigger t where t.tgname=c.producer_name and not t.tgisinternal))
                   or (c.producer_kind='RPC' and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=c.producer_name)))
  union all
  select 'BLOCKER','POSTING_RULE_MISSING',null,c.event_type,c.source_table,null,null,null,
         'Financial event contract requires an enabled posting rule.',now()
  from public.accounting_integration_contracts c
  where c.active and c.route='FINANCIAL_OUTBOX' and c.posting_mode='RULE'
    and not exists(select 1 from public.accounting_posting_rules r where r.source_system='PLEASE' and r.event_type=c.event_type and r.enabled=true)
), data_issues as (
  select 'BLOCKER'::text,'MISSING_DURABLE_EVENT'::text,e.event_key,e.event_type,e.source_table,e.source_record_id,null::text,null::uuid,
         'Business financial fact has no durable STEP 17 event.'::text,now()
  from public.accounting_expected_financial_events e left join public.please_accounting_outbox o on o.event_key=e.event_key where o.id is null
  union all
  select 'BLOCKER','UNREGISTERED_OUTBOX_EVENT',o.event_key,o.event_type,o.source_table,o.source_record_id,o.status,o.cal_journal_entry_id,
         'PLEASE outbox event is not registered as an active financial contract.',now()
  from public.please_accounting_outbox o
  where upper(coalesce(o.source_system,'PLEASE'))='PLEASE' and not exists(select 1 from public.accounting_integration_contracts c where c.event_type=o.event_type and c.active and c.route='FINANCIAL_OUTBOX')
  union all
  select 'BLOCKER','SOURCE_CONTRACT_MISMATCH',o.event_key,o.event_type,o.source_table,o.source_record_id,o.status,o.cal_journal_entry_id,
         ('Expected source table '||c.source_table||'.'),now()
  from public.please_accounting_outbox o join public.accounting_integration_contracts c on c.event_type=o.event_type and c.active and c.route='FINANCIAL_OUTBOX'
  where coalesce(o.source_table,'')<>c.source_table
  union all
  select 'BLOCKER','DEAD_LETTER',o.event_key,o.event_type,o.source_table,o.source_record_id,o.status,o.cal_journal_entry_id,
         coalesce(o.last_error,'Accounting event exhausted retry policy.'),now()
  from public.please_accounting_outbox o where o.status='DEAD_LETTER'
  union all
  select 'REVIEW','STALE_QUEUE_ITEM',o.event_key,o.event_type,o.source_table,o.source_record_id,o.status,o.cal_journal_entry_id,
         ('Queue item has remained open since '||coalesce(o.processing_started_at,o.created_at)::text),now()
  from public.please_accounting_outbox o
  where o.status in ('PENDING','RETRY','ERROR','PROCESSING') and coalesce(o.processing_started_at,o.created_at)<now()-interval '15 minutes'
  union all
  select 'BLOCKER','POSTED_WITHOUT_EXTERNAL_EVENT',o.event_key,o.event_type,o.source_table,o.source_record_id,o.status,o.cal_journal_entry_id,
         'POSTED outbox row has no CAL external-event id.',now()
  from public.please_accounting_outbox o where o.status='POSTED' and o.cal_event_id is null
  union all
  select 'BLOCKER','POSTED_WITHOUT_JOURNAL',o.event_key,o.event_type,o.source_table,o.source_record_id,o.status,o.cal_journal_entry_id,
         'POSTED outbox row has no journal entry id.',now()
  from public.please_accounting_outbox o where o.status='POSTED' and o.cal_journal_entry_id is null
  union all
  select 'BLOCKER','JOURNAL_NOT_POSTED',o.event_key,o.event_type,o.source_table,o.source_record_id,o.status,o.cal_journal_entry_id,
         ('Linked journal status is '||coalesce(j.status,'MISSING')||'.'),now()
  from public.please_accounting_outbox o left join public.accounting_journal_entries j on j.id=o.cal_journal_entry_id
  where o.status='POSTED' and (j.id is null or j.status<>'POSTED')
  union all
  select 'BLOCKER','IGNORED_WITH_JOURNAL',o.event_key,o.event_type,o.source_table,o.source_record_id,o.status,o.cal_journal_entry_id,
         'IGNORED financial event must not have a journal.',now()
  from public.please_accounting_outbox o where o.status='IGNORED' and o.cal_journal_entry_id is not null
)
select * from (select * from contract_issues union all select * from data_issues) x
order by case severity when 'BLOCKER' then 1 else 2 end,issue_code,event_type,event_key nulls first
limit greatest(1,least(coalesce(p_limit,500),5000));
$$;

create or replace function public.accounting_integration_health()
returns jsonb language sql security definer set search_path=public as $$
with c as (
  select count(*) filter(where active and route='FINANCIAL_OUTBOX')::int financial_contracts,
         count(*) filter(where active and route='DOMAIN_EVENT_ONLY')::int domain_contracts
  from public.accounting_integration_contracts
), e as (select count(*)::int expected_events from public.accounting_expected_financial_events),
q as (
  select count(*) filter(where status='PENDING')::int pending,
         count(*) filter(where status='PROCESSING')::int processing,
         count(*) filter(where status in ('RETRY','ERROR'))::int retrying,
         count(*) filter(where status='DEAD_LETTER')::int dead_letter,
         count(*) filter(where status='POSTED')::int posted,
         count(*) filter(where status='IGNORED')::int ignored
  from public.please_accounting_outbox
), x as (
  select count(*) filter(where severity='BLOCKER')::int blockers,
         count(*) filter(where severity='REVIEW')::int reviews,
         count(*) filter(where issue_code='MISSING_DURABLE_EVENT')::int missing_events,
         count(*) filter(where issue_code='POSTED_WITHOUT_JOURNAL')::int posted_without_journal,
         count(*) filter(where issue_code='UNREGISTERED_OUTBOX_EVENT')::int unregistered_events,
         count(*) filter(where issue_code='PRODUCER_MISSING')::int missing_producers,
         count(*) filter(where issue_code='POSTING_RULE_MISSING')::int missing_rules
  from public.accounting_integration_exceptions(5000)
), d as (
  select count(*)::int compliance_domain_events from public.please_domain_events
  where event_type in ('GIFI_WORKING_PAPER_CREATED','COMPLIANCE_OBLIGATION_CREATED','COMPLIANCE_APPROVAL_RECORDED','COMPLIANCE_EVIDENCE_RECORDED','ACCOUNTANT_PACKAGE_CREATED')
)
select jsonb_build_object(
 'status',case when x.blockers>0 then 'BLOCKED' when x.reviews>0 or q.retrying>0 or q.processing>0 then 'ATTENTION' else 'HEALTHY' end,
 'financial_contracts',c.financial_contracts,'domain_contracts',c.domain_contracts,'expected_financial_events',e.expected_events,
 'blockers',x.blockers,'reviews',x.reviews,'missing_events',x.missing_events,'posted_without_journal',x.posted_without_journal,
 'unregistered_events',x.unregistered_events,'missing_producers',x.missing_producers,'missing_rules',x.missing_rules,
 'queue',jsonb_build_object('pending',q.pending,'processing',q.processing,'retrying',q.retrying,'dead_letter',q.dead_letter,'posted',q.posted,'ignored',q.ignored),
 'compliance_domain_events',d.compliance_domain_events,'checked_at',now())
from c,e,q,x,d;
$$;

-- Browser roles never access integration contracts/health directly.
revoke all on function public.accounting_integration_exceptions(integer) from public,anon,authenticated;
revoke all on function public.accounting_integration_health() from public,anon,authenticated;
revoke all on function public.accounting_integration_outbox_contract_guard() from public,anon,authenticated;
revoke all on function public.accounting_integration_compliance_domain_trigger() from public,anon,authenticated;
grant execute on function public.accounting_integration_exceptions(integer) to service_role;
grant execute on function public.accounting_integration_health() to service_role;

comment on table public.accounting_integration_contracts is 'STEP 18.11 event contract registry. Financial routes must use STEP 17 durable outbox; compliance routes are domain-event only.';
comment on view public.accounting_expected_financial_events is 'Business financial facts that must have one idempotent STEP 17 durable event key.';
comment on function public.accounting_integration_health() is 'Cross-module integration health for source facts, durable events, worker contract and posted journals.';

commit;
