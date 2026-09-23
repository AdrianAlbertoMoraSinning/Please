-- PLEASE — STEP 19.6: Extension Billing Integrity
-- Additive repair. Run after STEP14_LIVE_SERVICE_OPERATIONS and STEP19.
-- Keeps approved extension time, assignment schedule, customer billing and
-- Provider compensation tied to the same frozen extension request.

begin;

create or replace function public.admin_review_extension(
  p_actor uuid,p_request_id uuid,p_action text,p_note text default null,p_customer_approval_method text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  r public.job_extension_requests%rowtype;
  a public.job_assignments%rowtype;
  bi public.job_billing_items%rowtype;
  conflict_count int;
  new_item_id uuid;
  approval_method text:=nullif(trim(coalesce(p_customer_approval_method,'')),'');
begin
  if not exists(select 1 from public.admin_portal_users where id=p_actor and active=true) then raise exception 'Unauthorized'; end if;
  select * into r from public.job_extension_requests where id=p_request_id for update;
  if not found or r.status<>'PENDING' then raise exception 'Extension request is not pending'; end if;
  select * into a from public.job_assignments where id=r.assignment_id for update;
  if not found or a.job_id<>r.job_id or a.provider_id<>r.provider_id then raise exception 'Extension assignment is no longer valid'; end if;

  if upper(trim(p_action))='REJECT' then
    update public.job_extension_requests set status='REJECTED',admin_note=p_note,reviewed_at=now() where id=r.id;
    insert into public.job_service_events(job_id,assignment_id,provider_id,event_type,event_note)
      values(r.job_id,r.assignment_id,r.provider_id,'EXTENSION_REJECTED',p_note);
    return jsonb_build_object('ok',true,'status','REJECTED');
  end if;
  if upper(trim(p_action))<>'APPROVE' then raise exception 'Invalid action'; end if;
  if approval_method is null then raise exception 'Customer approval method is required before finalizing additional time'; end if;
  if r.extra_minutes<15 or r.extra_minutes>480 or r.extra_minutes%15<>0 then raise exception 'Extension minutes are invalid'; end if;
  if r.proposed_end is null or r.proposed_end<>a.scheduled_end+make_interval(mins=>r.extra_minutes) then
    raise exception 'Extension schedule changed. Ask the Provider to submit a fresh request';
  end if;

  select * into bi from public.job_billing_items where id=r.billing_item_id and job_id=r.job_id for update;
  if not found or lower(coalesce(bi.unit,''))<>'hour' then raise exception 'Extension hourly billing item is no longer valid'; end if;
  if abs(coalesce(r.customer_addition,0)-round(coalesce(bi.customer_unit_rate,bi.unit_rate,0)*(r.extra_minutes/60.0),2))>0.01
     or abs(coalesce(r.provider_addition,0)-round(coalesce(bi.provider_unit_rate,0)*(r.extra_minutes/60.0),2))>0.01 then
    raise exception 'Extension pricing changed. Ask the Provider to submit a fresh request';
  end if;

  select count(*) into conflict_count
  from public.job_assignments x
  where x.provider_id=r.provider_id and x.id<>r.assignment_id
    and x.status in ('PENDING','CONFIRMED')
    and tstzrange(x.scheduled_start,x.scheduled_end,'[)') && tstzrange(a.scheduled_start,r.proposed_end,'[)');
  if conflict_count>0 then raise exception 'Extension conflicts with another assignment'; end if;

  insert into public.job_billing_items(
    job_id,assignment_id,provider_id,provider_service_rate_id,service_id,service_name,description,
    quantity,unit,customer_unit_rate,customer_line_total,provider_unit_rate,provider_line_total,
    gross_profit,unit_rate,line_total,sort_order
  ) values(
    r.job_id,r.assignment_id,r.provider_id,bi.provider_service_rate_id,bi.service_id,bi.service_name,
    'Approved time extension',r.extra_minutes/60.0,'hour',bi.customer_unit_rate,r.customer_addition,
    bi.provider_unit_rate,r.provider_addition,r.customer_addition-r.provider_addition,
    bi.customer_unit_rate,r.customer_addition,coalesce(bi.sort_order,0)+1000
  ) returning id into new_item_id;

  update public.job_assignments set scheduled_end=r.proposed_end,updated_at=now() where id=a.id;
  update public.jobs set
    estimated_duration_minutes=coalesce(estimated_duration_minutes,0)+r.extra_minutes,
    approved_extension_minutes=coalesce(approved_extension_minutes,0)+r.extra_minutes,
    quoted_subtotal=coalesce(quoted_subtotal,0)+r.customer_addition,
    updated_at=now()
  where id=r.job_id;

  update public.job_extension_requests set
    status='APPROVED',admin_note=p_note,customer_approval_method=approval_method,reviewed_at=now()
  where id=r.id;
  insert into public.job_service_events(job_id,assignment_id,provider_id,event_type,event_note,customer_message)
    values(r.job_id,r.assignment_id,r.provider_id,'EXTENSION_APPROVED',r.extra_minutes||' minutes approved','Your service time has been extended with approval.');

  return jsonb_build_object(
    'ok',true,'status','APPROVED','extra_minutes',r.extra_minutes,'new_end',r.proposed_end,
    'customer_addition',r.customer_addition,'provider_addition',r.provider_addition,'billing_item_id',new_item_id
  );
end $$;

revoke all on function public.admin_review_extension(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_review_extension(uuid,uuid,text,text,text) to service_role;

commit;
