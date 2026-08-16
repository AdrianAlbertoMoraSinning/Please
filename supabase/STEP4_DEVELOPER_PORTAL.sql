begin;

create extension if not exists pgcrypto;

-- Attribute provider provisioning work to the custom developer portal user.
alter table public.providers
  add column if not exists created_by_portal_user uuid references public.admin_portal_users(id) on delete set null,
  add column if not exists updated_by_portal_user uuid references public.admin_portal_users(id) on delete set null;

-- Provider portal credentials are custom (not Supabase Auth). Only a bcrypt
-- hash is stored. Browser roles receive no direct access to this table.
create table if not exists public.provider_portal_users (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null unique references public.providers(id) on delete cascade,
  email text not null,
  display_name text not null,
  password_hash text not null,
  active boolean not null default true,
  last_login_at timestamptz,
  password_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists provider_portal_users_email_uidx
  on public.provider_portal_users(lower(email));
alter table public.provider_portal_users enable row level security;
revoke all on public.provider_portal_users from anon, authenticated;

-- Helper used only by server-side Netlify Functions through service_role.
create or replace function public.developer_portal_onboarding_action(
  p_actor uuid,
  p_application_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_action text := upper(trim(coalesce(p_action,'')));
  v_status text;
  v_provider_id uuid;
  v_provider_reference text;
  v_slug text;
  v_app public.provider_applications%rowtype;
  v_service uuid;
  v_item jsonb;
  v_email text;
  v_password text;
  v_publish boolean := false;
begin
  if not exists (
    select 1 from public.admin_portal_users
    where id=p_actor and active=true and role='DEVELOPER_ADMIN'
  ) then raise exception 'Unauthorized'; end if;

  perform set_config('app.portal_user_id', p_actor::text, true);

  select * into v_app from public.provider_applications
   where id=p_application_id for update;
  if not found then raise exception 'Application not found'; end if;
  v_status := v_app.status;

  select id into v_provider_id from public.providers
   where source_application_id=p_application_id limit 1;

  if v_action = 'START_ONBOARDING' then
    if v_status <> 'REFERRED_TO_DEVELOPER' then
      raise exception 'Application must be REFERRED_TO_DEVELOPER';
    end if;
    update public.provider_applications
       set status='ONBOARDING', onboarding_started_at=coalesce(onboarding_started_at,now()), updated_at=now()
     where id=p_application_id;
    return jsonb_build_object('ok',true,'status','ONBOARDING');

  elsif v_action = 'SAVE_ONBOARDING' then
    if v_status not in ('ONBOARDING','APPROVED') then
      raise exception 'Application must be ONBOARDING or APPROVED';
    end if;

    if v_provider_id is null then
      v_provider_id := gen_random_uuid();
      v_provider_reference := 'PLS-PRV-' || to_char(current_date,'YYYYMMDD') || '-' || upper(substr(replace(v_provider_id::text,'-',''),1,6));
      v_slug := lower(regexp_replace(coalesce(nullif(trim(p_payload->>'slug'),''), v_app.full_name || '-' || substr(replace(v_provider_id::text,'-',''),1,6)), '[^a-zA-Z0-9]+','-','g'));
      v_slug := trim(both '-' from v_slug);
      insert into public.providers(
        id,reference,display_name,company_name,slug,primary_email,primary_phone,public_title,
        short_bio,technical_description,service_area,licensed_certified,insured,status,public_visible,
        source_application_id,created_by_portal_user,updated_by_portal_user
      ) values (
        v_provider_id,v_provider_reference,
        coalesce(nullif(trim(p_payload->>'display_name'),''),v_app.full_name),
        coalesce(nullif(trim(p_payload->>'company_name'),''),v_app.company_name),
        v_slug,
        coalesce(nullif(trim(p_payload->>'primary_email'),''),v_app.email),
        coalesce(nullif(trim(p_payload->>'primary_phone'),''),v_app.phone),
        coalesce(nullif(trim(p_payload->>'public_title'),''),v_app.service_trade),
        coalesce(nullif(trim(p_payload->>'short_bio'),''),v_app.experience_details),
        nullif(trim(p_payload->>'technical_description'),''),
        coalesce(nullif(trim(p_payload->>'service_area'),''),v_app.service_area),
        coalesce((p_payload->>'licensed_certified')::boolean,v_app.licensed_certified),
        coalesce((p_payload->>'insured')::boolean,v_app.insured),
        'ONBOARDING',false,p_application_id,p_actor,p_actor
      );
    else
      update public.providers set
        display_name=coalesce(nullif(trim(p_payload->>'display_name'),''),display_name),
        company_name=nullif(trim(p_payload->>'company_name'),''),
        primary_email=coalesce(nullif(trim(p_payload->>'primary_email'),''),primary_email),
        primary_phone=coalesce(nullif(trim(p_payload->>'primary_phone'),''),primary_phone),
        public_title=coalesce(nullif(trim(p_payload->>'public_title'),''),public_title),
        short_bio=nullif(trim(p_payload->>'short_bio'),''),
        technical_description=nullif(trim(p_payload->>'technical_description'),''),
        service_area=nullif(trim(p_payload->>'service_area'),''),
        licensed_certified=coalesce((p_payload->>'licensed_certified')::boolean,licensed_certified),
        insured=coalesce((p_payload->>'insured')::boolean,insured),
        updated_by_portal_user=p_actor,updated_at=now()
      where id=v_provider_id;
    end if;

    -- Services are replaced only when the payload contains service_ids.
    if p_payload ? 'service_ids' then
      delete from public.provider_services where provider_id=v_provider_id;
      for v_item in select value from jsonb_array_elements(coalesce(p_payload->'service_ids','[]'::jsonb)) loop
        begin v_service := trim(both '"' from v_item::text)::uuid;
        exception when others then raise exception 'Invalid service id'; end;
        if not exists(select 1 from public.services where id=v_service and active=true) then
          raise exception 'Service does not exist or is inactive';
        end if;
        insert into public.provider_services(provider_id,service_id,active)
        values(v_provider_id,v_service,true) on conflict(provider_id,service_id) do update set active=true;
      end loop;
    elsif not exists(select 1 from public.provider_services where provider_id=v_provider_id) and v_app.service_id is not null then
      insert into public.provider_services(provider_id,service_id,active)
      values(v_provider_id,v_app.service_id,true) on conflict do nothing;
    end if;

    -- Weekly availability is replaced only when explicitly submitted.
    if p_payload ? 'availability' then
      delete from public.provider_availability where provider_id=v_provider_id;
      for v_item in select value from jsonb_array_elements(coalesce(p_payload->'availability','[]'::jsonb)) loop
        if coalesce((v_item->>'active')::boolean,true) then
          insert into public.provider_availability(provider_id,weekday,start_time,end_time,active)
          values(v_provider_id,(v_item->>'weekday')::smallint,(v_item->>'start_time')::time,(v_item->>'end_time')::time,true);
        end if;
      end loop;
    end if;

    -- Optional initial/reset provider credential. Plaintext exists only for
    -- this RPC invocation and is immediately hashed with bcrypt.
    if p_payload ? 'credential' and jsonb_typeof(p_payload->'credential')='object' then
      v_email := lower(trim(coalesce(p_payload#>>'{credential,email}','')));
      v_password := coalesce(p_payload#>>'{credential,password}','');
      if v_email <> '' or v_password <> '' then
        if v_email='' then raise exception 'Provider login email is required'; end if;
        if length(v_password)<10 then raise exception 'Provider password must be at least 10 characters'; end if;
        insert into public.provider_portal_users(provider_id,email,display_name,password_hash,active)
        values(v_provider_id,v_email,
          coalesce(nullif(trim(p_payload#>>'{credential,display_name}'),''),coalesce(nullif(trim(p_payload->>'display_name'),''),v_app.full_name)),
          crypt(v_password,gen_salt('bf',12)),true)
        on conflict(provider_id) do update set
          email=excluded.email,display_name=excluded.display_name,password_hash=excluded.password_hash,
          active=true,password_changed_at=now(),updated_at=now();
      end if;
    end if;

    return jsonb_build_object('ok',true,'provider_id',v_provider_id);

  elsif v_action = 'APPROVE' then
    if v_status <> 'ONBOARDING' then raise exception 'Application must be ONBOARDING before approval'; end if;
    if v_provider_id is null then raise exception 'Create and save the provider profile first'; end if;
    if not exists(select 1 from public.provider_services where provider_id=v_provider_id and active=true) then raise exception 'At least one provider service is required'; end if;
    if not exists(select 1 from public.provider_availability where provider_id=v_provider_id and active=true) then raise exception 'At least one availability window is required'; end if;
    if not exists(select 1 from public.provider_portal_users where provider_id=v_provider_id and active=true) then raise exception 'Provider portal credentials are required'; end if;
    update public.provider_applications set status='APPROVED',approved_at=now(),updated_at=now() where id=p_application_id;
    return jsonb_build_object('ok',true,'status','APPROVED','provider_id',v_provider_id);

  elsif v_action = 'ACTIVATE' then
    if v_status <> 'APPROVED' then raise exception 'Application must be APPROVED before activation'; end if;
    if v_provider_id is null then raise exception 'Provider profile does not exist'; end if;
    v_publish := coalesce((p_payload->>'public_visible')::boolean,false);
    update public.providers set status='ACTIVE',public_visible=v_publish,activated_at=now(),updated_by_portal_user=p_actor,updated_at=now() where id=v_provider_id;
    update public.provider_applications set status='ACTIVATED',activated_provider_id=v_provider_id,updated_at=now() where id=p_application_id;
    return jsonb_build_object('ok',true,'status','ACTIVATED','provider_id',v_provider_id,'public_visible',v_publish);

  else
    raise exception 'Unsupported developer action';
  end if;
end;
$$;

revoke all on function public.developer_portal_onboarding_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.developer_portal_onboarding_action(uuid,uuid,text,jsonb) to service_role;

commit;
