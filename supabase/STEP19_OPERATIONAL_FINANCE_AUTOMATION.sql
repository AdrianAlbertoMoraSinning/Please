-- PLEASE — STEP 19: Operational Finance Automation + Daily Staff Shift
-- Safe additive migration. Run AFTER STEP18_12 / STEP17 / STEP15_9.
--
-- Goals:
--   1) PLEASE Staff checks in once per Edmonton workday and checks out once after
--      the final scheduled service. ARRIVE/START/COMPLETE remain per service.
--   2) Completed Jobs enqueue an idempotent operational-finance task.
--   3) The worker creates a DRAFT invoice from the frozen Job billing snapshot.
--   4) STEP 17 remains the only native accounting engine: only an ISSUED invoice
--      enters the accounting outbox through the existing STEP 17 trigger.
--
-- Safe defaults: auto-create DRAFT ON; auto-issue OFF; auto-email OFF.
-- This migration does NOT create historical invoices during deployment.

begin;
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) Daily PLEASE Staff lifecycle (one Check In / one Check Out per workday)
-- -----------------------------------------------------------------------------
create or replace function public.provider_live_service_action(
  p_actor uuid,p_assignment_id uuid,p_action text,p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  a public.job_assignments%rowtype; j public.jobs%rowtype; p public.provider_portal_users%rowtype; bi public.job_billing_items%rowtype;
  mins int; proposed timestamptz; ca numeric(10,2); pa numeric(10,2); rid uuid; evid uuid;
  v_action text:=upper(trim(p_action)); v_job_status text; v_old_job_status text; v_worker_type text;
  v_work_date date; v_first_active_assignment uuid; v_last_assignment uuid; v_daily_check_in_assignment uuid;
  v_remaining int:=0;
begin
  select * into p from public.provider_portal_users where id=p_actor and active=true;
  if not found then raise exception 'Unauthorized'; end if;

  select * into a from public.job_assignments where id=p_assignment_id and provider_id=p.provider_id for update;
  if not found then raise exception 'Assignment not found for signed-in Provider'; end if;

  select * into j from public.jobs where id=a.job_id for update;
  select coalesce(worker_type,'INDEPENDENT_PROVIDER') into v_worker_type from public.providers where id=p.provider_id;
  v_work_date := (a.scheduled_start at time zone 'America/Edmonton')::date;

  -- Existing CHECKED_OUT events from the pre-STEP19 per-service model are retained
  -- for audit, but only CHECKED_IN is shared across assignments. CHECK_OUT validity is
  -- determined from the final scheduled service below.
  if v_worker_type='PLEASE_STAFF' then
    select e.assignment_id into v_daily_check_in_assignment
    from public.job_service_events e
    join public.job_assignments da on da.id=e.assignment_id
    where e.provider_id=p.provider_id
      and e.event_type='CHECKED_IN'
      and (da.scheduled_start at time zone 'America/Edmonton')::date=v_work_date
      and da.status not in ('DECLINED','CANCELLED')
    order by e.created_at asc
    limit 1;

    select da.id into v_first_active_assignment
    from public.job_assignments da
    where da.provider_id=p.provider_id
      and (da.scheduled_start at time zone 'America/Edmonton')::date=v_work_date
      and da.status='CONFIRMED'
    order by da.scheduled_start asc,da.id asc
    limit 1;

    select da.id into v_last_assignment
    from public.job_assignments da
    where da.provider_id=p.provider_id
      and (da.scheduled_start at time zone 'America/Edmonton')::date=v_work_date
      and da.status not in ('DECLINED','CANCELLED')
    order by da.scheduled_start desc,da.id desc
    limit 1;
  end if;

  if v_action='CHECK_IN' then
    if v_worker_type<>'PLEASE_STAFF' then raise exception 'Check In is required only for PLEASE Staff'; end if;
    if a.status<>'CONFIRMED' then raise exception 'Only a confirmed assignment can be checked in'; end if;
    if j.status not in ('CONFIRMED','IN_PROGRESS') then raise exception 'Waiting for the full PLEASE service team to confirm this Job'; end if;
    if v_daily_check_in_assignment is not null then
      return jsonb_build_object('ok',true,'already_recorded',true,'job_status',j.status,'work_date',v_work_date,'daily_check_in_assignment_id',v_daily_check_in_assignment);
    end if;
    if v_first_active_assignment is distinct from a.id then raise exception 'Daily Check In must be completed on the first confirmed PLEASE Staff service of the day'; end if;
    if now() < a.scheduled_start - interval '2 hours' then raise exception 'Daily Check In can only be recorded within 2 hours of the assigned start time. Ask PLEASE Administration to update the schedule if the workday moved earlier'; end if;
    evid:=nullif(p_payload->>'evidence_id','')::uuid;
    if evid is null or not exists(
      select 1 from public.job_service_evidence e where e.id=evid and e.assignment_id=a.id
      and e.provider_id=p.provider_id and e.evidence_type='CHECK_IN' and e.status='PENDING'
    ) then raise exception 'A valid pending Daily Check In photo is required'; end if;
    update public.job_service_evidence set status='DUPLICATE'
      where assignment_id=a.id and evidence_type='CHECK_IN' and status='PENDING' and id<>evid;
    update public.job_service_evidence set status='COMMITTED',committed_at=now() where id=evid;
    insert into public.job_service_events(job_id,assignment_id,provider_id,event_type,event_note)
      values(j.id,a.id,p.provider_id,'CHECKED_IN','PLEASE Staff Daily Check In completed with photo evidence.');
    v_daily_check_in_assignment:=a.id;

  elsif v_action='ARRIVE' then
    if a.status<>'CONFIRMED' then raise exception 'Only a confirmed assignment can be marked arrived'; end if;
    if j.status not in ('CONFIRMED','IN_PROGRESS') then raise exception 'Waiting for the full PLEASE service team to confirm this Job'; end if;
    if v_worker_type='PLEASE_STAFF' and v_daily_check_in_assignment is null then raise exception 'PLEASE Staff must complete Daily Check In before I''ve Arrived'; end if;
    if v_worker_type='PLEASE_STAFF' and not exists(
      select 1 from public.job_service_evidence de
      join public.job_assignments da on da.id=de.assignment_id
      where de.provider_id=p.provider_id and de.evidence_type='CHECK_IN' and de.status='COMMITTED'
        and (da.scheduled_start at time zone 'America/Edmonton')::date=v_work_date
        and da.status not in ('DECLINED','CANCELLED')
    ) then raise exception 'Official Daily Check In photo is missing'; end if;
    if now() < a.scheduled_start - interval '2 hours' then raise exception 'Arrival can only be recorded within 2 hours of the assigned start time. Ask PLEASE Administration to update the schedule if the service moved earlier'; end if;
    if exists(select 1 from public.job_service_events where assignment_id=a.id and event_type='ARRIVED') then return jsonb_build_object('ok',true,'already_recorded',true,'job_status',j.status); end if;
    evid:=nullif(p_payload->>'evidence_id','')::uuid;
    if evid is null or not exists(select 1 from public.job_service_evidence e where e.id=evid and e.assignment_id=a.id and e.provider_id=p.provider_id and e.evidence_type='ARRIVAL' and e.status='PENDING') then raise exception 'A valid pending arrival photo is required'; end if;
    update public.job_service_evidence set status='DUPLICATE' where assignment_id=a.id and evidence_type='ARRIVAL' and status='PENDING' and id<>evid;
    update public.job_service_evidence set status='COMMITTED',committed_at=now() where id=evid;
    insert into public.job_service_events(job_id,assignment_id,provider_id,event_type,customer_message) values(j.id,a.id,p.provider_id,'ARRIVED','Your PLEASE professional has arrived.');
    update public.jobs set actual_arrived_at=coalesce(actual_arrived_at,now()),updated_at=now() where id=j.id;

  elsif v_action='START' then
    if a.status<>'CONFIRMED' then raise exception 'Only a confirmed assignment can be started'; end if;
    if not exists(select 1 from public.job_service_events where assignment_id=a.id and event_type='ARRIVED') then raise exception 'Record arrival before starting the service'; end if;
    if not exists(select 1 from public.job_service_evidence where assignment_id=a.id and evidence_type='ARRIVAL' and status='COMMITTED') then raise exception 'Official arrival photo is missing'; end if;
    if not exists(select 1 from public.job_service_events where assignment_id=a.id and event_type='STARTED') then
      insert into public.job_service_events(job_id,assignment_id,provider_id,event_type,customer_message) values(j.id,a.id,p.provider_id,'STARTED','Your PLEASE service is now in progress.');
      select status into v_old_job_status from public.jobs where id=j.id;
      update public.jobs set actual_started_at=coalesce(actual_started_at,now()),status='IN_PROGRESS',updated_at=now() where id=j.id;
      if v_old_job_status is distinct from 'IN_PROGRESS' then
        insert into public.job_status_history(job_id,old_status,new_status,changed_by_provider_user,note) values(j.id,v_old_job_status,'IN_PROGRESS',p_actor,'Service team work started');
      end if;
    end if;

  elsif v_action='REQUEST_EXTENSION' then
    if a.status<>'CONFIRMED' then raise exception 'Completed or inactive assignments cannot request more time'; end if;
    if not exists(select 1 from public.job_service_events where assignment_id=a.id and event_type='STARTED') then raise exception 'Start the service before requesting additional time'; end if;
    if exists(select 1 from public.job_extension_requests where assignment_id=a.id and status='PENDING') then raise exception 'An extension request is already pending'; end if;
    mins:=greatest(15,least(480,coalesce((p_payload->>'extra_minutes')::int,0)));
    if mins%15<>0 then raise exception 'Extensions must use 15-minute increments'; end if;
    select * into bi from public.job_billing_items where id=(p_payload->>'billing_item_id')::uuid and job_id=j.id and (assignment_id=a.id or (assignment_id is null and provider_id=p.provider_id));
    if not found or lower(coalesce(bi.unit,''))<>'hour' then raise exception 'Select one of your hourly billing items'; end if;
    proposed:=a.scheduled_end+make_interval(mins=>mins);
    ca:=round(coalesce(bi.customer_unit_rate,bi.unit_rate,0)*(mins/60.0),2);
    pa:=round(coalesce(bi.provider_unit_rate,0)*(mins/60.0),2);
    insert into public.job_extension_requests(job_id,assignment_id,provider_id,billing_item_id,extra_minutes,reason,original_end,proposed_end,customer_addition,provider_addition)
      values(j.id,a.id,p.provider_id,bi.id,mins,nullif(p_payload->>'reason',''),a.scheduled_end,proposed,ca,pa) returning id into rid;
    insert into public.job_service_events(job_id,assignment_id,provider_id,event_type,event_note,customer_message)
      values(j.id,a.id,p.provider_id,'EXTENSION_REQUESTED',mins||' minutes requested','Additional service time has been requested and is awaiting approval.');
    return jsonb_build_object('ok',true,'extension_request_id',rid);

  elsif v_action='COMPLETE' then
    if a.status='COMPLETED' or exists(select 1 from public.job_service_events where assignment_id=a.id and event_type='COMPLETED') then
      return jsonb_build_object('ok',true,'already_recorded',true,'job_status',(select status from public.jobs where id=j.id));
    end if;
    if a.status<>'CONFIRMED' then raise exception 'Only an active confirmed assignment can be completed'; end if;
    if not exists(select 1 from public.job_service_events where assignment_id=a.id and event_type='STARTED') then raise exception 'Start the service before completing it'; end if;
    evid:=nullif(p_payload->>'evidence_id','')::uuid;
    if evid is null or not exists(select 1 from public.job_service_evidence e where e.id=evid and e.assignment_id=a.id and e.provider_id=p.provider_id and e.evidence_type='COMPLETION' and e.status='PENDING') then raise exception 'A valid pending completion photo is required'; end if;
    update public.job_service_evidence set status='DUPLICATE' where assignment_id=a.id and evidence_type='COMPLETION' and status='PENDING' and id<>evid;
    update public.job_service_evidence set status='COMMITTED',committed_at=now() where id=evid;
    update public.job_assignments set status='COMPLETED',updated_at=now() where id=a.id;
    insert into public.assignment_status_history(assignment_id,old_status,new_status,changed_by_provider_user,note) values(a.id,a.status,'COMPLETED',p_actor,nullif(left(p_payload->>'note',1000),''));
    insert into public.job_service_events(job_id,assignment_id,provider_id,event_type,customer_message) values(j.id,a.id,p.provider_id,'COMPLETED','This PLEASE professional has completed their assigned work.');
    perform public.ensure_provider_payment_for_assignment(a.id);
    select status into v_old_job_status from public.jobs where id=j.id;
    v_job_status:=public.please_refresh_job_status(j.id);
    if v_job_status='COMPLETED' and v_old_job_status is distinct from 'COMPLETED' then
      insert into public.job_status_history(job_id,old_status,new_status,changed_by_provider_user,note) values(j.id,v_old_job_status,'COMPLETED',p_actor,'All required providers completed the service');
      if not exists(select 1 from public.job_service_events where job_id=j.id and event_type='JOB_COMPLETED') then
        insert into public.job_service_events(job_id,assignment_id,provider_id,event_type,customer_message) values(j.id,a.id,p.provider_id,'JOB_COMPLETED','Your PLEASE service has been completed by the full service team.');
      end if;
    end if;

  elsif v_action='CHECK_OUT' then
    if v_worker_type<>'PLEASE_STAFF' then raise exception 'Check Out is required only for PLEASE Staff'; end if;
    if a.status<>'COMPLETED' then raise exception 'Complete the assigned service before Daily Check Out'; end if;
    if not exists(select 1 from public.job_service_events where assignment_id=a.id and event_type='COMPLETED') then raise exception 'Completion must be recorded before Daily Check Out'; end if;
    if not exists(select 1 from public.job_service_evidence where assignment_id=a.id and evidence_type='COMPLETION' and status='COMMITTED') then raise exception 'Official completion photo is missing'; end if;
    if v_last_assignment is distinct from a.id then raise exception 'Daily Check Out is available only after the final scheduled PLEASE Staff service of the day'; end if;
    select count(*) into v_remaining
    from public.job_assignments da
    where da.provider_id=p.provider_id
      and da.id<>a.id
      and (da.scheduled_start at time zone 'America/Edmonton')::date=v_work_date
      and da.status not in ('DECLINED','CANCELLED','COMPLETED');
    if v_remaining>0 then raise exception 'Complete all remaining PLEASE Staff services before Daily Check Out'; end if;
    if exists(select 1 from public.job_service_events where assignment_id=a.id and event_type='CHECKED_OUT') then
      return jsonb_build_object('ok',true,'already_recorded',true,'job_status',(select status from public.jobs where id=j.id),'work_date',v_work_date);
    end if;
    evid:=nullif(p_payload->>'evidence_id','')::uuid;
    if evid is null or not exists(select 1 from public.job_service_evidence e where e.id=evid and e.assignment_id=a.id and e.provider_id=p.provider_id and e.evidence_type='CHECK_OUT' and e.status='PENDING') then raise exception 'A valid pending Daily Check Out photo is required'; end if;
    update public.job_service_evidence set status='DUPLICATE' where assignment_id=a.id and evidence_type='CHECK_OUT' and status='PENDING' and id<>evid;
    update public.job_service_evidence set status='COMMITTED',committed_at=now() where id=evid;
    insert into public.job_service_events(job_id,assignment_id,provider_id,event_type,event_note)
      values(j.id,a.id,p.provider_id,'CHECKED_OUT','PLEASE Staff Daily Check Out completed with photo evidence.');

  else
    raise exception 'Invalid action';
  end if;

  v_job_status:=coalesce(v_job_status,public.please_refresh_job_status(j.id));
  return jsonb_build_object(
    'ok',true,'job_status',v_job_status,'worker_type',v_worker_type,
    'work_date',v_work_date,'daily_check_in_recorded',(v_daily_check_in_assignment is not null or v_action='CHECK_IN'),
    'is_last_service',(v_worker_type='PLEASE_STAFF' and v_last_assignment=a.id)
  );
end $$;

revoke all on function public.provider_live_service_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.provider_live_service_action(uuid,uuid,text,jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- 2) Operational Finance settings, queue and exceptions
-- -----------------------------------------------------------------------------
create table if not exists public.operational_finance_settings (
  singleton_id smallint primary key default 1 check(singleton_id=1),
  auto_create_invoice_draft boolean not null default true,
  auto_issue_invoice boolean not null default false,
  auto_email_invoice boolean not null default false,
  default_gst_rate numeric(5,2) not null default 5 check(default_gst_rate between 0 and 100),
  updated_by_admin_portal_user uuid references public.admin_portal_users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.operational_finance_settings(singleton_id) values(1) on conflict(singleton_id) do nothing;

create table if not exists public.operational_finance_queue (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null default 'JOB_COMPLETED' check(event_type in ('JOB_COMPLETED')),
  source_job_id uuid not null references public.jobs(id) on delete restrict,
  status text not null default 'PENDING' check(status in ('PENDING','PROCESSING','COMPLETED','SKIPPED','ERROR')),
  attempts integer not null default 0 check(attempts>=0),
  next_attempt_at timestamptz not null default now(),
  processing_started_at timestamptz,
  processing_by text,
  invoice_id uuid references public.invoices(id) on delete set null,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists operational_finance_queue_ready_idx on public.operational_finance_queue(status,next_attempt_at,created_at);
create index if not exists operational_finance_queue_job_idx on public.operational_finance_queue(source_job_id,created_at desc);

create table if not exists public.operational_finance_exceptions (
  id uuid primary key default gen_random_uuid(),
  exception_type text not null,
  status text not null default 'OPEN' check(status in ('OPEN','RESOLVED','DISMISSED')),
  source_type text,
  source_id text,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  resolution_note text,
  created_by_admin_portal_user uuid references public.admin_portal_users(id) on delete set null,
  resolved_by_admin_portal_user uuid references public.admin_portal_users(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists operational_finance_exceptions_status_idx on public.operational_finance_exceptions(status,created_at desc);

comment on table public.operational_finance_queue is 'STEP 19 durable operational-finance queue. Job completion is recorded before asynchronous invoice automation.';
comment on table public.operational_finance_settings is 'STEP 19 automation controls. Safe production defaults create DRAFT only; issue/email remain opt-in.';
comment on table public.operational_finance_exceptions is 'Business facts that require human finance classification instead of guessed accounting.';

-- -----------------------------------------------------------------------------
-- 3) Job completion -> durable queue (same DB transaction as the Job status)
-- -----------------------------------------------------------------------------
create or replace function public.operational_finance_job_completed_trigger()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status='COMPLETED' and old.status is distinct from new.status then
    insert into public.operational_finance_queue(event_key,event_type,source_job_id,status,next_attempt_at)
    values('JOB_COMPLETED:'||new.id::text,'JOB_COMPLETED',new.id,'PENDING',now())
    on conflict(event_key) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists trg_step19_operational_finance_job_completed on public.jobs;
create trigger trg_step19_operational_finance_job_completed
after update of status on public.jobs
for each row execute function public.operational_finance_job_completed_trigger();

-- Optional explicit backfill. It is intentionally NOT called by this migration.
create or replace function public.operational_finance_enqueue_completed_jobs(p_since date default null)
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer:=0;
begin
  insert into public.operational_finance_queue(event_key,event_type,source_job_id,status,next_attempt_at)
  select 'JOB_COMPLETED:'||j.id::text,'JOB_COMPLETED',j.id,'PENDING',now()
  from public.jobs j
  where j.status='COMPLETED'
    and (p_since is null or coalesce(j.actual_completed_at,j.updated_at,j.created_at)::date>=p_since)
    and not exists(select 1 from public.invoices i where i.job_id=j.id and i.status<>'VOID')
  on conflict(event_key) do nothing;
  get diagnostics v_count=row_count;
  return v_count;
end $$;

-- -----------------------------------------------------------------------------
-- 4) Idempotent queue processor. Creates invoice from frozen Job billing only.
-- -----------------------------------------------------------------------------
create sequence if not exists public.operational_finance_invoice_seq start with 1001;

create or replace function public.operational_finance_process_pending(
  p_limit integer default 10,
  p_worker_id text default 'STEP19'
)
returns table(queue_id uuid,job_id uuid,invoice_id uuid,invoice_number text,invoice_status text,should_email boolean,result_status text,message text)
language plpgsql security definer set search_path=public as $$
declare
  q record; j public.jobs%rowtype; c record; s public.operational_finance_settings%rowtype;
  inv public.invoices%rowtype; v_invoice_number text; v_subtotal numeric(12,2); v_gst numeric(12,2); v_total numeric(12,2);
  v_count integer; v_msg text;
begin
  select * into s from public.operational_finance_settings where singleton_id=1;
  if not found then raise exception 'Operational Finance settings are missing.'; end if;

  -- Recover abandoned claims conservatively.
  update public.operational_finance_queue
  set status='ERROR',last_error=coalesce(last_error,'Recovered stale processing claim.'),next_attempt_at=now(),processing_started_at=null,processing_by=null,updated_at=now()
  where status='PROCESSING' and processing_started_at<now()-interval '10 minutes';

  for q in
    select * from public.operational_finance_queue
    where status in ('PENDING','ERROR') and next_attempt_at<=now()
    order by created_at asc
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,10),100))
  loop
    begin
      update public.operational_finance_queue
      set status='PROCESSING',attempts=attempts+1,processing_started_at=now(),processing_by=left(coalesce(p_worker_id,'STEP19'),120),last_error=null,updated_at=now()
      where id=q.id;

      select * into j from public.jobs where id=q.source_job_id;
      if not found then
        update public.operational_finance_queue set status='ERROR',last_error='Source Job not found.',next_attempt_at=now()+interval '6 hours',processing_started_at=null,processing_by=null,updated_at=now() where id=q.id;
        queue_id:=q.id;job_id:=q.source_job_id;invoice_id:=null;invoice_number:=null;invoice_status:=null;should_email:=false;result_status:='ERROR';message:='Source Job not found.';return next;continue;
      end if;
      if j.status<>'COMPLETED' then
        update public.operational_finance_queue set status='SKIPPED',last_error=null,processed_at=now(),processing_started_at=null,processing_by=null,updated_at=now() where id=q.id;
        queue_id:=q.id;job_id:=j.id;invoice_id:=null;invoice_number:=null;invoice_status:=null;should_email:=false;result_status:='SKIPPED';message:='Job is no longer COMPLETED.';return next;continue;
      end if;

      select i.* into inv from public.invoices i where i.job_id=j.id and i.status<>'VOID' order by i.created_at desc limit 1;
      if found then
        update public.operational_finance_queue set status='COMPLETED',invoice_id=inv.id,processed_at=now(),processing_started_at=null,processing_by=null,updated_at=now() where id=q.id;
        queue_id:=q.id;job_id:=j.id;invoice_id:=inv.id;invoice_number:=inv.invoice_number;invoice_status:=inv.status;should_email:=s.auto_email_invoice and inv.status='ISSUED';result_status:='COMPLETED';message:='Existing non-void invoice retained; no duplicate created.';return next;continue;
      end if;

      if not s.auto_create_invoice_draft then
        update public.operational_finance_queue set status='SKIPPED',processed_at=now(),processing_started_at=null,processing_by=null,updated_at=now() where id=q.id;
        queue_id:=q.id;job_id:=j.id;invoice_id:=null;invoice_number:=null;invoice_status:=null;should_email:=false;result_status:='SKIPPED';message:='Auto-create invoice draft is disabled.';return next;continue;
      end if;

      select * into c from public.customers where id=j.customer_id;
      v_invoice_number:='PLS-INV-'||to_char(current_date,'YYYYMMDD')||'-A'||lpad(nextval('public.operational_finance_invoice_seq')::text,6,'0');

      insert into public.invoices(
        invoice_number,job_id,customer_id,client_name,client_email,client_phone,
        invoice_date,due_date,gst_rate,status,payment_status,currency,note
      ) values(
        v_invoice_number,j.id,j.customer_id,
        nullif(trim(concat_ws(' ',c.first_name,c.last_name)),''),c.email,c.phone,
        current_date,current_date,s.default_gst_rate,'DRAFT','UNPAID','CAD',
        'Automatically prepared from completed Job '||coalesce(j.reference,j.id::text)||'. Review before issue.'
      ) returning * into inv;

      insert into public.invoice_items(invoice_id,description,qty,unit,unit_rate,line_total,sort_order)
      select inv.id,
             coalesce(nullif(concat_ws(' — ',nullif(b.service_name,''),nullif(b.description,'')),''),'PLEASE service'),
             round(b.quantity::numeric,2),coalesce(nullif(b.unit,''),'service'),
             round(coalesce(b.customer_unit_rate,b.unit_rate,0)::numeric,2),
             round(coalesce(b.customer_line_total,b.line_total,b.quantity*coalesce(b.customer_unit_rate,b.unit_rate,0))::numeric,2),
             row_number() over(order by b.sort_order,b.id)*10
      from public.job_billing_items b where b.job_id=j.id;
      get diagnostics v_count=row_count;

      if v_count=0 then
        insert into public.invoice_items(invoice_id,description,qty,unit,unit_rate,line_total,sort_order)
        values(
          inv.id,coalesce(nullif(j.service_name,''),'PLEASE service'),
          round((case when coalesce(j.billable_quantity,0)>0 then j.billable_quantity when j.billing_type='HOURLY' then greatest(0.01,coalesce(j.estimated_duration_minutes,60)/60.0) else 1 end)::numeric,2),
          coalesce(nullif(j.billing_unit,''),case when j.billing_type='HOURLY' then 'hour' else 'service' end),
          round(coalesce(j.customer_rate,0)::numeric,2),
          round(((case when coalesce(j.billable_quantity,0)>0 then j.billable_quantity when j.billing_type='HOURLY' then greatest(0.01,coalesce(j.estimated_duration_minutes,60)/60.0) else 1 end)*coalesce(j.customer_rate,0))::numeric,2),10
        );
      end if;

      select round(coalesce(sum(ii.line_total),0),2) into v_subtotal from public.invoice_items ii where ii.invoice_id=inv.id;
      v_gst:=round(v_subtotal*(s.default_gst_rate/100.0),2);v_total:=round(v_subtotal+v_gst,2);
      update public.invoices set subtotal=v_subtotal,gst_amount=v_gst,total_amount=v_total,updated_at=now() where id=inv.id returning * into inv;

      insert into public.invoice_status_history(invoice_id,old_status,new_status,old_payment_status,new_payment_status,note,source)
      values(inv.id,'DRAFT','DRAFT','UNPAID','UNPAID','STEP 19 automatically created invoice DRAFT from frozen Job billing.','SYSTEM');

      if s.auto_issue_invoice and v_total>0 then
        update public.invoices set status='ISSUED',issued_at=now(),updated_at=now() where id=inv.id returning * into inv;
        insert into public.invoice_status_history(invoice_id,old_status,new_status,old_payment_status,new_payment_status,note,source)
        values(inv.id,'DRAFT','ISSUED','UNPAID','UNPAID','STEP 19 Auto-Issue enabled. STEP 17 will process the issued invoice event.','SYSTEM');
      end if;

      update public.operational_finance_queue set status='COMPLETED',invoice_id=inv.id,processed_at=now(),processing_started_at=null,processing_by=null,updated_at=now() where id=q.id;
      queue_id:=q.id;job_id:=j.id;invoice_id:=inv.id;invoice_number:=inv.invoice_number;invoice_status:=inv.status;
      should_email:=s.auto_email_invoice and inv.status in ('ISSUED','SENT','OVERDUE');result_status:='COMPLETED';message:='Invoice prepared from frozen Job billing.';return next;

    exception when others then
      v_msg:=left(sqlerrm,1500);
      update public.operational_finance_queue
      set status='ERROR',last_error=v_msg,next_attempt_at=now()+make_interval(mins=>least(360,greatest(5,(attempts+1)*15))),processing_started_at=null,processing_by=null,updated_at=now()
      where id=q.id;
      queue_id:=q.id;job_id:=q.source_job_id;invoice_id:=null;invoice_number:=null;invoice_status:=null;should_email:=false;result_status:='ERROR';message:=v_msg;return next;
    end;
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 5) Operational cash count / closing control
-- -----------------------------------------------------------------------------
create table if not exists public.operational_finance_cash_counts (
  id uuid primary key default gen_random_uuid(),
  financial_account_id uuid not null references public.accounting_financial_accounts(id) on delete restrict,
  count_date date not null default current_date,
  expected_amount numeric(14,2) not null,
  physical_amount numeric(14,2) not null,
  difference numeric(14,2) not null,
  status text not null check(status in ('BALANCED','REVIEW')),
  reference text,
  created_by_admin_portal_user uuid references public.admin_portal_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists operational_finance_cash_counts_account_idx on public.operational_finance_cash_counts(financial_account_id,count_date desc,created_at desc);

create or replace function public.operational_finance_record_cash_count(
  p_financial_account_id uuid,
  p_count_date date,
  p_physical_amount numeric,
  p_reference text,
  p_admin_user_id uuid
) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_fin public.accounting_financial_accounts%rowtype;
  v_expected numeric(14,2):=0;
  v_difference numeric(14,2):=0;
  v_status text;
  v_id uuid;
begin
  select * into v_fin from public.accounting_financial_accounts where id=p_financial_account_id and active=true;
  if not found or v_fin.financial_type<>'CASH' then raise exception 'Choose an active CASH financial account.'; end if;
  if p_physical_amount is null or p_physical_amount<0 then raise exception 'Physical cash count cannot be negative.'; end if;

  select round(coalesce(sum(l.debit-l.credit),0),2)
  into v_expected
  from public.accounting_journal_lines l
  join public.accounting_journal_entries e on e.id=l.journal_entry_id
  where l.account_id=v_fin.gl_account_id and e.status='POSTED' and e.entry_date<=coalesce(p_count_date,current_date);

  v_difference:=round(p_physical_amount-v_expected,2);
  v_status:=case when abs(v_difference)<=0.01 then 'BALANCED' else 'REVIEW' end;
  insert into public.operational_finance_cash_counts(financial_account_id,count_date,expected_amount,physical_amount,difference,status,reference,created_by_admin_portal_user)
  values(v_fin.id,coalesce(p_count_date,current_date),v_expected,round(p_physical_amount,2),v_difference,v_status,nullif(trim(p_reference),''),p_admin_user_id)
  returning id into v_id;

  if v_status='REVIEW' then
    insert into public.operational_finance_exceptions(exception_type,status,source_type,source_id,summary,details,created_by_admin_portal_user)
    values('CASH_COUNT_VARIANCE','OPEN','CASH_COUNT',v_id::text,'Physical cash does not match the posted ledger balance.',jsonb_build_object('financial_account_id',v_fin.id,'financial_account_name',v_fin.name,'count_date',coalesce(p_count_date,current_date),'expected_amount',v_expected,'physical_amount',round(p_physical_amount,2),'difference',v_difference),p_admin_user_id);
  end if;
  return v_id;
end $$;

comment on table public.operational_finance_cash_counts is 'STEP 19 operational physical cash closing. Differences become Finance Exceptions; PLEASE does not guess an adjustment journal.';

-- -----------------------------------------------------------------------------
-- 6) Browser isolation / service-role-only finance automation
-- -----------------------------------------------------------------------------
alter table public.operational_finance_settings enable row level security;
alter table public.operational_finance_queue enable row level security;
alter table public.operational_finance_exceptions enable row level security;
alter table public.operational_finance_cash_counts enable row level security;
revoke all on public.operational_finance_settings from anon,authenticated;
revoke all on public.operational_finance_queue from anon,authenticated;
revoke all on public.operational_finance_exceptions from anon,authenticated;
revoke all on public.operational_finance_cash_counts from anon,authenticated;
revoke all on function public.operational_finance_enqueue_completed_jobs(date) from public,anon,authenticated;
revoke all on function public.operational_finance_process_pending(integer,text) from public,anon,authenticated;
revoke all on function public.operational_finance_record_cash_count(uuid,date,numeric,text,uuid) from public,anon,authenticated;
grant execute on function public.operational_finance_enqueue_completed_jobs(date) to service_role;
grant execute on function public.operational_finance_process_pending(integer,text) to service_role;
grant execute on function public.operational_finance_record_cash_count(uuid,date,numeric,text,uuid) to service_role;

commit;
