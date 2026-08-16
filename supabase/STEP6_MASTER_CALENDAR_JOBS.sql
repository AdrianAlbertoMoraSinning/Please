begin;

-- ============================================================================
-- STEP 6 — PLEASE Master Calendar + Job Assignment
-- Custom PLEASE Admin sessions remain independent of Supabase Auth.
-- ============================================================================

-- Attribute operational records to the custom PLEASE Admin account.
alter table public.jobs
  add column if not exists created_by_admin_portal_user uuid
    references public.admin_portal_users(id) on delete set null;

alter table public.job_assignments
  add column if not exists assigned_by_admin_portal_user uuid
    references public.admin_portal_users(id) on delete set null;

alter table public.assignment_status_history
  add column if not exists changed_by_admin_portal_user uuid
    references public.admin_portal_users(id) on delete set null;

create index if not exists jobs_created_by_admin_portal_idx
  on public.jobs(created_by_admin_portal_user, created_at desc);

create index if not exists job_assignments_admin_portal_idx
  on public.job_assignments(assigned_by_admin_portal_user, assigned_at desc);

-- --------------------------------------------------------------------------
-- Helper: ensure the custom portal actor is an active PLEASE administrator.
-- --------------------------------------------------------------------------
create or replace function public.require_please_portal_admin(p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
      from public.admin_portal_users u
     where u.id = p_actor
       and u.active = true
       and u.role = 'PLEASE_ADMIN'
  ) then
    raise exception 'Unauthorized';
  end if;
end;
$$;

revoke all on function public.require_please_portal_admin(uuid) from public, anon, authenticated;
grant execute on function public.require_please_portal_admin(uuid) to service_role;

-- --------------------------------------------------------------------------
-- Helper: determine whether a provider is available for the requested window.
-- Calendar timezone is Calgary / America/Edmonton.
-- AVAILABLE exceptions can open a special window; UNAVAILABLE exceptions win.
-- --------------------------------------------------------------------------
create or replace function public.provider_is_available_for_window(
  p_provider_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date;
  v_end_date date;
  v_start_time time;
  v_end_time time;
  v_weekday int;
  v_base_available boolean := false;
  v_special_available boolean := false;
  v_blocked boolean := false;
begin
  if p_provider_id is null or p_start is null or p_end is null or p_end <= p_start then
    return false;
  end if;

  v_date := (p_start at time zone 'America/Edmonton')::date;
  v_end_date := (p_end at time zone 'America/Edmonton')::date;
  if v_date <> v_end_date then
    return false;
  end if;

  v_start_time := (p_start at time zone 'America/Edmonton')::time;
  v_end_time := (p_end at time zone 'America/Edmonton')::time;
  v_weekday := extract(isodow from (p_start at time zone 'America/Edmonton'))::int;

  select exists (
    select 1
      from public.provider_availability a
     where a.provider_id = p_provider_id
       and a.active = true
       and a.weekday = v_weekday
       and a.start_time <= v_start_time
       and a.end_time >= v_end_time
  ) into v_base_available;

  select exists (
    select 1
      from public.provider_availability_exceptions e
     where e.provider_id = p_provider_id
       and e.exception_date = v_date
       and e.exception_type = 'AVAILABLE'
       and (
         (e.start_time is null and e.end_time is null)
         or (e.start_time <= v_start_time and e.end_time >= v_end_time)
       )
  ) into v_special_available;

  select exists (
    select 1
      from public.provider_availability_exceptions e
     where e.provider_id = p_provider_id
       and e.exception_date = v_date
       and e.exception_type = 'UNAVAILABLE'
       and (
         (e.start_time is null and e.end_time is null)
         or tstzrange(
              (e.exception_date + e.start_time) at time zone 'America/Edmonton',
              (e.exception_date + e.end_time) at time zone 'America/Edmonton',
              '[)'
            ) && tstzrange(p_start,p_end,'[)')
       )
  ) into v_blocked;

  return (v_base_available or v_special_available) and not v_blocked;
end;
$$;

revoke all on function public.provider_is_available_for_window(uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.provider_is_available_for_window(uuid,timestamptz,timestamptz) to service_role;

-- --------------------------------------------------------------------------
-- Main controlled action endpoint used by the Netlify backend.
-- --------------------------------------------------------------------------
create or replace function public.please_portal_job_action(
  p_actor uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := upper(trim(coalesce(p_action,'')));
  v_provider_id uuid;
  v_service_id uuid;
  v_job_id uuid;
  v_assignment_id uuid;
  v_customer_id uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_service_name text;
  v_reference text;
  v_email text;
  v_phone text;
  v_first_name text;
  v_last_name text;
  v_job_status text;
  v_assignment_status text;
begin
  perform public.require_please_portal_admin(p_actor);

  if v_action in ('CREATE_AND_ASSIGN','ASSIGN_EXISTING') then
    v_provider_id := nullif(p_payload->>'provider_id','')::uuid;
    v_service_id := nullif(p_payload->>'service_id','')::uuid;
    v_start := nullif(p_payload->>'scheduled_start','')::timestamptz;
    v_end := nullif(p_payload->>'scheduled_end','')::timestamptz;

    if v_provider_id is null or v_service_id is null or v_start is null or v_end is null then
      raise exception 'Provider, service, start and end are required';
    end if;
    if v_end <= v_start then raise exception 'End time must be after start time'; end if;

    select s.name into v_service_name
      from public.services s
     where s.id=v_service_id and s.active=true;
    if v_service_name is null then raise exception 'Selected service is not active'; end if;

    if not exists (
      select 1
        from public.providers p
        join public.provider_services ps on ps.provider_id=p.id and ps.active=true
       where p.id=v_provider_id and p.status='ACTIVE' and ps.service_id=v_service_id
    ) then
      raise exception 'Provider is not active for the selected service';
    end if;

    if not public.provider_is_available_for_window(v_provider_id,v_start,v_end) then
      raise exception 'Provider is not available for the selected time';
    end if;
  end if;

  if v_action='CREATE_AND_ASSIGN' then
    if nullif(trim(p_payload->>'customer_first_name'),'') is null then raise exception 'Customer first name is required'; end if;
    if nullif(trim(p_payload->>'work_address'),'') is null then raise exception 'Work address is required'; end if;
    if nullif(trim(p_payload->>'work_description'),'') is null then raise exception 'Work description is required'; end if;

    v_email := nullif(lower(trim(p_payload->>'customer_email')),'');
    v_phone := nullif(trim(p_payload->>'customer_phone'),'');
    v_first_name := trim(p_payload->>'customer_first_name');
    v_last_name := nullif(trim(p_payload->>'customer_last_name'),'');

    -- Reuse a customer where possible; otherwise create one.
    if v_email is not null then
      select id into v_customer_id from public.customers where lower(email)=v_email order by created_at desc limit 1;
    end if;
    if v_customer_id is null and v_phone is not null then
      select id into v_customer_id from public.customers where phone=v_phone order by created_at desc limit 1;
    end if;

    if v_customer_id is null then
      insert into public.customers(first_name,last_name,phone,email,address_line1,city,province,postal_code)
      values(
        v_first_name,v_last_name,v_phone,v_email,
        nullif(trim(p_payload->>'work_address'),''),
        nullif(trim(p_payload->>'customer_city'),''),
        coalesce(nullif(trim(p_payload->>'customer_province'),''),'AB'),
        nullif(trim(p_payload->>'customer_postal_code'),'')
      ) returning id into v_customer_id;
    else
      update public.customers
         set first_name=v_first_name,
             last_name=coalesce(v_last_name,last_name),
             phone=coalesce(v_phone,phone),
             email=coalesce(v_email,email),
             updated_at=now()
       where id=v_customer_id;
    end if;

    v_job_id := gen_random_uuid();
    v_reference := 'PLS-JOB-' || to_char(current_date,'YYYYMMDD') || '-' || upper(substr(replace(v_job_id::text,'-',''),1,6));

    insert into public.jobs(
      id,reference,customer_id,service_id,service_name,work_address,work_description,
      estimated_duration_minutes,status,internal_notes,created_by_admin_portal_user
    ) values(
      v_job_id,v_reference,v_customer_id,v_service_id,v_service_name,
      trim(p_payload->>'work_address'),trim(p_payload->>'work_description'),
      greatest(1,coalesce(nullif(p_payload->>'estimated_duration_minutes','')::integer,
                          extract(epoch from (v_end-v_start))::integer/60)),
      'PENDING_PROVIDER',nullif(trim(p_payload->>'internal_notes'),''),p_actor
    );

    insert into public.job_assignments(
      job_id,provider_id,scheduled_start,scheduled_end,status,assignment_message,
      assigned_by_admin_portal_user
    ) values(
      v_job_id,v_provider_id,v_start,v_end,'PENDING',nullif(trim(p_payload->>'assignment_message'),''),p_actor
    ) returning id into v_assignment_id;

    insert into public.assignment_status_history(
      assignment_id,old_status,new_status,changed_by_admin_portal_user,note
    ) values(v_assignment_id,null,'PENDING',p_actor,'Assignment created by PLEASE');

    return jsonb_build_object('ok',true,'job_id',v_job_id,'job_reference',v_reference,'assignment_id',v_assignment_id,'status','PENDING');

  elsif v_action='ASSIGN_EXISTING' then
    v_job_id := nullif(p_payload->>'job_id','')::uuid;
    if v_job_id is null then raise exception 'Job ID is required'; end if;

    select status,service_id,service_name into v_job_status,v_service_id,v_service_name
      from public.jobs where id=v_job_id for update;
    if not found then raise exception 'Job not found'; end if;
    if v_job_status <> 'NEEDS_ASSIGNMENT' then raise exception 'Job is not waiting for assignment'; end if;
    if v_service_id is null then raise exception 'Job does not have a service ID'; end if;

    -- Provider/service/availability validation using the job's actual service.
    if not exists (
      select 1 from public.providers p
      join public.provider_services ps on ps.provider_id=p.id and ps.active=true
      where p.id=v_provider_id and p.status='ACTIVE' and ps.service_id=v_service_id
    ) then raise exception 'Provider is not active for this job service'; end if;
    if not public.provider_is_available_for_window(v_provider_id,v_start,v_end) then
      raise exception 'Provider is not available for the selected time';
    end if;

    insert into public.job_assignments(
      job_id,provider_id,scheduled_start,scheduled_end,status,assignment_message,
      assigned_by_admin_portal_user
    ) values(
      v_job_id,v_provider_id,v_start,v_end,'PENDING',nullif(trim(p_payload->>'assignment_message'),''),p_actor
    ) returning id into v_assignment_id;

    update public.jobs set status='PENDING_PROVIDER',updated_at=now() where id=v_job_id;
    insert into public.assignment_status_history(assignment_id,old_status,new_status,changed_by_admin_portal_user,note)
    values(v_assignment_id,null,'PENDING',p_actor,'Job reassigned by PLEASE');

    return jsonb_build_object('ok',true,'job_id',v_job_id,'assignment_id',v_assignment_id,'status','PENDING');

  elsif v_action='CANCEL_ASSIGNMENT' then
    v_assignment_id := nullif(p_payload->>'assignment_id','')::uuid;
    if v_assignment_id is null then raise exception 'Assignment ID is required'; end if;

    select job_id,status into v_job_id,v_assignment_status
      from public.job_assignments
     where id=v_assignment_id for update;
    if not found then raise exception 'Assignment not found'; end if;
    if v_assignment_status not in ('PENDING','CONFIRMED') then
      raise exception 'Only pending or confirmed assignments can be cancelled';
    end if;

    update public.job_assignments
       set status='CANCELLED',updated_at=now()
     where id=v_assignment_id;
    update public.jobs
       set status='NEEDS_ASSIGNMENT',updated_at=now()
     where id=v_job_id and status in ('PENDING_PROVIDER','CONFIRMED','SCHEDULED');
    insert into public.assignment_status_history(assignment_id,old_status,new_status,changed_by_admin_portal_user,note)
    values(v_assignment_id,v_assignment_status,'CANCELLED',p_actor,nullif(trim(p_payload->>'note'),''));

    return jsonb_build_object('ok',true,'job_id',v_job_id,'assignment_id',v_assignment_id,'status','CANCELLED');

  elsif v_action='CANCEL_JOB' then
    v_job_id := nullif(p_payload->>'job_id','')::uuid;
    if v_job_id is null then raise exception 'Job ID is required'; end if;
    select status into v_job_status from public.jobs where id=v_job_id for update;
    if not found then raise exception 'Job not found'; end if;
    if v_job_status in ('COMPLETED','CANCELLED') then raise exception 'Job cannot be cancelled from its current status'; end if;

    update public.job_assignments
       set status='CANCELLED',updated_at=now()
     where job_id=v_job_id and status in ('PENDING','CONFIRMED');
    update public.jobs set status='CANCELLED',updated_at=now() where id=v_job_id;
    return jsonb_build_object('ok',true,'job_id',v_job_id,'status','CANCELLED');
  end if;

  raise exception 'Unsupported job action';
end;
$$;

revoke all on function public.please_portal_job_action(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.please_portal_job_action(uuid,text,jsonb) to service_role;

commit;
