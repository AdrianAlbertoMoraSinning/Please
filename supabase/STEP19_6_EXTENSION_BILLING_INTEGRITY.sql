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
  existing_invoice_status text;
  existing_payment_status text;
  provider_payment_status text;
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

  -- Financial lock: an extension changes the frozen Job billing snapshot. Once the
  -- customer invoice has been issued/sent/paid (or a Provider payment exists), the
  -- correction must use the accounting adjustment path instead of mutating history.
  select i.status,i.payment_status into existing_invoice_status,existing_payment_status
  from public.invoices i where i.job_id=r.job_id and i.status<>'VOID'
  order by i.created_at desc limit 1;
  if found and existing_invoice_status<>'DRAFT' then
    raise exception 'Job billing is locked because the customer invoice has already been issued. Void/reissue or use the accounting adjustment workflow before approving additional time';
  end if;
  if found and existing_payment_status in ('PENDING','PAID') then
    raise exception 'Job billing is locked by customer payment processing. Resolve the invoice payment state before approving additional time';
  end if;
  select pp.status into provider_payment_status from public.provider_payments pp
  where pp.job_id=r.job_id order by pp.created_at desc limit 1;
  if found then
    raise exception 'Job billing is locked because a Provider payment record already exists. Resolve Provider Payments before approving additional time';
  end if;
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
    job_id,provider_service_rate_id,service_id,service_name,description,
    quantity,unit,customer_unit_rate,customer_line_total,provider_compensation_method,provider_compensation_value,
    provider_unit_rate,provider_line_total,gross_profit,unit_rate,line_total,sort_order
  ) values(
    r.job_id,bi.provider_service_rate_id,bi.service_id,bi.service_name,
    'Approved time extension',r.extra_minutes/60.0,'hour',bi.customer_unit_rate,r.customer_addition,
    bi.provider_compensation_method,bi.provider_compensation_value,bi.provider_unit_rate,r.provider_addition,
    r.customer_addition-r.provider_addition,bi.customer_unit_rate,r.customer_addition,coalesce(bi.sort_order,0)+1000
  ) returning id into new_item_id;

  -- Keep an exact pointer to the generated extension billing line. This makes any
  -- later audited correction deterministic even when a Job has several extensions.
  update public.job_extension_requests set billing_item_id=new_item_id where id=r.id;

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


-- STEP 19.6 audited correction for an already-approved extension.
-- Corrections are allowed only while customer/provider finance remains open.
create or replace function public.admin_correct_approved_extension(
  p_actor uuid,p_request_id uuid,p_corrected_minutes integer,p_note text
)
returns jsonb language plpgsql security definer set search_path=public as $
declare
  r public.job_extension_requests%rowtype;
  a public.job_assignments%rowtype;
  bi public.job_billing_items%rowtype;
  ext_item public.job_billing_items%rowtype;
  corrected_end timestamptz;
  old_minutes integer;
  delta_minutes integer;
  customer_total numeric(12,2);
  provider_total numeric(12,2);
  old_customer numeric(12,2);
  old_provider numeric(12,2);
  inv_status text;
  inv_payment text;
  pp_status text;
begin
  if not exists(select 1 from public.admin_portal_users where id=p_actor and active=true) then raise exception 'Unauthorized'; end if;
  if p_corrected_minutes is null or p_corrected_minutes<15 or p_corrected_minutes>480 or p_corrected_minutes%15<>0 then
    raise exception 'Corrected time must be entered in exact 15-minute increments';
  end if;
  if nullif(trim(coalesce(p_note,'')),'') is null then raise exception 'Correction reason is required'; end if;

  select * into r from public.job_extension_requests where id=p_request_id for update;
  if not found or r.status<>'APPROVED' then raise exception 'Only an approved extension can be corrected'; end if;
  select * into a from public.job_assignments where id=r.assignment_id for update;
  if not found then raise exception 'Assignment not found'; end if;

  select i.status,i.payment_status into inv_status,inv_payment from public.invoices i
  where i.job_id=r.job_id and i.status<>'VOID' order by i.created_at desc limit 1;
  if found and inv_status<>'DRAFT' then raise exception 'Issued customer invoices are locked. Void/reissue or use the accounting adjustment workflow'; end if;
  if found and inv_payment in ('PENDING','PAID') then raise exception 'Customer payment processing locks this correction'; end if;
  select pp.status into pp_status from public.provider_payments pp where pp.job_id=r.job_id order by pp.created_at desc limit 1;
  if found then raise exception 'Provider payment records lock this correction'; end if;

  old_minutes:=r.extra_minutes;
  if p_corrected_minutes=old_minutes then raise exception 'Corrected time is unchanged'; end if;
  corrected_end:=r.original_end+make_interval(mins=>p_corrected_minutes);
  delta_minutes:=p_corrected_minutes-old_minutes;

  -- STEP 19.6 approvals repoint billing_item_id to the exact generated extension line.
  -- Legacy approved requests may still point at the original hourly line, so retain
  -- a conservative fallback only when a single exact extension line can be found.
  select * into ext_item from public.job_billing_items where id=r.billing_item_id and job_id=r.job_id for update;
  if found and ext_item.description='Approved time extension' then
    bi:=ext_item;
  else
    select * into bi from public.job_billing_items where id=r.billing_item_id and job_id=r.job_id for update;
    if not found or lower(coalesce(bi.unit,''))<>'hour' then raise exception 'Original hourly billing item is unavailable'; end if;
    select * into ext_item from public.job_billing_items
    where job_id=r.job_id and description='Approved time extension'
      and abs(quantity-(old_minutes/60.0))<0.001
      and abs(coalesce(customer_line_total,line_total,0)-coalesce(r.customer_addition,0))<0.01
    order by created_at desc limit 1 for update;
    if not found then raise exception 'Approved extension billing line could not be identified safely'; end if;
  end if;

  customer_total:=round(coalesce(ext_item.customer_unit_rate,ext_item.unit_rate,0)*(p_corrected_minutes/60.0),2);
  provider_total:=round(coalesce(ext_item.provider_unit_rate,0)*(p_corrected_minutes/60.0),2);
  old_customer:=coalesce(r.customer_addition,0);
  old_provider:=coalesce(r.provider_addition,0);

  update public.job_billing_items set
    quantity=p_corrected_minutes/60.0,
    customer_unit_rate=ext_item.customer_unit_rate,
    provider_compensation_method=ext_item.provider_compensation_method,
    provider_compensation_value=ext_item.provider_compensation_value,
    provider_unit_rate=ext_item.provider_unit_rate,
    updated_at=now()
  where id=ext_item.id;

  update public.job_assignments set scheduled_end=corrected_end,updated_at=now() where id=a.id;
  update public.jobs set
    estimated_duration_minutes=greatest(0,coalesce(estimated_duration_minutes,0)+delta_minutes),
    approved_extension_minutes=greatest(0,coalesce(approved_extension_minutes,0)+delta_minutes),
    quoted_subtotal=greatest(0,coalesce(quoted_subtotal,0)+(customer_total-old_customer)),
    updated_at=now()
  where id=r.job_id;

  update public.job_extension_requests set
    extra_minutes=p_corrected_minutes,proposed_end=corrected_end,
    customer_addition=customer_total,provider_addition=provider_total,
    admin_note=concat_ws(E'\\n',nullif(admin_note,''),'CORRECTION: '||trim(p_note)),
    reviewed_at=now()
  where id=r.id;

  insert into public.job_service_events(job_id,assignment_id,provider_id,event_type,event_note)
  values(r.job_id,r.assignment_id,r.provider_id,'EXTENSION_APPROVED',
    'ADMIN CORRECTION — extension changed from '||old_minutes||' to '||p_corrected_minutes||' minutes. Reason: '||trim(p_note));

  return jsonb_build_object('ok',true,'status','CORRECTED','old_minutes',old_minutes,'corrected_minutes',p_corrected_minutes,
    'new_end',corrected_end,'customer_addition',customer_total,'provider_addition',provider_total,'billing_item_id',ext_item.id);
end $$;

revoke all on function public.admin_correct_approved_extension(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.admin_correct_approved_extension(uuid,uuid,integer,text) to service_role;

commit;
