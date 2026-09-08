-- STEP 18.9.1 — Period Boundary Guardrails
-- Additive hotfix on top of STEP 18.9.
-- Prevents accidental partial-period preparation and overlapping fiscal periods.
begin;

create extension if not exists pgcrypto;

do $$ begin
  if to_regclass('public.accounting_fiscal_periods') is null
     or to_regprocedure('public.accounting_prepare_period_close(date,date,text)') is null
     or to_regprocedure('public.accounting_refresh_period_close_checklist(uuid,text)') is null then
    raise exception 'STEP 18.9.1 prerequisites missing. Install STEP 18.9 first.';
  end if;
end $$;

alter table public.accounting_fiscal_periods add column if not exists boundary_type text;
alter table public.accounting_fiscal_periods add column if not exists boundary_override_reason text;
alter table public.accounting_fiscal_periods add column if not exists boundary_confirmed_by text;
alter table public.accounting_fiscal_periods add column if not exists boundary_confirmed_at timestamptz;

create or replace function public.accounting_is_calendar_month(p_period_start date,p_period_end date)
returns boolean language sql immutable set search_path=public as $$
  select p_period_start is not null
     and p_period_end is not null
     and p_period_start=date_trunc('month',p_period_start)::date
     and p_period_end=(date_trunc('month',p_period_start)+interval '1 month - 1 day')::date;
$$;

-- Backfill boundary classification for any period that may already exist.
update public.accounting_fiscal_periods
set boundary_type=case when public.accounting_is_calendar_month(period_start,period_end) then 'CALENDAR_MONTH' else 'CUSTOM' end,
    boundary_override_reason=case
      when public.accounting_is_calendar_month(period_start,period_end) then null
      else coalesce(boundary_override_reason,'Legacy/custom period boundary prepared before STEP 18.9.1')
    end,
    boundary_confirmed_at=case
      when public.accounting_is_calendar_month(period_start,period_end) then boundary_confirmed_at
      else coalesce(boundary_confirmed_at,now())
    end
where boundary_type is null
   or boundary_type not in ('CALENDAR_MONTH','CUSTOM')
   or (not public.accounting_is_calendar_month(period_start,period_end) and boundary_override_reason is null);

alter table public.accounting_fiscal_periods alter column boundary_type set default 'CALENDAR_MONTH';
alter table public.accounting_fiscal_periods alter column boundary_type set not null;

do $$ begin
  if not exists(
    select 1 from pg_constraint where conname='accounting_fiscal_periods_boundary_type_chk'
      and conrelid='public.accounting_fiscal_periods'::regclass
  ) then
    alter table public.accounting_fiscal_periods
      add constraint accounting_fiscal_periods_boundary_type_chk
      check(boundary_type in ('CALENDAR_MONTH','CUSTOM'));
  end if;
end $$;

-- Refuse to install the overlap trigger over already-conflicting history.
do $$ begin
  if exists(
    select 1
    from public.accounting_fiscal_periods a
    join public.accounting_fiscal_periods b on a.id<b.id
      and a.period_start<=b.period_end
      and a.period_end>=b.period_start
  ) then
    raise exception 'Existing fiscal periods overlap. Resolve the overlapping period records before installing STEP 18.9.1.';
  end if;
end $$;

create or replace function public.accounting_fiscal_period_overlap_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.period_start is null or new.period_end is null or new.period_end<new.period_start then
    raise exception 'A valid fiscal period start/end is required.';
  end if;
  if exists(
    select 1 from public.accounting_fiscal_periods p
    where p.id<>coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid)
      and p.period_start<=new.period_end
      and p.period_end>=new.period_start
  ) then
    raise exception 'Fiscal period % through % overlaps an existing fiscal period.',new.period_start,new.period_end;
  end if;
  return new;
end $$;

drop trigger if exists trg_accounting_fiscal_period_overlap_guard on public.accounting_fiscal_periods;
create trigger trg_accounting_fiscal_period_overlap_guard
before insert or update of period_start,period_end on public.accounting_fiscal_periods
for each row execute function public.accounting_fiscal_period_overlap_guard();

-- Guarded preparation path used by CAL after STEP 18.9.1.
create or replace function public.accounting_prepare_period_close_guarded(
  p_period_start date,
  p_period_end date,
  p_actor_id text default null,
  p_allow_custom boolean default false,
  p_boundary_reason text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_id uuid;
  v_calendar boolean;
  v_reason text:=nullif(trim(coalesce(p_boundary_reason,'')),'');
begin
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start then
    raise exception 'A valid period start/end is required.';
  end if;
  if p_period_end>current_date then
    raise exception 'A future period cannot be prepared for close.';
  end if;
  if p_period_end-p_period_start>370 then
    raise exception 'Period length exceeds 371 days.';
  end if;

  v_calendar:=public.accounting_is_calendar_month(p_period_start,p_period_end);
  if not v_calendar then
    if not coalesce(p_allow_custom,false) then
      raise exception 'Non-calendar-month periods require explicit custom-period confirmation.';
    end if;
    if length(coalesce(v_reason,''))<10 then
      raise exception 'Custom-period reason must be at least 10 characters.';
    end if;
  end if;

  select id into v_id
  from public.accounting_fiscal_periods
  where period_start=p_period_start and period_end=p_period_end
  limit 1;

  if v_id is null then
    if exists(
      select 1 from public.accounting_period_locks l
      where l.period_start<=p_period_end and l.period_end>=p_period_start
    ) then
      raise exception 'Fiscal period % through % overlaps an already locked accounting period.',p_period_start,p_period_end;
    end if;
    if exists(
      select 1 from public.accounting_fiscal_periods p
      where p.period_start<=p_period_end and p.period_end>=p_period_start
    ) then
      raise exception 'Fiscal period % through % overlaps an existing fiscal period.',p_period_start,p_period_end;
    end if;

    insert into public.accounting_fiscal_periods(
      period_start,period_end,status,close_state,last_prepared_at,last_prepared_by,
      boundary_type,boundary_override_reason,boundary_confirmed_by,boundary_confirmed_at
    ) values(
      p_period_start,p_period_end,'OPEN','IN_REVIEW',now(),p_actor_id,
      case when v_calendar then 'CALENDAR_MONTH' else 'CUSTOM' end,
      case when v_calendar then null else v_reason end,
      case when v_calendar then null else p_actor_id end,
      case when v_calendar then null else now() end
    ) returning id into v_id;
  elsif exists(select 1 from public.accounting_fiscal_periods where id=v_id and status='CLOSED') then
    return v_id;
  else
    update public.accounting_fiscal_periods
    set last_prepared_at=now(),last_prepared_by=p_actor_id,
        boundary_type=case when v_calendar then 'CALENDAR_MONTH' else 'CUSTOM' end,
        boundary_override_reason=case when v_calendar then null else v_reason end,
        boundary_confirmed_by=case when v_calendar then null else p_actor_id end,
        boundary_confirmed_at=case when v_calendar then null else now() end
    where id=v_id;
  end if;

  insert into public.accounting_period_close_actions(period_id,action_type,reason,actor_id,metadata)
  values(
    v_id,'PREPARE',case when v_calendar then null else v_reason end,p_actor_id,
    jsonb_build_object(
      'period_start',p_period_start,
      'period_end',p_period_end,
      'boundary_type',case when v_calendar then 'CALENDAR_MONTH' else 'CUSTOM' end,
      'custom_boundary_confirmed',not v_calendar
    )
  );

  perform public.accounting_refresh_period_close_checklist(v_id,p_actor_id);
  return v_id;
end $$;

-- Preserve the original three-argument RPC for compatibility, but make it safe:
-- direct/legacy callers may prepare only a complete calendar month.
create or replace function public.accounting_prepare_period_close(
  p_period_start date,p_period_end date,p_actor_id text default null
) returns uuid language plpgsql security definer set search_path=public as $$
begin
  return public.accounting_prepare_period_close_guarded(
    p_period_start,p_period_end,p_actor_id,false,null
  );
end $$;

revoke all on function public.accounting_is_calendar_month(date,date) from public,anon,authenticated;
revoke all on function public.accounting_prepare_period_close_guarded(date,date,text,boolean,text) from public,anon,authenticated;
revoke all on function public.accounting_prepare_period_close(date,date,text) from public,anon,authenticated;

grant execute on function public.accounting_is_calendar_month(date,date) to service_role;
grant execute on function public.accounting_prepare_period_close_guarded(date,date,text,boolean,text) to service_role;
grant execute on function public.accounting_prepare_period_close(date,date,text) to service_role;

commit;
