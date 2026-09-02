begin;

-- ============================================================
-- PLEASE STEP 15.9 — Client Operations Control
-- Customer Master, Service Maintenance audit and PLEASE Staff
-- four-photo evidence support.
-- Safe/additive migration over STEP 15.8.6.3.2.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1) Customer Master starts at Service Request intake.
-- ------------------------------------------------------------
alter table public.customers
  add column if not exists normalized_email text,
  add column if not exists normalized_phone text,
  add column if not exists service_request_count integer not null default 0,
  add column if not exists first_service_request_at timestamptz,
  add column if not exists last_service_request_at timestamptz;

update public.customers
   set normalized_email = nullif(lower(trim(email)),''),
       normalized_phone = nullif(regexp_replace(coalesce(phone,''),'[^0-9]+','','g'),'')
 where normalized_email is null or normalized_phone is null;

create index if not exists customers_normalized_email_idx
  on public.customers(normalized_email) where normalized_email is not null;
create index if not exists customers_normalized_phone_idx
  on public.customers(normalized_phone) where normalized_phone is not null;

alter table public.service_requests
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists dropoff_address text,
  add column if not exists estimated_hours numeric(7,2);

create index if not exists service_requests_customer_idx
  on public.service_requests(customer_id,created_at desc);

-- Backfill the structured booking fields previously stored in customer_notes.
update public.service_requests
   set dropoff_address = coalesce(
         dropoff_address,
         nullif((regexp_match(coalesce(customer_notes,''),'(?im)^Drop-off address:\s*(.+)$'))[1],'')
       ),
       estimated_hours = coalesce(
         estimated_hours,
         nullif((regexp_match(coalesce(customer_notes,''),'(?im)^Estimated hours requested:\s*([0-9]+(?:\.[0-9]+)?)'))[1],'')::numeric
       )
 where dropoff_address is null or estimated_hours is null;

-- Link legacy requests to a known customer using the same identity rules used by Jobs.
-- Correlated scalar form keeps this migration portable across hosted Postgres builds.
update public.service_requests sr
   set customer_id = (
     select c1.id
       from public.customers c1
      where (nullif(lower(trim(sr.email)),'') is not null and c1.normalized_email=lower(trim(sr.email)))
         or (nullif(regexp_replace(coalesce(sr.phone,''),'[^0-9]+','','g'),'') is not null and c1.normalized_phone=regexp_replace(coalesce(sr.phone,''),'[^0-9]+','','g'))
      order by case when c1.normalized_email=lower(trim(sr.email)) then 0 else 1 end,
               c1.updated_at desc nulls last,
               c1.created_at desc
      limit 1
   )
 where sr.customer_id is null
   and exists (
     select 1 from public.customers c2
      where (nullif(lower(trim(sr.email)),'') is not null and c2.normalized_email=lower(trim(sr.email)))
         or (nullif(regexp_replace(coalesce(sr.phone,''),'[^0-9]+','','g'),'') is not null and c2.normalized_phone=regexp_replace(coalesce(sr.phone,''),'[^0-9]+','','g'))
   );

create or replace function public.please_upsert_customer(
  p_first_name text,
  p_last_name text default null,
  p_email text default null,
  p_phone text default null,
  p_address_line1 text default null,
  p_city text default null,
  p_province text default null,
  p_postal_code text default null,
  p_increment_request boolean default false
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_id uuid;
  v_email text:=nullif(lower(trim(p_email)),'');
  v_phone text:=nullif(regexp_replace(coalesce(p_phone,''),'[^0-9]+','','g'),'');
  v_now timestamptz:=now();
begin
  if v_email is not null then
    select id into v_id from public.customers
     where normalized_email=v_email
     order by updated_at desc nulls last,created_at desc limit 1;
  end if;
  if v_id is null and v_phone is not null then
    select id into v_id from public.customers
     where normalized_phone=v_phone
     order by updated_at desc nulls last,created_at desc limit 1;
  end if;

  if v_id is null then
    insert into public.customers(
      first_name,last_name,email,phone,address_line1,city,province,postal_code,
      normalized_email,normalized_phone,service_request_count,
      first_service_request_at,last_service_request_at
    ) values(
      coalesce(nullif(trim(p_first_name),''),'Customer'),nullif(trim(p_last_name),''),v_email,nullif(trim(p_phone),''),
      nullif(trim(p_address_line1),''),nullif(trim(p_city),''),coalesce(nullif(trim(p_province),''),'AB'),nullif(trim(p_postal_code),''),
      v_email,v_phone,case when p_increment_request then 1 else 0 end,
      case when p_increment_request then v_now else null end,
      case when p_increment_request then v_now else null end
    ) returning id into v_id;
  else
    update public.customers
       set -- Service Request intake may identify a returning Customer, but intake data
           -- must never overwrite an established Customer Master record merely because
           -- the same email address or phone number was entered again. Service-request
           -- upserts therefore only fill blanks. Deliberate Master edits are performed
           -- through Administration > Customers, which writes the customer row directly.
           first_name=coalesce(first_name,nullif(trim(p_first_name),'')),
           last_name=coalesce(last_name,nullif(trim(p_last_name),'')),
           email=coalesce(email,v_email),
           phone=coalesce(phone,nullif(trim(p_phone),'')),
           address_line1=coalesce(address_line1,nullif(trim(p_address_line1),'')),
           city=coalesce(city,nullif(trim(p_city),'')),
           province=coalesce(province,nullif(trim(p_province),'')),
           postal_code=coalesce(postal_code,nullif(trim(p_postal_code),'')),
           normalized_email=coalesce(normalized_email,v_email),
           normalized_phone=coalesce(normalized_phone,v_phone),
           service_request_count=service_request_count + case when p_increment_request then 1 else 0 end,
           first_service_request_at=case when p_increment_request then coalesce(first_service_request_at,v_now) else first_service_request_at end,
           last_service_request_at=case when p_increment_request then v_now else last_service_request_at end,
           updated_at=v_now
     where id=v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.please_upsert_customer(text,text,text,text,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.please_upsert_customer(text,text,text,text,text,text,text,text,boolean) to service_role;

-- Recompute Customer Master counters from authoritative Service Request history.
with x as (
  select customer_id,count(*)::integer cnt,min(created_at) first_at,max(created_at) last_at
    from public.service_requests where customer_id is not null group by customer_id
)
update public.customers c
   set service_request_count=x.cnt,
       first_service_request_at=x.first_at,
       last_service_request_at=x.last_at
  from x where c.id=x.customer_id;

-- ------------------------------------------------------------
-- 2) PLEASE Staff four-photo evidence lifecycle.
-- Independent Providers keep the existing ARRIVAL/COMPLETION flow.
-- ------------------------------------------------------------
alter table public.job_service_evidence drop constraint if exists job_service_evidence_evidence_type_check;
alter table public.job_service_evidence add constraint job_service_evidence_evidence_type_check
  check(evidence_type in ('CHECK_IN','ARRIVAL','COMPLETION','CHECK_OUT'));

alter table public.job_service_events drop constraint if exists job_service_events_event_type_check;
alter table public.job_service_events add constraint job_service_events_event_type_check check (
  event_type in ('REMINDER_24H','CHECKED_IN','ARRIVED','STARTED','EXTENSION_REQUESTED','EXTENSION_APPROVED','EXTENSION_REJECTED','COMPLETED','CHECKED_OUT','JOB_COMPLETED','CUSTOMER_NOTIFIED')
);

-- The existing unique partial index is intentionally retained: one official
-- committed image per assignment/evidence type.

-- STEP 15.9 replaces the live-service RPC so the four-photo rule is enforced
-- server-side and evidence commit + lifecycle event remain atomic.
create or replace function public.provider_live_service_action(p_actor uuid,p_assignment_id uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  a public.job_assignments%rowtype; j public.jobs%rowtype; p public.provider_portal_users%rowtype; bi public.job_billing_items%rowtype;
  mins int; proposed timestamptz; ca numeric(10,2); pa numeric(10,2); rid uuid; evid uuid; v_action text:=upper(trim(p_action)); v_job_status text; v_old_job_status text; v_worker_type text;
begin
  select * into p from public.provider_portal_users where id=p_actor and active=true; if not found then raise exception 'Unauthorized'; end if;
  select * into a from public.job_assignments where id=p_assignment_id and provider_id=p.provider_id for update; if not found then raise exception 'Assignment not found for signed-in Provider'; end if;
  select * into j from public.jobs where id=a.job_id for update;
  select coalesce(worker_type,'INDEPENDENT_PROVIDER') into v_worker_type from public.providers where id=p.provider_id;

  if v_action='CHECK_IN' then
    if v_worker_type<>'PLEASE_STAFF' then raise exception 'Check In is required only for PLEASE Staff'; end if;
    if a.status<>'CONFIRMED' then raise exception 'Only a confirmed assignment can be checked in'; end if;
    if j.status not in ('CONFIRMED','IN_PROGRESS') then raise exception 'Waiting for the full PLEASE service team to confirm this Job'; end if;
    if now() < a.scheduled_start - interval '2 hours' then raise exception 'Check In can only be recorded within 2 hours of the assigned start time. Ask PLEASE Administration to update the schedule if the service moved earlier'; end if;
    if exists(select 1 from public.job_service_events where assignment_id=a.id and event_type='CHECKED_IN') then return jsonb_build_object('ok',true,'already_recorded',true,'job_status',j.status); end if;
    evid:=nullif(p_payload->>'evidence_id','')::uuid;
    if evid is null or not exists(select 1 from public.job_service_evidence e where e.id=evid and e.assignment_id=a.id and e.provider_id=p.provider_id and e.evidence_type='CHECK_IN' and e.status='PENDING') then raise exception 'A valid pending Check In photo is required'; end if;
    update public.job_service_evidence set status='DUPLICATE' where assignment_id=a.id and evidence_type='CHECK_IN' and status='PENDING' and id<>evid;
    update public.job_service_evidence set status='COMMITTED',committed_at=now() where id=evid;
    insert into public.job_service_events(job_id,assignment_id,provider_id,event_type,event_note) values(j.id,a.id,p.provider_id,'CHECKED_IN','PLEASE Staff Check In completed with photo evidence.');

  elsif v_action='ARRIVE' then
    if a.status<>'CONFIRMED' then raise exception 'Only a confirmed assignment can be marked arrived'; end if;
    if j.status not in ('CONFIRMED','IN_PROGRESS') then raise exception 'Waiting for the full PLEASE service team to confirm this Job'; end if;
    if v_worker_type='PLEASE_STAFF' and not exists(select 1 from public.job_service_events where assignment_id=a.id and event_type='CHECKED_IN') then raise exception 'PLEASE Staff must complete Check In before I''ve Arrived'; end if;
    if v_worker_type='PLEASE_STAFF' and not exists(select 1 from public.job_service_evidence where assignment_id=a.id and evidence_type='CHECK_IN' and status='COMMITTED') then raise exception 'Official Check In photo is missing'; end if;
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
      if v_old_job_status is distinct from 'IN_PROGRESS' then insert into public.job_status_history(job_id,old_status,new_status,changed_by_provider_user,note) values(j.id,v_old_job_status,'IN_PROGRESS',p_actor,'Service team work started'); end if;
    end if;

  elsif v_action='REQUEST_EXTENSION' then
    if a.status<>'CONFIRMED' then raise exception 'Completed or inactive assignments cannot request more time'; end if;
    if not exists(select 1 from public.job_service_events where assignment_id=a.id and event_type='STARTED') then raise exception 'Start the service before requesting additional time'; end if;
    if exists(select 1 from public.job_extension_requests where assignment_id=a.id and status='PENDING') then raise exception 'An extension request is already pending'; end if;
    mins:=greatest(15,least(480,coalesce((p_payload->>'extra_minutes')::int,0))); if mins%15<>0 then raise exception 'Extensions must use 15-minute increments'; end if;
    select * into bi from public.job_billing_items where id=(p_payload->>'billing_item_id')::uuid and job_id=j.id and (assignment_id=a.id or (assignment_id is null and provider_id=p.provider_id));
    if not found or lower(coalesce(bi.unit,''))<>'hour' then raise exception 'Select one of your hourly billing items'; end if;
    proposed:=a.scheduled_end+make_interval(mins=>mins); ca:=round(coalesce(bi.customer_unit_rate,bi.unit_rate,0)*(mins/60.0),2); pa:=round(coalesce(bi.provider_unit_rate,0)*(mins/60.0),2);
    insert into public.job_extension_requests(job_id,assignment_id,provider_id,billing_item_id,extra_minutes,reason,original_end,proposed_end,customer_addition,provider_addition)
    values(j.id,a.id,p.provider_id,bi.id,mins,nullif(p_payload->>'reason',''),a.scheduled_end,proposed,ca,pa) returning id into rid;
    insert into public.job_service_events(job_id,assignment_id,provider_id,event_type,event_note,customer_message) values(j.id,a.id,p.provider_id,'EXTENSION_REQUESTED',mins||' minutes requested','Additional service time has been requested and is awaiting approval.');
    return jsonb_build_object('ok',true,'extension_request_id',rid);

  elsif v_action='COMPLETE' then
    if a.status='COMPLETED' or exists(select 1 from public.job_service_events where assignment_id=a.id and event_type='COMPLETED') then return jsonb_build_object('ok',true,'already_recorded',true,'job_status',(select status from public.jobs where id=j.id)); end if;
    if a.status<>'CONFIRMED' then raise exception 'Only an active confirmed assignment can be completed'; end if;
    if not exists(select 1 from public.job_service_events where assignment_id=a.id and event_type='STARTED') then raise exception 'Start the service before completing it'; end if;
    evid:=nullif(p_payload->>'evidence_id','')::uuid;
    if evid is null or not exists(select 1 from public.job_service_evidence e where e.id=evid and e.assignment_id=a.id and e.provider_id=p.provider_id and e.evidence_type='COMPLETION' and e.status='PENDING') then raise exception 'A valid pending completion photo is required'; end if;
    update public.job_service_evidence set status='DUPLICATE' where assignment_id=a.id and evidence_type='COMPLETION' and status='PENDING' and id<>evid;
    update public.job_service_evidence set status='COMMITTED',committed_at=now() where id=evid;
    update public.job_assignments set status='COMPLETED',updated_at=now() where id=a.id;
    insert into public.assignment_status_history(assignment_id,old_status,new_status,changed_by_provider_user,note) values(a.id,a.status,'COMPLETED',p_actor,nullif(p_payload->>'note',''));
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
    if a.status<>'COMPLETED' then raise exception 'Complete the assigned service before Check Out'; end if;
    if not exists(select 1 from public.job_service_events where assignment_id=a.id and event_type='COMPLETED') then raise exception 'Completion must be recorded before Check Out'; end if;
    if not exists(select 1 from public.job_service_evidence where assignment_id=a.id and evidence_type='COMPLETION' and status='COMMITTED') then raise exception 'Official completion photo is missing'; end if;
    if exists(select 1 from public.job_service_events where assignment_id=a.id and event_type='CHECKED_OUT') then return jsonb_build_object('ok',true,'already_recorded',true,'job_status',(select status from public.jobs where id=j.id)); end if;
    evid:=nullif(p_payload->>'evidence_id','')::uuid;
    if evid is null or not exists(select 1 from public.job_service_evidence e where e.id=evid and e.assignment_id=a.id and e.provider_id=p.provider_id and e.evidence_type='CHECK_OUT' and e.status='PENDING') then raise exception 'A valid pending Check Out photo is required'; end if;
    update public.job_service_evidence set status='DUPLICATE' where assignment_id=a.id and evidence_type='CHECK_OUT' and status='PENDING' and id<>evid;
    update public.job_service_evidence set status='COMMITTED',committed_at=now() where id=evid;
    insert into public.job_service_events(job_id,assignment_id,provider_id,event_type,event_note) values(j.id,a.id,p.provider_id,'CHECKED_OUT','PLEASE Staff Check Out completed with photo evidence.');

  else raise exception 'Invalid action'; end if;
  v_job_status:=coalesce(v_job_status,public.please_refresh_job_status(j.id));
  return jsonb_build_object('ok',true,'job_status',v_job_status,'worker_type',v_worker_type);
end $$;
revoke all on function public.provider_live_service_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.provider_live_service_action(uuid,uuid,text,jsonb) to service_role;


-- ------------------------------------------------------------
-- 3) Controlled Service Maintenance audit + hard-delete RPC.
-- Every destructive operation is snapshotted before deletion.
-- ------------------------------------------------------------
create table if not exists public.admin_service_maintenance_audit (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references public.admin_portal_users(id) on delete set null,
  action text not null check(action in ('EDIT','DELETE')),
  record_type text not null check(record_type in ('SERVICE_REQUEST','JOB')),
  record_id uuid not null,
  reference text,
  reason text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_service_maintenance_audit_created_idx
  on public.admin_service_maintenance_audit(created_at desc);
alter table public.admin_service_maintenance_audit enable row level security;
revoke all on public.admin_service_maintenance_audit from anon,authenticated;

create or replace function public.admin_service_maintenance_delete(
  p_actor uuid,
  p_record_type text,
  p_record_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_type text:=upper(trim(p_record_type));
  v_snapshot jsonb;
  v_reference text;
  v_customer_id uuid;
  v_count integer:=0;
begin
  if not exists(select 1 from public.admin_portal_users where id=p_actor and active=true) then
    raise exception 'Unauthorized';
  end if;
  if v_type not in ('SERVICE_REQUEST','JOB') then raise exception 'Invalid maintenance record type'; end if;

  if v_type='SERVICE_REQUEST' then
    select to_jsonb(sr),sr.reference,sr.customer_id into v_snapshot,v_reference,v_customer_id
      from public.service_requests sr where sr.id=p_record_id for update;
    if v_snapshot is null then raise exception 'Service Request not found'; end if;
    insert into public.admin_service_maintenance_audit(admin_user_id,action,record_type,record_id,reference,reason,snapshot)
    values(p_actor,'DELETE',v_type,p_record_id,v_reference,nullif(trim(p_reason),''),v_snapshot);
    delete from public.service_requests where id=p_record_id;
    get diagnostics v_count=row_count;
    if v_customer_id is not null then
      update public.customers c
         set service_request_count=x.cnt,
             first_service_request_at=x.first_at,
             last_service_request_at=x.last_at,
             updated_at=now()
        from (
          select count(*)::integer cnt,min(created_at) first_at,max(created_at) last_at
            from public.service_requests where customer_id=v_customer_id
        ) x
       where c.id=v_customer_id;
    end if;
  else
    select to_jsonb(j),j.reference into v_snapshot,v_reference
      from public.jobs j where j.id=p_record_id for update;
    if v_snapshot is null then raise exception 'Job not found'; end if;
    insert into public.admin_service_maintenance_audit(admin_user_id,action,record_type,record_id,reference,reason,snapshot)
    values(p_actor,'DELETE',v_type,p_record_id,v_reference,nullif(trim(p_reason),''),v_snapshot);

    -- Return an attached intake request to an actionable state before deleting the Job.
    update public.service_requests
       set job_id=null,
           status=case when status='ASSIGNED' then 'READY_TO_ASSIGN' else status end,
           assigned_at=case when status='ASSIGNED' then null else assigned_at end,
           updated_at=now()
     where job_id=p_record_id;

    -- Known restrictive/supporting financial rows are handled explicitly.
    if to_regclass('public.provider_advances') is not null then
      update public.provider_advances set job_id=null where job_id=p_record_id;
    end if;
    if to_regclass('public.provider_payments') is not null then
      delete from public.provider_payments where job_id=p_record_id;
    end if;
    if to_regclass('public.invoices') is not null and exists(
      select 1 from information_schema.columns where table_schema='public' and table_name='invoices' and column_name='job_id'
    ) then
      execute 'delete from public.invoices where job_id=$1' using p_record_id;
    end if;

    delete from public.jobs where id=p_record_id;
    get diagnostics v_count=row_count;
  end if;

  return jsonb_build_object('ok',true,'record_type',v_type,'record_id',p_record_id,'reference',v_reference,'deleted',v_count);
end $$;
revoke all on function public.admin_service_maintenance_delete(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_service_maintenance_delete(uuid,text,uuid,text) to service_role;

notify pgrst,'reload schema';
commit;
