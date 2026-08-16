begin;

-- ============================================================================
-- STEP 7 — Jobs Management + Service History + Reports
-- Adds explicit job lifecycle history and controlled completion/cancellation.
-- ============================================================================

alter table public.assignment_status_history
  add column if not exists changed_at timestamptz not null default now();

alter table public.jobs
  add column if not exists completed_at timestamptz,
  add column if not exists completion_notes text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;

create table if not exists public.job_status_history (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by_admin_portal_user uuid references public.admin_portal_users(id) on delete set null,
  changed_by_provider_user uuid references public.provider_portal_users(id) on delete set null,
  note text,
  changed_at timestamptz not null default now()
);

create index if not exists job_status_history_job_idx
  on public.job_status_history(job_id, changed_at desc);

alter table public.job_status_history enable row level security;
revoke all on public.job_status_history from anon, authenticated;
grant all on public.job_status_history to service_role;

-- Backfill a baseline history event for existing jobs without history.
insert into public.job_status_history(job_id,old_status,new_status,note,changed_at)
select j.id,null,j.status,'STEP 7 baseline',coalesce(j.created_at,now())
from public.jobs j
where not exists (select 1 from public.job_status_history h where h.job_id=j.id);

-- Controlled admin actions for final job lifecycle stages.
create or replace function public.please_portal_manage_job(
  p_actor uuid,
  p_job_id uuid,
  p_action text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_action text := upper(trim(coalesce(p_action,'')));
  v_old_status text;
  v_assignment record;
begin
  perform public.require_please_portal_admin(p_actor);

  select status into v_old_status from public.jobs where id=p_job_id for update;
  if not found then raise exception 'Job not found'; end if;

  if v_action='COMPLETE' then
    if v_old_status not in ('CONFIRMED','SCHEDULED','IN_PROGRESS') then
      raise exception 'Only confirmed or active jobs can be completed';
    end if;

    update public.jobs
       set status='COMPLETED',completed_at=now(),completion_notes=nullif(trim(p_note),''),updated_at=now()
     where id=p_job_id;

    for v_assignment in
      select id,status from public.job_assignments
       where job_id=p_job_id and status in ('PENDING','CONFIRMED')
       for update
    loop
      update public.job_assignments set status='COMPLETED',updated_at=now() where id=v_assignment.id;
      insert into public.assignment_status_history(assignment_id,old_status,new_status,changed_by_admin_portal_user,note)
      values(v_assignment.id,v_assignment.status,'COMPLETED',p_actor,nullif(trim(p_note),''));
    end loop;

    insert into public.job_status_history(job_id,old_status,new_status,changed_by_admin_portal_user,note)
    values(p_job_id,v_old_status,'COMPLETED',p_actor,nullif(trim(p_note),''));
    return jsonb_build_object('ok',true,'job_id',p_job_id,'status','COMPLETED');

  elsif v_action='CANCEL' then
    if v_old_status in ('COMPLETED','CANCELLED') then
      raise exception 'Job cannot be cancelled from its current status';
    end if;

    for v_assignment in
      select id,status from public.job_assignments
       where job_id=p_job_id and status in ('PENDING','CONFIRMED')
       for update
    loop
      update public.job_assignments set status='CANCELLED',updated_at=now() where id=v_assignment.id;
      insert into public.assignment_status_history(assignment_id,old_status,new_status,changed_by_admin_portal_user,note)
      values(v_assignment.id,v_assignment.status,'CANCELLED',p_actor,nullif(trim(p_note),''));
    end loop;

    update public.jobs
       set status='CANCELLED',cancelled_at=now(),cancellation_reason=nullif(trim(p_note),''),updated_at=now()
     where id=p_job_id;

    insert into public.job_status_history(job_id,old_status,new_status,changed_by_admin_portal_user,note)
    values(p_job_id,v_old_status,'CANCELLED',p_actor,nullif(trim(p_note),''));
    return jsonb_build_object('ok',true,'job_id',p_job_id,'status','CANCELLED');
  end if;

  raise exception 'Unsupported job management action';
end;
$$;

revoke all on function public.please_portal_manage_job(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.please_portal_manage_job(uuid,uuid,text,text) to service_role;

commit;
