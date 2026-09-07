-- PLEASE / CAL — STEP 18.1: Financial Master Data
-- Safe additive migration. Run AFTER STEP17_NATIVE_ACCOUNTING_ENGINE.sql.
-- Scope: business partners, roles, financial accounts, chart/tax master hardening.
-- This migration does NOT create purchases, vendor bills, refunds, payroll, inventory,
-- bank reconciliation or new accounting posting events.

begin;

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Chart of accounts master hardening (additive only)
-- -----------------------------------------------------------------------------
alter table public.accounting_accounts add column if not exists account_subtype text;
alter table public.accounting_accounts add column if not exists system_managed boolean not null default false;
alter table public.accounting_accounts add column if not exists allow_manual_posting boolean not null default true;
alter table public.accounting_accounts add column if not exists updated_at timestamptz not null default now();

update public.accounting_accounts
set system_managed=true,
    updated_at=coalesce(updated_at,now())
where code in ('1000','1090','1100','1200','1300','2000','2010','2100','3000','4000','5000','5400','5700');

-- Tax codes remain effective-dated reference records. Existing seeded Canadian codes
-- are marked as system-managed so they are not silently rewritten in the UI.
alter table public.accounting_tax_codes add column if not exists system_managed boolean not null default false;
alter table public.accounting_tax_codes add column if not exists updated_at timestamptz not null default now();

update public.accounting_tax_codes
set system_managed=true,
    updated_at=coalesce(updated_at,now())
where code in ('AB-GST','ON-HST','NS-HST','NB-HST','NL-HST','PE-HST','QC-GST','QC-QST');

-- -----------------------------------------------------------------------------
-- Business Partner Master
-- Operational Customers / Providers remain owned by PLEASE. CAL stores a linked
-- financial identity and role set without replacing or editing operational records.
-- -----------------------------------------------------------------------------
create sequence if not exists public.accounting_party_number_seq start with 1001;

create table if not exists public.accounting_parties (
  id uuid primary key default gen_random_uuid(),
  party_number text not null unique default ('PTY-' || lpad(nextval('public.accounting_party_number_seq')::text,6,'0')),
  party_type text not null default 'ORGANIZATION' check(party_type in ('INDIVIDUAL','ORGANIZATION')),
  legal_name text not null,
  display_name text,
  email text,
  phone text,
  address jsonb not null default '{}'::jsonb,
  business_number text,
  tax_number text,
  default_currency text not null default 'CAD',
  payment_terms_days integer not null default 0 check(payment_terms_days between 0 and 365),
  notes text,
  active boolean not null default true,
  source_system text not null default 'CAL',
  source_table text,
  source_record_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_system,source_table,source_record_id)
);

create index if not exists accounting_parties_name_idx on public.accounting_parties(lower(legal_name));
create index if not exists accounting_parties_email_idx on public.accounting_parties(lower(email)) where email is not null;
create index if not exists accounting_parties_active_idx on public.accounting_parties(active,legal_name);

create table if not exists public.accounting_party_roles (
  party_id uuid not null references public.accounting_parties(id) on delete restrict,
  role text not null check(role in ('CUSTOMER','OPERATIONAL_PROVIDER','SUPPLIER','EMPLOYEE','CONTRACTOR','OTHER')),
  active boolean not null default true,
  effective_from date not null default current_date,
  effective_to date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(party_id,role),
  check(effective_to is null or effective_to >= effective_from)
);

create index if not exists accounting_party_roles_role_idx on public.accounting_party_roles(role,active);

-- Link the legacy CAL accounting_contacts table to the new Party Master without
-- changing any existing invoice/expense foreign keys.
alter table public.accounting_contacts add column if not exists party_id uuid references public.accounting_parties(id) on delete set null;
create index if not exists accounting_contacts_party_idx on public.accounting_contacts(party_id);

-- -----------------------------------------------------------------------------
-- Financial account master (bank/cash/card/clearing registry)
-- Balances remain ledger-derived; this table stores identity/configuration only.
-- -----------------------------------------------------------------------------
create table if not exists public.accounting_financial_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  financial_type text not null check(financial_type in ('BANK','CASH','CREDIT_CARD','CLEARING','LOAN','OTHER')),
  institution_name text,
  account_last4 text,
  currency text not null default 'CAD',
  gl_account_id uuid not null references public.accounting_accounts(id) on delete restrict,
  is_primary boolean not null default false,
  active boolean not null default true,
  source_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(gl_account_id),
  check(account_last4 is null or char_length(account_last4) <= 4)
);

create index if not exists accounting_financial_accounts_type_idx on public.accounting_financial_accounts(financial_type,active);

insert into public.accounting_financial_accounts(name,financial_type,institution_name,currency,gl_account_id,is_primary,active,source_reference)
select 'Operating Bank','BANK',null,'CAD',a.id,true,true,'SYSTEM:1000'
from public.accounting_accounts a
where a.code='1000'
on conflict(gl_account_id) do nothing;

insert into public.accounting_financial_accounts(name,financial_type,institution_name,currency,gl_account_id,is_primary,active,source_reference)
select 'Stripe Clearing','CLEARING','Stripe','CAD',a.id,false,true,'SYSTEM:1090'
from public.accounting_accounts a
where a.code='1090'
on conflict(gl_account_id) do nothing;

-- -----------------------------------------------------------------------------
-- Common updated_at and immutability protections
-- -----------------------------------------------------------------------------
create or replace function public.accounting_touch_updated_at()
returns trigger
language plpgsql
set search_path=public,extensions
as $$
begin
  new.updated_at=now();
  return new;
end;
$$;

drop trigger if exists trg_accounting_parties_touch on public.accounting_parties;
create trigger trg_accounting_parties_touch before update on public.accounting_parties
for each row execute function public.accounting_touch_updated_at();

drop trigger if exists trg_accounting_party_roles_touch on public.accounting_party_roles;
create trigger trg_accounting_party_roles_touch before update on public.accounting_party_roles
for each row execute function public.accounting_touch_updated_at();

drop trigger if exists trg_accounting_financial_accounts_touch on public.accounting_financial_accounts;
create trigger trg_accounting_financial_accounts_touch before update on public.accounting_financial_accounts
for each row execute function public.accounting_touch_updated_at();

drop trigger if exists trg_accounting_accounts_touch on public.accounting_accounts;
create trigger trg_accounting_accounts_touch before update on public.accounting_accounts
for each row execute function public.accounting_touch_updated_at();

drop trigger if exists trg_accounting_tax_codes_touch on public.accounting_tax_codes;
create trigger trg_accounting_tax_codes_touch before update on public.accounting_tax_codes
for each row execute function public.accounting_touch_updated_at();

create or replace function public.accounting_protect_party_delete()
returns trigger
language plpgsql
set search_path=public,extensions
as $$
begin
  raise exception 'Accounting parties are retained for audit history. Deactivate the party instead of deleting it.';
end;
$$;

drop trigger if exists trg_accounting_protect_party_delete on public.accounting_parties;
create trigger trg_accounting_protect_party_delete before delete on public.accounting_parties
for each row execute function public.accounting_protect_party_delete();

create or replace function public.accounting_protect_system_account()
returns trigger
language plpgsql
set search_path=public,extensions
as $$
begin
  if tg_op='DELETE' and old.system_managed then
    raise exception 'System-managed accounting account % cannot be deleted.',old.code;
  end if;
  if tg_op='UPDATE' and old.system_managed then
    if new.code is distinct from old.code or new.account_type is distinct from old.account_type or new.active=false then
      raise exception 'System-managed accounting account % code/type/status is protected.',old.code;
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_accounting_protect_system_account on public.accounting_accounts;
create trigger trg_accounting_protect_system_account before update or delete on public.accounting_accounts
for each row execute function public.accounting_protect_system_account();

-- -----------------------------------------------------------------------------
-- Source-to-party synchronization
-- All source trigger errors are caught so CAL master-data synchronization can NEVER
-- block a valid PLEASE customer/provider operational transaction.
-- -----------------------------------------------------------------------------
create or replace function public.accounting_upsert_source_party(
  p_source_table text,
  p_source_record_id text,
  p_data jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_party_id uuid;
  v_source_system text := case when p_source_table in ('customers','providers') then 'PLEASE' else 'CAL' end;
  v_party_type text := 'ORGANIZATION';
  v_legal_name text;
  v_display_name text;
  v_email text;
  v_phone text;
  v_status text;
  v_active boolean := true;
  v_address jsonb := '{}'::jsonb;
  v_role text;
  v_worker_type text;
begin
  if p_source_record_id is null or btrim(p_source_record_id)='' then return null; end if;

  if p_source_table='customers' then
    v_display_name=nullif(btrim(concat_ws(' ',p_data->>'first_name',p_data->>'last_name')),'');
    v_legal_name=coalesce(nullif(btrim(p_data->>'company_name'),''),v_display_name,nullif(btrim(p_data->>'email'),''),nullif(btrim(p_data->>'phone'),''),'PLEASE Customer');
    v_party_type=case when nullif(btrim(p_data->>'company_name'),'') is not null then 'ORGANIZATION' else 'INDIVIDUAL' end;
    v_email=nullif(btrim(p_data->>'email'),'');
    v_phone=nullif(btrim(p_data->>'phone'),'');
    v_status=upper(coalesce(p_data->>'record_status',p_data->>'status','ACTIVE'));
    v_address=jsonb_strip_nulls(jsonb_build_object(
      'line1',nullif(btrim(p_data->>'address_line1'),''),
      'line2',nullif(btrim(p_data->>'address_line2'),''),
      'city',nullif(btrim(p_data->>'city'),''),
      'province',nullif(btrim(p_data->>'province'),''),
      'postal_code',nullif(btrim(p_data->>'postal_code'),'')
    ));
  elsif p_source_table='providers' then
    v_display_name=coalesce(nullif(btrim(p_data->>'display_name'),''),nullif(btrim(p_data->>'company_name'),''));
    v_legal_name=coalesce(nullif(btrim(p_data->>'company_name'),''),v_display_name,nullif(btrim(p_data->>'primary_email'),''),'PLEASE Provider');
    v_party_type=case when nullif(btrim(p_data->>'company_name'),'') is not null then 'ORGANIZATION' else 'INDIVIDUAL' end;
    v_email=nullif(btrim(p_data->>'primary_email'),'');
    v_phone=nullif(btrim(p_data->>'primary_phone'),'');
    v_status=upper(coalesce(p_data->>'status','ACTIVE'));
    v_address=jsonb_strip_nulls(jsonb_build_object('service_area',nullif(btrim(p_data->>'service_area'),'')));
    v_worker_type=upper(coalesce(p_data->>'worker_type','INDEPENDENT_PROVIDER'));
  elsif p_source_table='accounting_contacts' then
    v_display_name=nullif(btrim(p_data->>'legal_name'),'');
    v_legal_name=coalesce(v_display_name,'CAL Contact');
    v_party_type='ORGANIZATION';
    v_email=nullif(btrim(p_data->>'email'),'');
    v_phone=nullif(btrim(p_data->>'phone'),'');
    v_status=case when coalesce((p_data->>'active')::boolean,true) then 'ACTIVE' else 'INACTIVE' end;
    v_address=coalesce(p_data->'address','{}'::jsonb);
  else
    return null;
  end if;

  v_active := v_status not in ('INACTIVE','ARCHIVED','DELETED','DISABLED','REJECTED');

  insert into public.accounting_parties(
    party_type,legal_name,display_name,email,phone,address,business_number,tax_number,
    default_currency,payment_terms_days,active,source_system,source_table,source_record_id
  ) values (
    v_party_type,v_legal_name,v_display_name,v_email,v_phone,v_address,
    nullif(btrim(p_data->>'business_number'),''),nullif(btrim(coalesce(p_data->>'tax_number',p_data->>'gst_number')),''),
    coalesce(nullif(btrim(p_data->>'currency'),''),'CAD'),0,v_active,v_source_system,p_source_table,p_source_record_id
  )
  on conflict(source_system,source_table,source_record_id) do update set
    party_type=excluded.party_type,
    legal_name=excluded.legal_name,
    display_name=excluded.display_name,
    email=excluded.email,
    phone=excluded.phone,
    address=excluded.address,
    business_number=coalesce(excluded.business_number,public.accounting_parties.business_number),
    tax_number=coalesce(excluded.tax_number,public.accounting_parties.tax_number),
    active=excluded.active,
    updated_at=now()
  returning id into v_party_id;

  if p_source_table='customers' then
    insert into public.accounting_party_roles(party_id,role,active,metadata)
    values(v_party_id,'CUSTOMER',true,jsonb_build_object('source','PLEASE customers'))
    on conflict(party_id,role) do update set active=true,effective_to=null,metadata=excluded.metadata,updated_at=now();
  elsif p_source_table='providers' then
    insert into public.accounting_party_roles(party_id,role,active,metadata)
    values(v_party_id,'OPERATIONAL_PROVIDER',true,jsonb_build_object('source','PLEASE providers'))
    on conflict(party_id,role) do update set active=true,effective_to=null,metadata=excluded.metadata,updated_at=now();

    v_role := case when v_worker_type='PLEASE_STAFF' then 'EMPLOYEE' else 'CONTRACTOR' end;
    insert into public.accounting_party_roles(party_id,role,active,metadata)
    values(v_party_id,v_role,true,jsonb_build_object('worker_type',v_worker_type))
    on conflict(party_id,role) do update set active=true,effective_to=null,metadata=excluded.metadata,updated_at=now();

    update public.accounting_party_roles
    set active=false,effective_to=current_date,updated_at=now()
    where party_id=v_party_id
      and role in ('EMPLOYEE','CONTRACTOR')
      and role<>v_role
      and active=true;
  elsif p_source_table='accounting_contacts' then
    if upper(coalesce(p_data->>'contact_type','')) in ('CUSTOMER','BOTH') then
      insert into public.accounting_party_roles(party_id,role,active,metadata)
      values(v_party_id,'CUSTOMER',true,jsonb_build_object('source','accounting_contacts'))
      on conflict(party_id,role) do update set active=true,effective_to=null,metadata=excluded.metadata,updated_at=now();
    end if;
    if upper(coalesce(p_data->>'contact_type','')) in ('VENDOR','BOTH') then
      insert into public.accounting_party_roles(party_id,role,active,metadata)
      values(v_party_id,'SUPPLIER',true,jsonb_build_object('source','accounting_contacts'))
      on conflict(party_id,role) do update set active=true,effective_to=null,metadata=excluded.metadata,updated_at=now();
    end if;
    update public.accounting_contacts set party_id=v_party_id where id::text=p_source_record_id and party_id is distinct from v_party_id;
  end if;

  return v_party_id;
end;
$$;

create or replace function public.accounting_source_party_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,extensions
as $$
begin
  begin
    perform public.accounting_upsert_source_party(tg_table_name,new.id::text,to_jsonb(new));
  exception when others then
    raise warning 'STEP 18.1 party sync skipped for %.%: %',tg_table_name,new.id,sqlerrm;
  end;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.customers') is not null then
    execute 'drop trigger if exists trg_step18_1_customer_party_sync on public.customers';
    execute 'create trigger trg_step18_1_customer_party_sync after insert or update on public.customers for each row execute function public.accounting_source_party_trigger()';
  end if;
  if to_regclass('public.providers') is not null then
    execute 'drop trigger if exists trg_step18_1_provider_party_sync on public.providers';
    execute 'create trigger trg_step18_1_provider_party_sync after insert or update on public.providers for each row execute function public.accounting_source_party_trigger()';
  end if;
end $$;

drop trigger if exists trg_step18_1_contact_party_sync on public.accounting_contacts;
create trigger trg_step18_1_contact_party_sync after insert or update of contact_type,legal_name,email,phone,address,tax_number,active
on public.accounting_contacts for each row execute function public.accounting_source_party_trigger();

-- Backfill existing operational Customers / Providers and CAL contacts.
do $$
declare r record;
begin
  if to_regclass('public.customers') is not null then
    for r in execute 'select id::text as id,to_jsonb(t) as payload from public.customers t' loop
      begin perform public.accounting_upsert_source_party('customers',r.id,r.payload); exception when others then raise warning 'Customer party backfill skipped %: %',r.id,sqlerrm; end;
    end loop;
  end if;
  if to_regclass('public.providers') is not null then
    for r in execute 'select id::text as id,to_jsonb(t) as payload from public.providers t' loop
      begin perform public.accounting_upsert_source_party('providers',r.id,r.payload); exception when others then raise warning 'Provider party backfill skipped %: %',r.id,sqlerrm; end;
    end loop;
  end if;
  for r in select id::text as id,to_jsonb(c) as payload from public.accounting_contacts c loop
    begin perform public.accounting_upsert_source_party('accounting_contacts',r.id,r.payload); exception when others then raise warning 'Contact party backfill skipped %: %',r.id,sqlerrm; end;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Database audit fallback. API actions also write actor-aware audit events.
-- -----------------------------------------------------------------------------
create or replace function public.accounting_master_data_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_id text;
  v_before jsonb;
  v_after jsonb;
  v_row jsonb;
begin
  if tg_op='DELETE' then
    v_before=to_jsonb(old);
    v_after=null;
    v_row=v_before;
  elsif tg_op='INSERT' then
    v_before=null;
    v_after=to_jsonb(new);
    v_row=v_after;
  else
    v_before=to_jsonb(old);
    v_after=to_jsonb(new);
    v_row=v_after;
  end if;
  v_id=coalesce(v_row->>'id',v_row->>'party_id','');
  insert into public.accounting_audit_log(event_type,object_type,object_id,before_data,after_data,metadata)
  values(
    'MASTER_DATA_'||tg_op,
    tg_table_name,
    nullif(v_id,''),
    v_before,
    v_after,
    jsonb_build_object('step','18.1','source','DATABASE_TRIGGER')
  );
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['accounting_parties','accounting_party_roles','accounting_financial_accounts','accounting_accounts','accounting_tax_codes'] loop
    execute format('drop trigger if exists %I on public.%I','trg_'||t||'_master_audit',t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.accounting_master_data_audit_trigger()','trg_'||t||'_master_audit',t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Security: browser roles cannot write/read financial master records directly.
-- Server-side CAL functions use the service role and Admin session controls.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['accounting_parties','accounting_party_roles','accounting_financial_accounts'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
  end loop;
end $$;

revoke all on sequence public.accounting_party_number_seq from anon, authenticated;
revoke execute on function public.accounting_upsert_source_party(text,text,jsonb) from public, anon, authenticated;

comment on table public.accounting_parties is 'STEP 18.1 financial Business Partner Master. Operational PLEASE customer/provider identities remain source-managed and are linked, not replaced.';
comment on table public.accounting_party_roles is 'Role assignments allowing one party to be Customer, Operational Provider, Supplier, Employee, Contractor or Other without duplicate identities.';
comment on table public.accounting_financial_accounts is 'Bank/cash/card/clearing identity registry mapped to GL accounts. Balances remain ledger-derived.';
comment on function public.accounting_source_party_trigger() is 'Best-effort source sync. All errors are caught so CAL master-data synchronization never blocks PLEASE operations.';

commit;
