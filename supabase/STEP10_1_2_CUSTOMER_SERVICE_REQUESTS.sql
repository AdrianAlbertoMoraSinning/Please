begin;

-- STEP 10.1 + 10.2 — Public Customer Service Requests + PLEASE Administration queue

create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  tracking_token_hash text not null unique,
  first_name text not null,
  last_name text,
  email text not null,
  phone text not null,
  service_id uuid not null references public.services(id) on delete restrict,
  service_name text not null,
  street_address text not null,
  city text not null default 'Calgary',
  province text not null default 'AB',
  postal_code text,
  work_description text not null,
  preferred_date date,
  preferred_start_time time,
  scheduling_flexibility text not null default 'FLEXIBLE',
  customer_notes text,
  status text not null default 'NEW',
  internal_notes text,
  reviewed_at timestamptz,
  ready_to_assign_at timestamptz,
  assigned_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  job_id uuid references public.jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_requests_status_check check (status in ('NEW','REVIEWING','READY_TO_ASSIGN','ASSIGNED','CANCELLED')),
  constraint service_requests_flexibility_check check (scheduling_flexibility in ('EXACT','SAME_DAY','FLEXIBLE','ANYTIME'))
);

create index if not exists service_requests_status_created_idx on public.service_requests(status, created_at desc);
create index if not exists service_requests_service_idx on public.service_requests(service_id, created_at desc);
create index if not exists service_requests_email_idx on public.service_requests(lower(email), created_at desc);
create index if not exists service_requests_job_idx on public.service_requests(job_id) where job_id is not null;

create table if not exists public.service_request_status_history (
  id uuid primary key default gen_random_uuid(),
  service_request_id uuid not null references public.service_requests(id) on delete cascade,
  old_status text,
  new_status text not null,
  note text,
  changed_by_admin_portal_user uuid references public.admin_portal_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists service_request_history_request_idx on public.service_request_status_history(service_request_id, created_at desc);

alter table public.service_requests enable row level security;
alter table public.service_request_status_history enable row level security;

-- Server-side service role owns all public submission/admin reads. No browser policies are granted.

create or replace function public.set_service_requests_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists service_requests_set_updated_at on public.service_requests;
create trigger service_requests_set_updated_at
before update on public.service_requests
for each row execute function public.set_service_requests_updated_at();

create or replace function public.generate_service_request_reference()
returns text language sql as $$
  select 'PLS-REQ-' || to_char(now() at time zone 'America/Edmonton','YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
$$;

-- Controlled admin transition used by Netlify backend.
create or replace function public.please_service_request_action(
  p_actor uuid,
  p_request_id uuid,
  p_action text,
  p_value text default null
)
returns public.service_requests
language plpgsql
security definer
set search_path=public
as $$
declare
  v_row public.service_requests;
  v_old text;
  v_new text;
  v_note text;
begin
  perform public.require_please_portal_admin(p_actor);
  select * into v_row from public.service_requests where id=p_request_id for update;
  if not found then raise exception 'Service request not found'; end if;
  v_old := v_row.status;
  v_note := nullif(trim(coalesce(p_value,'')),'');

  case upper(trim(coalesce(p_action,'')))
    when 'START_REVIEW' then
      if v_old <> 'NEW' then raise exception 'Only NEW requests can start review'; end if;
      v_new := 'REVIEWING';
      update public.service_requests set status=v_new, reviewed_at=coalesce(reviewed_at,now()) where id=p_request_id returning * into v_row;
    when 'READY_TO_ASSIGN' then
      if v_old not in ('NEW','REVIEWING') then raise exception 'Request is not ready for this transition'; end if;
      v_new := 'READY_TO_ASSIGN';
      update public.service_requests set status=v_new, reviewed_at=coalesce(reviewed_at,now()), ready_to_assign_at=now() where id=p_request_id returning * into v_row;
    when 'CANCEL' then
      if v_old in ('ASSIGNED','CANCELLED') then raise exception 'Request cannot be cancelled from its current status'; end if;
      if v_note is null then raise exception 'Cancellation reason is required'; end if;
      v_new := 'CANCELLED';
      update public.service_requests set status=v_new, cancelled_at=now(), cancellation_reason=v_note where id=p_request_id returning * into v_row;
    when 'SAVE_NOTES' then
      update public.service_requests set internal_notes=coalesce(p_value,'') where id=p_request_id returning * into v_row;
      return v_row;
    else raise exception 'Unsupported action';
  end case;

  insert into public.service_request_status_history(service_request_id,old_status,new_status,note,changed_by_admin_portal_user)
  values(p_request_id,v_old,v_new,v_note,p_actor);
  return v_row;
end;
$$;

revoke all on function public.please_service_request_action(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.please_service_request_action(uuid,uuid,text,text) to service_role;

commit;
