-- PLEASE STEP 14 — Live Service Operations, Extensions, Internal Alerts, Staff & Advances
create extension if not exists pgcrypto;

alter table public.jobs add column if not exists actual_arrived_at timestamptz;
alter table public.jobs add column if not exists actual_started_at timestamptz;
alter table public.jobs add column if not exists actual_completed_at timestamptz;
alter table public.jobs add column if not exists approved_extension_minutes integer not null default 0;
alter table public.providers add column if not exists worker_type text not null default 'INDEPENDENT_PROVIDER' check (worker_type in ('INDEPENDENT_PROVIDER','PLEASE_STAFF'));

create table if not exists public.job_service_events(
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references public.jobs(id) on delete cascade,
 assignment_id uuid references public.job_assignments(id) on delete set null,
 provider_id uuid references public.providers(id) on delete set null,
 event_type text not null check (event_type in ('REMINDER_24H','ARRIVED','STARTED','EXTENSION_REQUESTED','EXTENSION_APPROVED','EXTENSION_REJECTED','COMPLETED','CUSTOMER_NOTIFIED')),
 event_note text,
 customer_message text,
 created_at timestamptz not null default now()
);
create index if not exists job_service_events_job_idx on public.job_service_events(job_id,created_at desc);

create table if not exists public.job_extension_requests(
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references public.jobs(id) on delete cascade,
 assignment_id uuid not null references public.job_assignments(id) on delete cascade,
 provider_id uuid not null references public.providers(id) on delete cascade,
 billing_item_id uuid references public.job_billing_items(id) on delete set null,
 extra_minutes integer not null check(extra_minutes between 15 and 480),
 reason text,
 original_end timestamptz not null,
 proposed_end timestamptz not null,
 customer_addition numeric(10,2) not null default 0,
 provider_addition numeric(10,2) not null default 0,
 status text not null default 'PENDING' check(status in ('PENDING','APPROVED','REJECTED')),
 customer_approval_method text,
 admin_note text,
 created_at timestamptz not null default now(),
 reviewed_at timestamptz
);
create index if not exists job_extension_requests_job_idx on public.job_extension_requests(job_id,created_at desc);

create table if not exists public.provider_advances(
 id uuid primary key default gen_random_uuid(),
 provider_id uuid not null references public.providers(id) on delete restrict,
 job_id uuid references public.jobs(id) on delete set null,
 amount numeric(10,2) not null check(amount>0),
 method text,
 reference text,
 note text,
 status text not null default 'PAID' check(status in ('PENDING','PAID','VOID')),
 paid_at timestamptz,
 created_at timestamptz not null default now()
);

alter table public.job_service_events enable row level security;
alter table public.job_extension_requests enable row level security;
alter table public.provider_advances enable row level security;
revoke all on public.job_service_events, public.job_extension_requests, public.provider_advances from anon,authenticated;
grant all on public.job_service_events, public.job_extension_requests, public.provider_advances to service_role;

create or replace function public.provider_live_service_action(p_actor uuid,p_assignment_id uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.job_assignments%rowtype; j public.jobs%rowtype; p public.provider_portal_users%rowtype; bi public.job_billing_items%rowtype; mins int; proposed timestamptz; ca numeric(10,2); pa numeric(10,2); rid uuid;
begin
 select * into p from public.provider_portal_users where id=p_actor and active=true;
 if not found then raise exception 'Unauthorized'; end if;
 select * into a from public.job_assignments where id=p_assignment_id and provider_id=p.provider_id for update;
 if not found then raise exception 'Assignment not found'; end if;
 select * into j from public.jobs where id=a.job_id for update;
 if upper(p_action)='ARRIVE' then
   if a.status<>'CONFIRMED' then raise exception 'Only confirmed service can be marked arrived'; end if;
   if j.actual_arrived_at is null then update public.jobs set actual_arrived_at=now(),updated_at=now() where id=j.id; insert into public.job_service_events(job_id,assignment_id,provider_id,event_type,customer_message) values(j.id,a.id,p.provider_id,'ARRIVED','Your PLEASE professional has arrived.'); end if;
 elsif upper(p_action)='START' then
   if j.actual_arrived_at is null then raise exception 'Record arrival before starting the service'; end if;
   if j.actual_started_at is null then update public.jobs set actual_started_at=now(),status='IN_PROGRESS',updated_at=now() where id=j.id; insert into public.job_status_history(job_id,old_status,new_status,changed_by_provider_user,note) values(j.id,j.status,'IN_PROGRESS',p_actor,'Service started by Provider'); insert into public.job_service_events(job_id,assignment_id,provider_id,event_type,customer_message) values(j.id,a.id,p.provider_id,'STARTED','Your PLEASE service is now in progress.'); end if;
 elsif upper(p_action)='REQUEST_EXTENSION' then
   if j.actual_started_at is null then raise exception 'Start the service before requesting additional time'; end if;
   if exists(select 1 from public.job_extension_requests where assignment_id=a.id and status='PENDING') then raise exception 'An extension request is already pending'; end if;
   mins:=greatest(15,least(480,coalesce((p_payload->>'extra_minutes')::int,0)));
   if mins=0 then raise exception 'Extension time is required'; end if;
   select * into bi from public.job_billing_items where id=(p_payload->>'billing_item_id')::uuid and job_id=j.id;
   if not found or lower(coalesce(bi.unit,''))<>'hour' then raise exception 'Select an hourly billing item'; end if;
   proposed:=a.scheduled_end + make_interval(mins=>mins);
   ca:=round(coalesce(bi.customer_unit_rate,bi.unit_rate,0)*(mins/60.0),2);
   pa:=round(coalesce(bi.provider_unit_rate,0)*(mins/60.0),2);
   insert into public.job_extension_requests(job_id,assignment_id,provider_id,billing_item_id,extra_minutes,reason,original_end,proposed_end,customer_addition,provider_addition)
   values(j.id,a.id,p.provider_id,bi.id,mins,nullif(p_payload->>'reason',''),a.scheduled_end,proposed,ca,pa) returning id into rid;
   insert into public.job_service_events(job_id,assignment_id,provider_id,event_type,event_note,customer_message) values(j.id,a.id,p.provider_id,'EXTENSION_REQUESTED',mins||' minutes requested','Additional service time has been requested and is awaiting approval.');
   return jsonb_build_object('ok',true,'extension_request_id',rid);
 elsif upper(p_action)='COMPLETE' then
   if j.actual_started_at is null then raise exception 'Start the service before completing it'; end if;
   update public.jobs set actual_completed_at=coalesce(actual_completed_at,now()),completed_at=coalesce(completed_at,now()),status='COMPLETED',completion_notes=coalesce(nullif(p_payload->>'note',''),completion_notes),updated_at=now() where id=j.id;
   update public.job_assignments set status='COMPLETED',updated_at=now() where id=a.id;
   insert into public.assignment_status_history(assignment_id,old_status,new_status,changed_by_provider_user,note) values(a.id,a.status,'COMPLETED',p_actor,nullif(p_payload->>'note',''));
   insert into public.job_status_history(job_id,old_status,new_status,changed_by_provider_user,note) values(j.id,j.status,'COMPLETED',p_actor,nullif(p_payload->>'note',''));
   insert into public.job_service_events(job_id,assignment_id,provider_id,event_type,customer_message) values(j.id,a.id,p.provider_id,'COMPLETED','Your PLEASE service has been completed.');
 else raise exception 'Invalid action'; end if;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.admin_review_extension(p_actor uuid,p_request_id uuid,p_action text,p_note text default null,p_customer_approval_method text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.job_extension_requests%rowtype; a public.job_assignments%rowtype; bi public.job_billing_items%rowtype; conflict_count int; new_item_id uuid;
begin
 if not exists(select 1 from public.admin_portal_users where id=p_actor and active=true) then raise exception 'Unauthorized'; end if;
 select * into r from public.job_extension_requests where id=p_request_id for update;
 if not found or r.status<>'PENDING' then raise exception 'Extension request is not pending'; end if;
 select * into a from public.job_assignments where id=r.assignment_id for update;
 if upper(p_action)='REJECT' then
   update public.job_extension_requests set status='REJECTED',admin_note=p_note,reviewed_at=now() where id=r.id;
   insert into public.job_service_events(job_id,assignment_id,provider_id,event_type,event_note) values(r.job_id,r.assignment_id,r.provider_id,'EXTENSION_REJECTED',p_note);
   return jsonb_build_object('ok',true,'status','REJECTED');
 end if;
 if upper(p_action)<>'APPROVE' then raise exception 'Invalid action'; end if;
 select count(*) into conflict_count from public.job_assignments x where x.provider_id=r.provider_id and x.id<>r.assignment_id and x.status in ('PENDING','CONFIRMED') and tstzrange(x.scheduled_start,x.scheduled_end,'[)') && tstzrange(a.scheduled_start,r.proposed_end,'[)');
 if conflict_count>0 then raise exception 'Extension conflicts with another assignment'; end if;
 update public.job_assignments set scheduled_end=r.proposed_end,updated_at=now() where id=a.id;
 update public.jobs set estimated_duration_minutes=coalesce(estimated_duration_minutes,0)+r.extra_minutes,approved_extension_minutes=coalesce(approved_extension_minutes,0)+r.extra_minutes,quoted_subtotal=coalesce(quoted_subtotal,0)+r.customer_addition,updated_at=now() where id=r.job_id;
 select * into bi from public.job_billing_items where id=r.billing_item_id;
 if found then
   insert into public.job_billing_items(job_id,provider_service_rate_id,service_id,service_name,description,quantity,unit,customer_unit_rate,customer_line_total,provider_unit_rate,provider_line_total,gross_profit,unit_rate,line_total,sort_order)
   values(r.job_id,bi.provider_service_rate_id,bi.service_id,bi.service_name,'Approved time extension',r.extra_minutes/60.0,'hour',bi.customer_unit_rate,r.customer_addition,bi.provider_unit_rate,r.provider_addition,r.customer_addition-r.provider_addition,bi.customer_unit_rate,r.customer_addition,coalesce(bi.sort_order,0)+1000)
   returning id into new_item_id;
 end if;
 update public.job_extension_requests set status='APPROVED',admin_note=p_note,customer_approval_method=p_customer_approval_method,reviewed_at=now() where id=r.id;
 insert into public.job_service_events(job_id,assignment_id,provider_id,event_type,event_note,customer_message) values(r.job_id,r.assignment_id,r.provider_id,'EXTENSION_APPROVED',r.extra_minutes||' minutes approved','Your service time has been extended with approval.');
 return jsonb_build_object('ok',true,'status','APPROVED','new_end',r.proposed_end,'billing_item_id',new_item_id);
end $$;

-- Advance reconciliation against Provider Payments.
alter table public.provider_advances add column if not exists applied_amount numeric(10,2) not null default 0 check(applied_amount>=0 and applied_amount<=amount);
alter table public.provider_payments add column if not exists advance_applied numeric(10,2) not null default 0;
alter table public.provider_payments add column if not exists cash_paid numeric(10,2);

create or replace function public.developer_create_please_staff(
  p_actor uuid,
  p_display_name text,
  p_email text,
  p_phone text,
  p_password text
) returns jsonb
language plpgsql security definer
set search_path=public,extensions
as $$
declare pid uuid:=gen_random_uuid(); pref text; slugv text; emailv text:=lower(trim(coalesce(p_email,'')));
begin
  if not exists(select 1 from public.admin_portal_users where id=p_actor and active=true and role='DEVELOPER_ADMIN') then raise exception 'Unauthorized'; end if;
  if length(trim(coalesce(p_display_name,'')))<2 then raise exception 'Display name is required'; end if;
  if emailv='' or position('@' in emailv)=0 then raise exception 'Valid login email is required'; end if;
  if length(coalesce(p_password,''))<10 then raise exception 'Password must be at least 10 characters'; end if;
  if exists(select 1 from public.provider_portal_users where lower(email)=emailv) then raise exception 'Login email is already in use'; end if;
  pref:='PLS-STAFF-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(replace(pid::text,'-',''),1,6));
  slugv:=trim(both '-' from lower(regexp_replace(trim(p_display_name)||'-'||substr(replace(pid::text,'-',''),1,6),'[^a-zA-Z0-9]+','-','g')));
  insert into public.providers(id,reference,display_name,company_name,slug,primary_email,primary_phone,public_title,service_area,status,public_visible,activated_at,created_by_portal_user,updated_by_portal_user,worker_type)
  values(pid,pref,trim(p_display_name),'PLEASE Services',slugv,emailv,nullif(trim(coalesce(p_phone,'')),''),'PLEASE Staff','Calgary','ACTIVE',false,now(),p_actor,p_actor,'PLEASE_STAFF');
  insert into public.provider_portal_users(provider_id,email,display_name,password_hash,active)
  values(pid,emailv,trim(p_display_name),crypt(p_password,gen_salt('bf',12)),true);
  insert into public.provider_technical_history(provider_id,event_type,event_label,details,actor_type,actor_admin_user_id)
  values(pid,'STAFF_CREATED','PLEASE Staff account created',jsonb_build_object('login_email',emailv),'DEVELOPER',p_actor);
  return jsonb_build_object('ok',true,'provider_id',pid,'reference',pref);
end $$;
revoke all on function public.developer_create_please_staff(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.developer_create_please_staff(uuid,text,text,text,text) to service_role;
