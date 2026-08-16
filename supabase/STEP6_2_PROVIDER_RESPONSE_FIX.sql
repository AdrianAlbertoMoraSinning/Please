-- PLEASE Portal STEP 6.2
-- Provider response safety + server-side character limit.

begin;

create or replace function public.provider_portal_assignment_action(
  p_actor uuid,
  p_assignment_id uuid,
  p_action text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider_id uuid;
  v_job_id uuid;
  v_status text;
  v_action text := upper(trim(coalesce(p_action,'')));
  v_note text := nullif(trim(coalesce(p_note,'')),'');
begin
  if char_length(coalesce(v_note,'')) > 500 then
    raise exception 'Provider response must be 500 characters or fewer';
  end if;

  select u.provider_id into v_provider_id
    from public.provider_portal_users u
    join public.providers p on p.id=u.provider_id
   where u.id=p_actor and u.active=true and p.status='ACTIVE';
  if v_provider_id is null then raise exception 'Unauthorized'; end if;

  select job_id,status into v_job_id,v_status
    from public.job_assignments
   where id=p_assignment_id and provider_id=v_provider_id
   for update;
  if not found then raise exception 'Assignment not found'; end if;
  if v_status<>'PENDING' then raise exception 'Only pending assignments can be answered'; end if;

  if v_action='CONFIRM' then
    update public.job_assignments
       set status='CONFIRMED',provider_response_note=v_note,responded_at=now(),updated_at=now()
     where id=p_assignment_id;
    update public.jobs set status='CONFIRMED',updated_at=now() where id=v_job_id and status='PENDING_PROVIDER';
    insert into public.assignment_status_history(assignment_id,old_status,new_status,changed_by_provider_user,note)
    values(p_assignment_id,'PENDING','CONFIRMED',p_actor,v_note);
    return jsonb_build_object('ok',true,'status','CONFIRMED');

  elsif v_action='DECLINE' then
    update public.job_assignments
       set status='DECLINED',provider_response_note=v_note,responded_at=now(),updated_at=now()
     where id=p_assignment_id;
    update public.jobs set status='NEEDS_ASSIGNMENT',updated_at=now() where id=v_job_id and status='PENDING_PROVIDER';
    insert into public.assignment_status_history(assignment_id,old_status,new_status,changed_by_provider_user,note)
    values(p_assignment_id,'PENDING','DECLINED',p_actor,v_note);
    return jsonb_build_object('ok',true,'status','DECLINED');
  end if;

  raise exception 'Unsupported assignment action';
end;
$$;

revoke all on function public.provider_portal_assignment_action(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.provider_portal_assignment_action(uuid,uuid,text,text) to service_role;

commit;
