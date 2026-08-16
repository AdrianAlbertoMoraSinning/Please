begin;

-- STEP 10.3 — Convert READY_TO_ASSIGN customer Service Requests into the existing Job + Assignment workflow.
-- The actual Job is still created by the already-tested please_portal_job_action RPC. This migration
-- adds an auditable, one-to-one source link so a customer request cannot accidentally be converted twice.

alter table public.jobs
  add column if not exists source_service_request_id uuid references public.service_requests(id) on delete set null;

create unique index if not exists jobs_source_service_request_unique_idx
  on public.jobs(source_service_request_id)
  where source_service_request_id is not null;

create or replace function public.please_link_service_request_to_job(
  p_actor uuid,
  p_request_id uuid,
  p_job_id uuid
)
returns public.service_requests
language plpgsql
security definer
set search_path=public
as $$
declare
  v_request public.service_requests;
  v_old text;
begin
  perform public.require_please_portal_admin(p_actor);

  select * into v_request
    from public.service_requests
   where id=p_request_id
   for update;
  if not found then raise exception 'Service request not found'; end if;

  if not exists(select 1 from public.jobs where id=p_job_id) then
    raise exception 'Job not found';
  end if;

  if v_request.status='ASSIGNED' and v_request.job_id=p_job_id then
    update public.jobs
       set source_service_request_id=p_request_id,
           updated_at=now()
     where id=p_job_id
       and (source_service_request_id is null or source_service_request_id=p_request_id);
    return v_request;
  end if;

  if v_request.status <> 'READY_TO_ASSIGN' then
    raise exception 'Service request must be READY_TO_ASSIGN before conversion';
  end if;
  if v_request.job_id is not null then
    raise exception 'Service request is already linked to a Job';
  end if;
  if exists(select 1 from public.jobs where source_service_request_id=p_request_id and id<>p_job_id) then
    raise exception 'Service request has already been converted to another Job';
  end if;

  update public.jobs
     set source_service_request_id=p_request_id,
         updated_at=now()
   where id=p_job_id;

  v_old := v_request.status;
  update public.service_requests
     set status='ASSIGNED',
         assigned_at=now(),
         job_id=p_job_id,
         updated_at=now()
   where id=p_request_id
   returning * into v_request;

  insert into public.service_request_status_history(
    service_request_id,old_status,new_status,note,changed_by_admin_portal_user
  ) values(
    p_request_id,v_old,'ASSIGNED','Converted to Job by PLEASE Administration',p_actor
  );

  return v_request;
end;
$$;

revoke all on function public.please_link_service_request_to_job(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.please_link_service_request_to_job(uuid,uuid,uuid) to service_role;

commit;
