-- PLEASE STEP 17 — Native Event-Driven Accounting Engine
-- Safe additive migration. Run AFTER STEP16_0_CAL_PLEASE_ACCOUNTING_BRIDGE.sql.
--
-- Core invariant:
--   no accounting side effect without a durable event;
--   financial events are created by PostgreSQL triggers in the SAME transaction
--   that writes the operational record; a worker posts CAL asynchronously.

begin;
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) Domain event ledger (operational audit/event stream, separate from accounting)
-- -----------------------------------------------------------------------------
create table if not exists public.please_domain_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  event_version int not null default 1,
  source_table text not null,
  source_record_id text,
  source_reference text,
  occurred_at timestamptz not null default now(),
  actor_id text,
  correlation_id text,
  causation_id text,
  payload_json jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists please_domain_events_source_idx
  on public.please_domain_events(source_table,source_record_id,occurred_at desc);
create index if not exists please_domain_events_type_idx
  on public.please_domain_events(event_type,occurred_at desc);

-- -----------------------------------------------------------------------------
-- 2) Upgrade STEP 16 outbox into a durable accounting queue
-- -----------------------------------------------------------------------------
alter table public.please_accounting_outbox add column if not exists source_system text not null default 'PLEASE';
alter table public.please_accounting_outbox add column if not exists event_version int not null default 1;
alter table public.please_accounting_outbox add column if not exists correlation_id text;
alter table public.please_accounting_outbox add column if not exists causation_id text;
alter table public.please_accounting_outbox add column if not exists actor_id text;
alter table public.please_accounting_outbox add column if not exists next_attempt_at timestamptz;
alter table public.please_accounting_outbox add column if not exists processing_started_at timestamptz;
alter table public.please_accounting_outbox add column if not exists processing_by text;
alter table public.please_accounting_outbox add column if not exists processed_at timestamptz;
alter table public.please_accounting_outbox add column if not exists dead_letter_at timestamptz;
alter table public.please_accounting_outbox add column if not exists last_duration_ms integer;

alter table public.please_accounting_outbox drop constraint if exists please_accounting_outbox_status_check;
update public.please_accounting_outbox
set status='RETRY', next_attempt_at=coalesce(next_attempt_at,now())
where status='ERROR';
update public.please_accounting_outbox
set next_attempt_at=coalesce(next_attempt_at,created_at,now())
where next_attempt_at is null;
alter table public.please_accounting_outbox
  add constraint please_accounting_outbox_status_check
  check(status in ('PENDING','PROCESSING','POSTED','RETRY','IGNORED','DEAD_LETTER','ERROR')); -- ERROR retained only for STEP 16 transition compatibility

create index if not exists please_accounting_outbox_ready_idx
  on public.please_accounting_outbox(status,next_attempt_at,occurred_at,created_at);
create index if not exists please_accounting_outbox_correlation_idx
  on public.please_accounting_outbox(correlation_id,created_at desc);

-- More traceability on CAL's immutable external-event ledger.
alter table public.accounting_external_events add column if not exists correlation_id text;
alter table public.accounting_external_events add column if not exists causation_id text;
alter table public.accounting_external_events add column if not exists actor_id text;
alter table public.accounting_external_events add column if not exists worker_id text;
alter table public.accounting_external_events add column if not exists duration_ms integer;

-- Structured Stripe webhook traceability when STEP 17 is deployed.
alter table public.payment_transactions add column if not exists stripe_webhook_event_id text;
create index if not exists payment_transactions_stripe_webhook_idx on public.payment_transactions(stripe_webhook_event_id) where stripe_webhook_event_id is not null;

-- Posting rules become versioned/configurable instead of being documentation only.
alter table public.accounting_posting_rules add column if not exists rule_version int not null default 1;
alter table public.accounting_posting_rules add column if not exists configuration_json jsonb not null default '{}'::jsonb;

update public.accounting_posting_rules
set configuration_json='{"stripe_debit":"1090","manual_debit":"1000"}'::jsonb
where source_system='PLEASE' and event_type='PAYMENT_RECEIVED';

-- -----------------------------------------------------------------------------
-- 3) Immutable operational domain-event append function
-- -----------------------------------------------------------------------------
create or replace function public.please_append_domain_event(
  p_event_type text,
  p_source_table text,
  p_source_record_id text,
  p_source_reference text,
  p_payload jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default now(),
  p_event_version int default 1,
  p_actor_id text default null,
  p_correlation_id text default null,
  p_causation_id text default null
) returns uuid
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_id uuid;
  v_payload jsonb:=coalesce(p_payload,'{}'::jsonb);
  v_hash text;
begin
  v_hash:=encode(digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex');
  insert into public.please_domain_events(
    event_type,event_version,source_table,source_record_id,source_reference,
    occurred_at,actor_id,correlation_id,causation_id,payload_json,payload_hash
  ) values(
    upper(trim(p_event_type)),greatest(1,coalesce(p_event_version,1)),p_source_table,p_source_record_id,p_source_reference,
    coalesce(p_occurred_at,now()),p_actor_id,p_correlation_id,p_causation_id,v_payload,v_hash
  ) returning id into v_id;
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- 4) Durable financial-event enqueue function
--    ON CONFLICT never reopens POSTED/IGNORED events; a changed source can revive
--    a Dead Letter event for safe retry without creating a duplicate key.
-- -----------------------------------------------------------------------------
create or replace function public.accounting_enqueue_event(
  p_event_type text,
  p_source_table text,
  p_source_record_id text,
  p_source_reference text,
  p_payload jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default now(),
  p_event_version int default 1,
  p_actor_id text default null,
  p_correlation_id text default null,
  p_causation_id text default null
) returns uuid
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_id uuid;
  v_type text:=upper(trim(p_event_type));
  v_key text;
  v_payload jsonb:=coalesce(p_payload,'{}'::jsonb);
  v_hash text;
begin
  if v_type is null or v_type='' then raise exception 'Accounting event type is required'; end if;
  v_key:='PLEASE:'||v_type||':'||coalesce(nullif(p_source_record_id,''),'none');
  v_hash:=encode(digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex');

  insert into public.please_accounting_outbox(
    event_key,source_system,event_type,event_version,source_table,source_record_id,source_reference,
    occurred_at,payload_json,payload_hash,status,attempts,next_attempt_at,actor_id,correlation_id,causation_id,updated_at
  ) values(
    v_key,'PLEASE',v_type,greatest(1,coalesce(p_event_version,1)),p_source_table,p_source_record_id,p_source_reference,
    coalesce(p_occurred_at,now()),v_payload,v_hash,'PENDING',0,now(),p_actor_id,p_correlation_id,p_causation_id,now()
  )
  on conflict(event_key) do update set
    source_reference=coalesce(excluded.source_reference,public.please_accounting_outbox.source_reference),
    correlation_id=coalesce(excluded.correlation_id,public.please_accounting_outbox.correlation_id),
    causation_id=coalesce(excluded.causation_id,public.please_accounting_outbox.causation_id),
    actor_id=coalesce(excluded.actor_id,public.please_accounting_outbox.actor_id),
    payload_json=case when public.please_accounting_outbox.status in ('PENDING','RETRY','DEAD_LETTER') then excluded.payload_json else public.please_accounting_outbox.payload_json end,
    payload_hash=case when public.please_accounting_outbox.status in ('PENDING','RETRY','DEAD_LETTER') then excluded.payload_hash else public.please_accounting_outbox.payload_hash end,
    status=case
      when public.please_accounting_outbox.status='DEAD_LETTER' and public.please_accounting_outbox.payload_hash<>excluded.payload_hash then 'RETRY'
      else public.please_accounting_outbox.status
    end,
    next_attempt_at=case
      when public.please_accounting_outbox.status='DEAD_LETTER' and public.please_accounting_outbox.payload_hash<>excluded.payload_hash then now()
      else public.please_accounting_outbox.next_attempt_at
    end,
    dead_letter_at=case
      when public.please_accounting_outbox.status='DEAD_LETTER' and public.please_accounting_outbox.payload_hash<>excluded.payload_hash then null
      else public.please_accounting_outbox.dead_letter_at
    end,
    attempts=case
      when public.please_accounting_outbox.status in ('RETRY','DEAD_LETTER') and public.please_accounting_outbox.payload_hash<>excluded.payload_hash then 0
      else public.please_accounting_outbox.attempts
    end,
    last_error=case
      when public.please_accounting_outbox.status in ('RETRY','DEAD_LETTER') and public.please_accounting_outbox.payload_hash<>excluded.payload_hash then null
      else public.please_accounting_outbox.last_error
    end,
    updated_at=now()
  returning id into v_id;

  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- 5) Generic domain triggers for major operational milestones
-- -----------------------------------------------------------------------------
create or replace function public.please_domain_insert_trigger()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v jsonb:=to_jsonb(new);
  v_ref text;
  v_actor text;
  v_corr text;
  v_at timestamptz:=now();
begin
  v_ref:=coalesce(v->>'reference',v->>'invoice_number',v->>'payment_reference',v->>'id');
  v_actor:=coalesce(v->>'created_by_admin_portal_user',v->>'created_by_portal_user',v->>'provider_id');
  v_corr:=coalesce(v->>'job_id',v->>'invoice_id',v->>'customer_id',v->>'service_request_id',v->>'id');
  begin v_at:=coalesce(nullif(v->>'created_at','')::timestamptz,now()); exception when others then v_at:=now(); end;
  perform public.please_append_domain_event(
    tg_argv[0],tg_table_name,v->>'id',v_ref,
    jsonb_build_object('id',v->>'id','reference',v_ref,'status',v->>'status'),
    v_at,1,v_actor,v_corr,null
  );
  return new;
end $$;

create or replace function public.please_domain_status_trigger()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v jsonb:=to_jsonb(new);
  vo jsonb:=to_jsonb(old);
  v_ref text;
begin
  if (vo->>'status') is distinct from (v->>'status') then
    v_ref:=coalesce(v->>'reference',v->>'invoice_number',v->>'payment_reference',v->>'id');
    perform public.please_append_domain_event(
      tg_argv[0],tg_table_name,v->>'id',v_ref,
      jsonb_build_object('id',v->>'id','reference',v_ref,'old_status',vo->>'status','new_status',v->>'status'),
      now(),1,coalesce(v->>'updated_by_admin_portal_user',v->>'paid_by_admin_portal_user'),
      coalesce(v->>'job_id',v->>'invoice_id',v->>'customer_id',v->>'id'),null
    );
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 6) Financial triggers: source transaction + durable event are atomic
-- -----------------------------------------------------------------------------
create or replace function public.accounting_invoice_event_trigger()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v jsonb:=to_jsonb(new);
  vo jsonb:=case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_ref text:=v->>'invoice_number';
  v_actor text:=coalesce(v->>'created_by_admin_portal_user',v->>'updated_by_admin_portal_user');
begin
  -- Any financially issued state guarantees that the issue event exists.
  if upper(coalesce(v->>'status','')) in ('ISSUED','SENT','OVERDUE','PAID') then
    perform public.accounting_enqueue_event(
      'INVOICE_ISSUED','invoices',v->>'id',v_ref,
      jsonb_build_object('invoice',v),
      coalesce(nullif(v->>'issued_at','')::timestamptz,nullif(v->>'sent_at','')::timestamptz,nullif(v->>'created_at','')::timestamptz,now()),
      1,v_actor,coalesce(v->>'job_id',v->>'id'),null
    );
  end if;

  if upper(coalesce(v->>'status',''))='VOID' and upper(coalesce(vo->>'status',''))<>'VOID' then
    -- If the invoice was previously issued, preserve that economic event before the reversal.
    if upper(coalesce(vo->>'status','')) not in ('','DRAFT') then
      perform public.accounting_enqueue_event(
        'INVOICE_ISSUED','invoices',v->>'id',v_ref,
        jsonb_build_object('invoice',vo),
        coalesce(nullif(vo->>'issued_at','')::timestamptz,nullif(vo->>'sent_at','')::timestamptz,nullif(vo->>'created_at','')::timestamptz,now()),
        1,v_actor,coalesce(v->>'job_id',v->>'id'),null
      );
    end if;
    perform public.accounting_enqueue_event(
      'INVOICE_VOIDED','invoices',v->>'id',v_ref,
      jsonb_build_object('invoice',v,'previous_status',vo->>'status'),
      coalesce(nullif(v->>'voided_at','')::timestamptz,now()),
      1,v_actor,coalesce(v->>'job_id',v->>'id'),'PLEASE:INVOICE_ISSUED:'||(v->>'id')
    );
  end if;

  perform public.please_append_domain_event(
    case when upper(coalesce(v->>'status',''))='VOID' then 'INVOICE_VOIDED' else 'INVOICE_CHANGED' end,
    'invoices',v->>'id',v_ref,
    jsonb_build_object('invoice_id',v->>'id','status',v->>'status','payment_status',v->>'payment_status'),
    now(),1,v_actor,coalesce(v->>'job_id',v->>'id'),null
  );
  return new;
end $$;

create or replace function public.accounting_payment_event_trigger()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v jsonb:=to_jsonb(new);
  vo jsonb:=case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_actor text:=case when upper(coalesce(v->>'provider',''))='STRIPE' then coalesce(v->>'stripe_webhook_event_id','STRIPE') else v->>'created_by_admin_portal_user' end;
  v_corr text:=coalesce(v->>'invoice_id',v->>'id');
begin
  if upper(coalesce(v->>'status',''))='SUCCEEDED' then
    perform public.accounting_enqueue_event(
      'PAYMENT_RECEIVED','payment_transactions',v->>'id',coalesce(v->>'external_reference',v->>'id'),
      jsonb_build_object('payment_transaction',v),
      coalesce(nullif(v->>'created_at','')::timestamptz,now()),1,v_actor,v_corr,null
    );
    if upper(coalesce(v->>'provider',''))='STRIPE' and coalesce(nullif(v->>'stripe_fee_amount','')::numeric,0)>0 then
      perform public.accounting_enqueue_event(
        'STRIPE_FEE_RECORDED','payment_transactions',v->>'id',coalesce(v->>'external_reference',v->>'id'),
        jsonb_build_object('payment_transaction',v,'fee_amount',nullif(v->>'stripe_fee_amount','')::numeric),
        coalesce(nullif(v->>'created_at','')::timestamptz,now()),1,v_actor,v_corr,'PLEASE:PAYMENT_RECEIVED:'||(v->>'id')
      );
    end if;
  end if;

  if upper(coalesce(v->>'status',''))='REFUNDED' and upper(coalesce(vo->>'status',''))<>'REFUNDED' then
    -- A refund is preserved in the domain ledger. It is intentionally NOT auto-posted
    -- until PLEASE has a dedicated refund/credit-note source document and allocation flow.
    perform public.please_append_domain_event(
      'PAYMENT_REFUNDED_REQUIRES_ACCOUNTING_REVIEW','payment_transactions',v->>'id',coalesce(v->>'external_reference',v->>'id'),
      jsonb_build_object('payment_transaction_id',v->>'id','invoice_id',v->>'invoice_id','amount',v->>'amount','provider',v->>'provider'),
      now(),1,v_actor,v_corr,'PLEASE:PAYMENT_RECEIVED:'||(v->>'id')
    );
  else
    perform public.please_append_domain_event(
      'PAYMENT_TRANSACTION_CHANGED','payment_transactions',v->>'id',coalesce(v->>'external_reference',v->>'id'),
      jsonb_build_object('payment_transaction_id',v->>'id','invoice_id',v->>'invoice_id','status',v->>'status','provider',v->>'provider'),
      now(),1,v_actor,v_corr,null
    );
  end if;
  return new;
end $$;

create or replace function public.accounting_provider_payment_event_trigger()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v jsonb:=to_jsonb(new);
  vo jsonb:=case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_ref text:=coalesce(v->>'payment_reference',v->>'id');
  v_actor text:=coalesce(v->>'paid_by_admin_portal_user',v->>'created_by_admin_portal_user');
  v_corr text:=coalesce(v->>'job_id',v->>'id');
begin
  if coalesce(nullif(v->>'amount','')::numeric,0)>0 and coalesce((v->>'needs_rate_review')::boolean,false)=false then
    perform public.accounting_enqueue_event(
      'PROVIDER_PAYABLE_CREATED','provider_payments',v->>'id',v_ref,
      jsonb_build_object('provider_payment',v),
      coalesce(nullif(v->>'created_at','')::timestamptz,now()),1,v_actor,v_corr,null
    );
  end if;

  if upper(coalesce(v->>'status',''))='PAID' and upper(coalesce(vo->>'status',''))<>'PAID' then
    perform public.accounting_enqueue_event(
      'PROVIDER_PAYMENT_PAID','provider_payments',v->>'id',v_ref,
      jsonb_build_object('provider_payment',v),
      coalesce(nullif(v->>'paid_at','')::timestamptz,now()),1,v_actor,v_corr,'PLEASE:PROVIDER_PAYABLE_CREATED:'||(v->>'id')
    );
  end if;

  perform public.please_append_domain_event(
    case when upper(coalesce(v->>'status',''))='PAID' then 'PROVIDER_PAYMENT_PAID' else 'PROVIDER_PAYABLE_CHANGED' end,
    'provider_payments',v->>'id',v_ref,
    jsonb_build_object('provider_payment_id',v->>'id','job_id',v->>'job_id','provider_id',v->>'provider_id','status',v->>'status','amount',v->>'amount'),
    now(),1,v_actor,v_corr,null
  );
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 7) Concurrency-safe queue claim / stale-claim recovery / health RPCs
-- -----------------------------------------------------------------------------
create or replace function public.accounting_release_stale_claims(p_stale_minutes int default 10)
returns int
language plpgsql
security definer
set search_path=public
as $$
declare v_count int;
begin
  update public.please_accounting_outbox
  set status='RETRY',processing_started_at=null,processing_by=null,
      next_attempt_at=now(),last_error=coalesce(last_error,'Worker claim expired before completion.'),updated_at=now()
  where status='PROCESSING'
    and processing_started_at < now() - make_interval(mins=>greatest(1,least(coalesce(p_stale_minutes,10),120)));
  get diagnostics v_count=row_count;
  return v_count;
end $$;

create or replace function public.accounting_claim_outbox(p_limit int default 25,p_worker_id text default null)
returns setof public.please_accounting_outbox
language plpgsql
security definer
set search_path=public
as $$
begin
  return query
  with claimable as (
    select id
    from public.please_accounting_outbox
    where status in ('PENDING','RETRY','ERROR')
      and coalesce(next_attempt_at,now())<=now()
    order by occurred_at asc,created_at asc
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,25),100))
  )
  update public.please_accounting_outbox o
  set status='PROCESSING',attempts=o.attempts+1,processing_started_at=now(),
      processing_by=coalesce(nullif(p_worker_id,''),'cal-worker'),updated_at=now()
  from claimable c
  where o.id=c.id
  returning o.*;
end $$;

create or replace function public.accounting_engine_health()
returns jsonb
language sql
security definer
set search_path=public
as $$
  with q as (
    select
      count(*) filter(where status='PENDING')::int pending,
      count(*) filter(where status='PROCESSING')::int processing,
      count(*) filter(where status in ('RETRY','ERROR'))::int retrying,
      count(*) filter(where status='DEAD_LETTER')::int dead_letter,
      count(*) filter(where status in ('POSTED','IGNORED') and processed_at>=date_trunc('day',now()))::int processed_today,
      round(coalesce(avg(last_duration_ms) filter(where last_duration_ms is not null and processed_at>=now()-interval '24 hours'),0),1) average_ms,
      min(created_at) filter(where status in ('PENDING','RETRY','ERROR','PROCESSING')) oldest_pending_at
    from public.please_accounting_outbox
  ), last_evt as (
    select event_type,source_reference,status,processed_at,occurred_at
    from public.please_accounting_outbox
    where status in ('POSTED','IGNORED','DEAD_LETTER')
    order by coalesce(processed_at,updated_at,created_at) desc
    limit 1
  )
  select jsonb_build_object(
    'status',case when q.dead_letter>0 then 'ACTION_REQUIRED' when q.retrying>0 or q.oldest_pending_at < now()-interval '5 minutes' then 'DEGRADED' else 'HEALTHY' end,
    'pending',q.pending,'processing',q.processing,'retrying',q.retrying,'dead_letter',q.dead_letter,
    'processed_today',q.processed_today,'average_ms',q.average_ms,'oldest_pending_at',q.oldest_pending_at,
    'last_event',(select to_jsonb(last_evt) from last_evt)
  ) from q;
$$;

-- Explicit developer recovery for a repaired Dead Letter event. Not a daily Sync action.
create or replace function public.accounting_requeue_dead_letter(p_event_key text)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare v_count int;
begin
  update public.please_accounting_outbox
  set status='RETRY',attempts=0,next_attempt_at=now(),dead_letter_at=null,processed_at=null,processing_started_at=null,processing_by=null,last_error=null,updated_at=now()
  where event_key=p_event_key and status='DEAD_LETTER';
  get diagnostics v_count=row_count;
  return v_count>0;
end $$;

-- -----------------------------------------------------------------------------
-- 8) Atomic journal posting RPC
--    Journal header + lines + POSTED state + external-event linkage commit together.
-- -----------------------------------------------------------------------------
create or replace function public.accounting_post_event_journal(
  p_event_id uuid,
  p_entry_date date,
  p_memo text,
  p_lines jsonb
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_event public.accounting_external_events%rowtype;
  v_entry_id uuid;
  v_entry_status text;
  v_entry_number text;
  v_line record;
  v_account_id uuid;
  v_debits numeric(14,2):=0;
  v_credits numeric(14,2):=0;
begin
  select * into v_event
  from public.accounting_external_events
  where id=p_event_id
  for update;
  if not found then raise exception 'Accounting external event not found: %',p_event_id; end if;

  if v_event.posting_status='POSTED' and v_event.journal_entry_id is not null then
    return v_event.journal_entry_id;
  end if;

  if jsonb_typeof(coalesce(p_lines,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines,'[]'::jsonb))=0 then
    raise exception 'Accounting journal requires at least one line.';
  end if;

  select id,status into v_entry_id,v_entry_status
  from public.accounting_journal_entries
  where source_type='PLEASE_EVENT' and source_id=p_event_id
  limit 1
  for update;

  if v_entry_id is not null and v_entry_status='POSTED' then
    update public.accounting_external_events
    set posting_status='POSTED',journal_entry_id=v_entry_id,error_message=null,processed_at=now()
    where id=p_event_id;
    return v_entry_id;
  end if;

  if v_entry_id is not null and v_entry_status<>'DRAFT' then
    raise exception 'Existing journal % is in unsupported state %',v_entry_id,v_entry_status;
  end if;

  if v_entry_id is null then
    v_entry_id:=gen_random_uuid();
    v_entry_number:='CAL-JE-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
    insert into public.accounting_journal_entries(id,entry_number,entry_date,memo,source_type,source_id,status)
    values(v_entry_id,v_entry_number,coalesce(p_entry_date,current_date),left(coalesce(p_memo,'PLEASE accounting event'),500),'PLEASE_EVENT',p_event_id,'DRAFT');
  else
    delete from public.accounting_journal_lines where journal_entry_id=v_entry_id;
    update public.accounting_journal_entries
    set entry_date=coalesce(p_entry_date,current_date),memo=left(coalesce(p_memo,'PLEASE accounting event'),500)
    where id=v_entry_id;
  end if;

  for v_line in
    select * from jsonb_to_recordset(p_lines) as x(code text,debit numeric,credit numeric,description text)
  loop
    if coalesce(v_line.debit,0)<0 or coalesce(v_line.credit,0)<0 or (coalesce(v_line.debit,0)>0 and coalesce(v_line.credit,0)>0) or (coalesce(v_line.debit,0)=0 and coalesce(v_line.credit,0)=0) then
      raise exception 'Invalid accounting line for account %',coalesce(v_line.code,'?');
    end if;
    select id into v_account_id from public.accounting_accounts where code=v_line.code and active=true limit 1;
    if v_account_id is null then raise exception 'Accounting account code % is missing or inactive',coalesce(v_line.code,'?'); end if;

    insert into public.accounting_journal_lines(journal_entry_id,account_id,debit,credit,description)
    values(v_entry_id,v_account_id,round(coalesce(v_line.debit,0),2),round(coalesce(v_line.credit,0),2),left(coalesce(v_line.description,p_memo,'PLEASE accounting event'),500));
    v_debits:=v_debits+round(coalesce(v_line.debit,0),2);
    v_credits:=v_credits+round(coalesce(v_line.credit,0),2);
  end loop;

  if round(v_debits,2)=0 or round(v_debits,2)<>round(v_credits,2) then
    raise exception 'Accounting journal is not balanced. Debits %, credits %',round(v_debits,2),round(v_credits,2);
  end if;

  update public.accounting_journal_entries
  set status='POSTED',posted_at=now()
  where id=v_entry_id;

  update public.accounting_external_events
  set posting_status='POSTED',journal_entry_id=v_entry_id,error_message=null,processed_at=now()
  where id=p_event_id;

  return v_entry_id;
end $$;

-- -----------------------------------------------------------------------------
-- 9) Accounting immutability and controlled reversal
-- -----------------------------------------------------------------------------
create or replace function public.accounting_prevent_posted_journal_mutation()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if tg_op='DELETE' and old.status='POSTED' then
    raise exception 'Posted journal entries cannot be deleted. Create a reversal entry.';
  end if;
  if tg_op='UPDATE' and old.status='POSTED' and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'Posted journal entries are immutable. Create a reversal entry.';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

drop trigger if exists trg_accounting_prevent_posted_journal_mutation on public.accounting_journal_entries;
create trigger trg_accounting_prevent_posted_journal_mutation
before update or delete on public.accounting_journal_entries
for each row execute function public.accounting_prevent_posted_journal_mutation();

create or replace function public.accounting_prevent_posted_journal_line_mutation()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_entry_id uuid:=case when tg_op='DELETE' then old.journal_entry_id else new.journal_entry_id end;
  v_status text;
begin
  select status into v_status from public.accounting_journal_entries where id=v_entry_id;
  if v_status='POSTED' then
    raise exception 'Lines belonging to a posted journal entry are immutable. Create a reversal entry.';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

drop trigger if exists trg_accounting_prevent_posted_journal_line_mutation on public.accounting_journal_lines;
create trigger trg_accounting_prevent_posted_journal_line_mutation
before insert or update or delete on public.accounting_journal_lines
for each row execute function public.accounting_prevent_posted_journal_line_mutation();

create or replace function public.accounting_reverse_journal_entry(
  p_entry_id uuid,
  p_reason text,
  p_entry_date date default current_date
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_src public.accounting_journal_entries%rowtype;
  v_new uuid:=gen_random_uuid();
  v_num text;
begin
  select * into v_src from public.accounting_journal_entries where id=p_entry_id and status='POSTED';
  if not found then raise exception 'Posted journal entry not found'; end if;
  if exists(select 1 from public.accounting_journal_entries where reversal_of=p_entry_id) then
    raise exception 'This journal entry already has a reversal';
  end if;
  v_num:='CAL-RV-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  insert into public.accounting_journal_entries(id,entry_number,entry_date,memo,source_type,source_id,status,reversal_of)
  values(v_new,v_num,coalesce(p_entry_date,current_date),'Reversal: '||left(coalesce(p_reason,v_src.memo),450),'REVERSAL',p_entry_id,'DRAFT',p_entry_id);
  insert into public.accounting_journal_lines(journal_entry_id,account_id,debit,credit,description)
  select v_new,account_id,credit,debit,'Reversal · '||coalesce(description,v_src.memo)
  from public.accounting_journal_lines where journal_entry_id=p_entry_id;
  update public.accounting_journal_entries set status='POSTED',posted_at=now() where id=v_new;
  return v_new;
end $$;

create or replace function public.accounting_prevent_domain_event_mutation()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  raise exception 'PLEASE domain events are immutable.';
end $$;
drop trigger if exists trg_please_domain_events_immutable on public.please_domain_events;
create trigger trg_please_domain_events_immutable
before update or delete on public.please_domain_events
for each row execute function public.accounting_prevent_domain_event_mutation();

-- -----------------------------------------------------------------------------
-- 10) Attach event triggers. Dynamic DDL keeps migration readable/idempotent.
-- -----------------------------------------------------------------------------
do $$ begin
  if to_regclass('public.customers') is not null then
    execute 'drop trigger if exists trg_step17_customer_created on public.customers';
    execute 'create trigger trg_step17_customer_created after insert on public.customers for each row execute function public.please_domain_insert_trigger(''CUSTOMER_CREATED'')';
  end if;
  if to_regclass('public.service_requests') is not null then
    execute 'drop trigger if exists trg_step17_request_created on public.service_requests';
    execute 'create trigger trg_step17_request_created after insert on public.service_requests for each row execute function public.please_domain_insert_trigger(''REQUEST_CREATED'')';
  end if;
  if to_regclass('public.jobs') is not null then
    execute 'drop trigger if exists trg_step17_job_created on public.jobs';
    execute 'create trigger trg_step17_job_created after insert on public.jobs for each row execute function public.please_domain_insert_trigger(''JOB_CREATED'')';
    execute 'drop trigger if exists trg_step17_job_status on public.jobs';
    execute 'create trigger trg_step17_job_status after update of status on public.jobs for each row execute function public.please_domain_status_trigger(''JOB_STATUS_CHANGED'')';
  end if;
  if to_regclass('public.job_assignments') is not null then
    execute 'drop trigger if exists trg_step17_provider_assigned on public.job_assignments';
    execute 'create trigger trg_step17_provider_assigned after insert on public.job_assignments for each row execute function public.please_domain_insert_trigger(''PROVIDER_ASSIGNED'')';
  end if;
end $$;

-- Financial source tables are STEP 17 prerequisites.
do $$ begin
  if to_regclass('public.invoices') is null or to_regclass('public.payment_transactions') is null or to_regclass('public.provider_payments') is null then
    raise exception 'STEP 17 prerequisites missing. Run the existing PLEASE invoice/payment/provider migrations before STEP17_NATIVE_ACCOUNTING_ENGINE.sql.';
  end if;
end $$;

drop trigger if exists trg_step17_accounting_invoice_event on public.invoices;
create trigger trg_step17_accounting_invoice_event
after insert or update on public.invoices
for each row execute function public.accounting_invoice_event_trigger();

drop trigger if exists trg_step17_accounting_payment_event on public.payment_transactions;
create trigger trg_step17_accounting_payment_event
after insert or update on public.payment_transactions
for each row execute function public.accounting_payment_event_trigger();

drop trigger if exists trg_step17_accounting_provider_payment_event on public.provider_payments;
create trigger trg_step17_accounting_provider_payment_event
after insert or update on public.provider_payments
for each row execute function public.accounting_provider_payment_event_trigger();

-- -----------------------------------------------------------------------------
-- 11) Idempotent deployment backfill: queues historical financial records without posting
-- -----------------------------------------------------------------------------
do $$ declare r record; begin
  for r in select * from public.invoices where status in ('ISSUED','SENT','OVERDUE','PAID') loop
    perform public.accounting_enqueue_event('INVOICE_ISSUED','invoices',r.id::text,r.invoice_number,jsonb_build_object('invoice',to_jsonb(r)),coalesce(r.issued_at,r.sent_at,r.created_at,now()),1,null,coalesce(r.job_id::text,r.id::text),null);
  end loop;
  for r in select * from public.invoices where status='VOID' loop
    if r.issued_at is not null or r.sent_at is not null then
      perform public.accounting_enqueue_event('INVOICE_ISSUED','invoices',r.id::text,r.invoice_number,jsonb_build_object('invoice',to_jsonb(r)),coalesce(r.issued_at,r.sent_at,r.created_at,now()),1,null,coalesce(r.job_id::text,r.id::text),null);
    end if;
    perform public.accounting_enqueue_event('INVOICE_VOIDED','invoices',r.id::text,r.invoice_number,jsonb_build_object('invoice',to_jsonb(r),'previous_status','UNKNOWN_BACKFILL'),coalesce(r.voided_at,r.updated_at,r.created_at,now()),1,null,coalesce(r.job_id::text,r.id::text),'PLEASE:INVOICE_ISSUED:'||r.id::text);
  end loop;
  for r in select * from public.payment_transactions where status='SUCCEEDED' loop
    perform public.accounting_enqueue_event('PAYMENT_RECEIVED','payment_transactions',r.id::text,coalesce(r.external_reference,r.id::text),jsonb_build_object('payment_transaction',to_jsonb(r)),coalesce(r.created_at,now()),1,r.created_by_admin_portal_user::text,coalesce(r.invoice_id::text,r.id::text),null);
    if upper(coalesce(r.provider,''))='STRIPE' and coalesce(r.stripe_fee_amount,0)>0 then
      perform public.accounting_enqueue_event('STRIPE_FEE_RECORDED','payment_transactions',r.id::text,coalesce(r.external_reference,r.id::text),jsonb_build_object('payment_transaction',to_jsonb(r),'fee_amount',r.stripe_fee_amount),coalesce(r.created_at,now()),1,r.created_by_admin_portal_user::text,coalesce(r.invoice_id::text,r.id::text),'PLEASE:PAYMENT_RECEIVED:'||r.id::text);
    end if;
  end loop;
  for r in select * from public.provider_payments where amount>0 and coalesce(needs_rate_review,false)=false loop
    perform public.accounting_enqueue_event('PROVIDER_PAYABLE_CREATED','provider_payments',r.id::text,coalesce(r.payment_reference,r.id::text),jsonb_build_object('provider_payment',to_jsonb(r)),coalesce(r.created_at,now()),1,r.created_by_admin_portal_user::text,coalesce(r.job_id::text,r.id::text),null);
    if r.status='PAID' then
      perform public.accounting_enqueue_event('PROVIDER_PAYMENT_PAID','provider_payments',r.id::text,coalesce(r.payment_reference,r.id::text),jsonb_build_object('provider_payment',to_jsonb(r)),coalesce(r.paid_at,r.updated_at,r.created_at,now()),1,r.paid_by_admin_portal_user::text,coalesce(r.job_id::text,r.id::text),'PLEASE:PROVIDER_PAYABLE_CREATED:'||r.id::text);
    end if;
  end loop;
end $$;

-- Browser roles never access the accounting/event engine directly.
do $$ declare t text; begin
  foreach t in array array['please_domain_events','please_accounting_outbox','accounting_external_events','accounting_posting_rules'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from anon, authenticated',t);
  end loop;
end $$;
revoke all on function public.please_append_domain_event(text,text,text,text,jsonb,timestamptz,int,text,text,text) from public,anon,authenticated;
revoke all on function public.accounting_enqueue_event(text,text,text,text,jsonb,timestamptz,int,text,text,text) from public,anon,authenticated;
revoke all on function public.accounting_claim_outbox(int,text) from public,anon,authenticated;
revoke all on function public.accounting_release_stale_claims(int) from public,anon,authenticated;
revoke all on function public.accounting_engine_health() from public,anon,authenticated;
revoke all on function public.accounting_requeue_dead_letter(text) from public,anon,authenticated;
revoke all on function public.accounting_reverse_journal_entry(uuid,text,date) from public,anon,authenticated;
revoke all on function public.accounting_post_event_journal(uuid,date,text,jsonb) from public,anon,authenticated;

grant execute on function public.please_append_domain_event(text,text,text,text,jsonb,timestamptz,int,text,text,text) to service_role;
grant execute on function public.accounting_enqueue_event(text,text,text,text,jsonb,timestamptz,int,text,text,text) to service_role;
grant execute on function public.accounting_claim_outbox(int,text) to service_role;
grant execute on function public.accounting_release_stale_claims(int) to service_role;
grant execute on function public.accounting_engine_health() to service_role;
grant execute on function public.accounting_requeue_dead_letter(text) to service_role;
grant execute on function public.accounting_reverse_journal_entry(uuid,text,date) to service_role;
grant execute on function public.accounting_post_event_journal(uuid,date,text,jsonb) to service_role;

comment on table public.please_domain_events is 'Immutable PLEASE operational event ledger. Accounting events are a filtered durable stream, not every domain event.';
comment on table public.please_accounting_outbox is 'STEP 17 durable financial event queue. Events are created transactionally by PostgreSQL source-table triggers and processed asynchronously by CAL.';
comment on function public.accounting_claim_outbox(int,text) is 'Concurrency-safe queue claim using FOR UPDATE SKIP LOCKED.';
comment on function public.accounting_engine_health() is 'Health snapshot for CAL Accounting Engine dashboard.';
comment on function public.accounting_reverse_journal_entry(uuid,text,date) is 'Creates a separate posted reversal; the original posted journal entry remains immutable.';
comment on function public.accounting_post_event_journal(uuid,date,text,jsonb) is 'Atomically posts one idempotent journal for an accounting external event.';

commit;
