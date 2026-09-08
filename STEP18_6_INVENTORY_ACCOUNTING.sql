-- PLEASE / CAL — STEP 18.6: Inventory Accounting
-- Safe additive migration. Run AFTER STEP18_5_TREASURY_BANK_RECONCILIATION.sql.
-- Scope: item/location master, perpetual moving-average subledger, supplier/expense receipts,
-- issues to COGS, transfers, controlled adjustments, physical counts and GL reconciliation.
-- Manufacturing/BOM/WIP remains intentionally disabled for a later step.

begin;

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.accounting_supplier_bills') is null or to_regclass('public.accounting_expense_claims') is null then
    raise exception 'STEP 18.2 Purchases/A/P and STEP 18.4 Advanced Expenses are required before STEP 18.6.';
  end if;
  if to_regclass('public.please_accounting_outbox') is null
     or to_regprocedure('public.accounting_enqueue_event(text,text,text,text,jsonb,timestamptz,integer,text,text,text)') is null then
    raise exception 'STEP 17 Native Accounting Engine is required before STEP 18.6.';
  end if;
end $$;

-- Inventory control accounts. Additive only; customized existing accounts are preserved.
insert into public.accounting_accounts(code,name,account_type,account_subtype,active,system_managed,allow_manual_posting)
values
 ('1600','Inventory','ASSET','INVENTORY',true,true,true),
 ('6000','Cost of Goods Sold','EXPENSE','COGS',true,true,true),
 ('6100','Inventory Adjustments','EXPENSE','INVENTORY_ADJUSTMENT',true,true,true)
on conflict(code) do nothing;

update public.accounting_accounts set system_managed=true,updated_at=now()
where code in ('1600','6000','6100');

create sequence if not exists public.accounting_inventory_item_number_seq start with 1001;
create sequence if not exists public.accounting_inventory_movement_number_seq start with 1001;
create sequence if not exists public.accounting_inventory_count_number_seq start with 1001;

create table if not exists public.accounting_inventory_items (
  id uuid primary key default gen_random_uuid(),
  item_number text not null unique default ('ITM-'||lpad(nextval('public.accounting_inventory_item_number_seq')::text,6,'0')),
  sku text not null unique,
  name text not null,
  description text,
  category text,
  unit_of_measure text not null default 'EA',
  valuation_method text not null default 'MOVING_AVERAGE' check(valuation_method in ('MOVING_AVERAGE')),
  inventory_account_id uuid not null references public.accounting_accounts(id) on delete restrict,
  cogs_account_id uuid not null references public.accounting_accounts(id) on delete restrict,
  adjustment_account_id uuid not null references public.accounting_accounts(id) on delete restrict,
  preferred_supplier_party_id uuid references public.accounting_parties(id) on delete restrict,
  reorder_point numeric(18,4) not null default 0 check(reorder_point>=0),
  manufacturing_enabled boolean not null default false check(manufacturing_enabled=false),
  active boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists accounting_inventory_items_active_idx on public.accounting_inventory_items(active,sku);

create table if not exists public.accounting_inventory_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  location_type text not null default 'WAREHOUSE' check(location_type in ('WAREHOUSE','VEHICLE','JOBSITE','OTHER')),
  address text,
  active boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists accounting_inventory_locations_active_idx on public.accounting_inventory_locations(active,code);

insert into public.accounting_inventory_locations(code,name,location_type,active)
values('MAIN','Main Inventory','WAREHOUSE',true)
on conflict(code) do nothing;

create table if not exists public.accounting_inventory_balances (
  item_id uuid not null references public.accounting_inventory_items(id) on delete restrict,
  location_id uuid not null references public.accounting_inventory_locations(id) on delete restrict,
  quantity_on_hand numeric(18,4) not null default 0,
  average_unit_cost numeric(18,6) not null default 0 check(average_unit_cost>=0),
  inventory_value numeric(18,2) not null default 0,
  last_movement_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(item_id,location_id),
  check(quantity_on_hand>=-0.0001),
  check(abs(inventory_value-round(quantity_on_hand*average_unit_cost,2))<=0.02)
);
create index if not exists accounting_inventory_balances_location_idx on public.accounting_inventory_balances(location_id,item_id);

create table if not exists public.accounting_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  movement_number text not null unique default ('IM-'||lpad(nextval('public.accounting_inventory_movement_number_seq')::text,7,'0')),
  movement_type text not null check(movement_type in ('PURCHASE_RECEIPT','DIRECT_EXPENSE_RECEIPT','OPENING','ISSUE','TRANSFER_OUT','TRANSFER_IN','ADJUSTMENT_GAIN','ADJUSTMENT_LOSS')),
  movement_date date not null default current_date,
  item_id uuid not null references public.accounting_inventory_items(id) on delete restrict,
  location_id uuid not null references public.accounting_inventory_locations(id) on delete restrict,
  transfer_group_id uuid,
  quantity_delta numeric(18,4) not null check(abs(quantity_delta)>0.0000001),
  unit_cost numeric(18,6) not null default 0 check(unit_cost>=0),
  value_delta numeric(18,2) not null,
  quantity_after numeric(18,4) not null,
  average_cost_after numeric(18,6) not null,
  value_after numeric(18,2) not null,
  reference text,
  reason text,
  project_reference text,
  source_table text,
  source_record_id text,
  source_line_id text,
  source_key text unique,
  financial_event_type text check(financial_event_type is null or financial_event_type in ('INVENTORY_OPENING_POSTED','INVENTORY_ISSUE_POSTED','INVENTORY_ADJUSTMENT_POSTED')),
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists accounting_inventory_movements_item_idx on public.accounting_inventory_movements(item_id,movement_date desc,created_at desc);
create index if not exists accounting_inventory_movements_location_idx on public.accounting_inventory_movements(location_id,movement_date desc,created_at desc);
create index if not exists accounting_inventory_movements_source_idx on public.accounting_inventory_movements(source_table,source_record_id,source_line_id);

create table if not exists public.accounting_inventory_counts (
  id uuid primary key default gen_random_uuid(),
  count_number text not null unique default ('IC-'||lpad(nextval('public.accounting_inventory_count_number_seq')::text,6,'0')),
  location_id uuid not null references public.accounting_inventory_locations(id) on delete restrict,
  count_date date not null default current_date,
  reference text,
  notes text,
  status text not null default 'DRAFT' check(status in ('DRAFT','POSTED','VOID')),
  created_by text,
  posted_by text,
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists accounting_inventory_counts_status_idx on public.accounting_inventory_counts(status,count_date desc);

create table if not exists public.accounting_inventory_count_lines (
  id uuid primary key default gen_random_uuid(),
  inventory_count_id uuid not null references public.accounting_inventory_counts(id) on delete restrict,
  item_id uuid not null references public.accounting_inventory_items(id) on delete restrict,
  system_quantity numeric(18,4) not null default 0,
  counted_quantity numeric(18,4),
  variance_quantity numeric(18,4),
  unit_cost numeric(18,6) not null default 0,
  variance_value numeric(18,2),
  updated_by text,
  updated_at timestamptz not null default now(),
  unique(inventory_count_id,item_id),
  check(counted_quantity is null or counted_quantity>=0)
);
create index if not exists accounting_inventory_count_lines_count_idx on public.accounting_inventory_count_lines(inventory_count_id,item_id);

-- Optional inventory linkage on purchase/expense lines. Existing lines remain valid.
alter table public.accounting_supplier_bill_lines add column if not exists inventory_item_id uuid references public.accounting_inventory_items(id) on delete restrict;
alter table public.accounting_supplier_bill_lines add column if not exists inventory_location_id uuid references public.accounting_inventory_locations(id) on delete restrict;
alter table public.accounting_expense_claim_lines add column if not exists inventory_item_id uuid references public.accounting_inventory_items(id) on delete restrict;
alter table public.accounting_expense_claim_lines add column if not exists inventory_location_id uuid references public.accounting_inventory_locations(id) on delete restrict;

-- Touch helpers.
drop trigger if exists trg_accounting_inventory_item_touch on public.accounting_inventory_items;
create trigger trg_accounting_inventory_item_touch before update on public.accounting_inventory_items
for each row execute function public.accounting_touch_updated_at();
drop trigger if exists trg_accounting_inventory_location_touch on public.accounting_inventory_locations;
create trigger trg_accounting_inventory_location_touch before update on public.accounting_inventory_locations
for each row execute function public.accounting_touch_updated_at();
drop trigger if exists trg_accounting_inventory_count_touch on public.accounting_inventory_counts;
create trigger trg_accounting_inventory_count_touch before update on public.accounting_inventory_counts
for each row execute function public.accounting_touch_updated_at();

-- Immutable movement history.
create or replace function public.accounting_protect_inventory_movement()
returns trigger language plpgsql set search_path=public,extensions as $$
begin
  if tg_op='UPDATE' or tg_op='DELETE' then
    raise exception 'Inventory movements are immutable. Use a new adjustment/reversal movement.';
  end if;
  return new;
end $$;
drop trigger if exists trg_accounting_protect_inventory_movement on public.accounting_inventory_movements;
create trigger trg_accounting_protect_inventory_movement before update or delete on public.accounting_inventory_movements
for each row execute function public.accounting_protect_inventory_movement();

-- Posted physical counts cannot be edited/deleted.
create or replace function public.accounting_protect_inventory_count()
returns trigger language plpgsql set search_path=public,extensions as $$
begin
  if tg_op='DELETE' then
    if old.status='POSTED' then raise exception 'Posted physical counts cannot be deleted.'; end if;
    return old;
  end if;
  if old.status='POSTED' and (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then
    raise exception 'Posted physical counts are immutable.';
  end if;
  return new;
end $$;
drop trigger if exists trg_accounting_protect_inventory_count on public.accounting_inventory_counts;
create trigger trg_accounting_protect_inventory_count before update or delete on public.accounting_inventory_counts
for each row execute function public.accounting_protect_inventory_count();

create or replace function public.accounting_protect_inventory_count_line()
returns trigger language plpgsql set search_path=public,extensions as $$
declare v_status text;
begin
  if tg_op='DELETE' then
    select status into v_status from public.accounting_inventory_counts where id=old.inventory_count_id;
    if v_status='POSTED' then raise exception 'Posted physical-count lines are immutable.'; end if;
    return old;
  end if;
  select status into v_status from public.accounting_inventory_counts where id=new.inventory_count_id;
  if v_status='POSTED' then raise exception 'Posted physical-count lines are immutable.'; end if;
  return new;
end $$;
drop trigger if exists trg_accounting_protect_inventory_count_line on public.accounting_inventory_count_lines;
create trigger trg_accounting_protect_inventory_count_line before insert or update or delete on public.accounting_inventory_count_lines
for each row execute function public.accounting_protect_inventory_count_line();

-- Item/location master RPCs.
create or replace function public.accounting_save_inventory_item(
  p_id uuid,p_sku text,p_name text,p_description text,p_category text,p_unit_of_measure text,
  p_preferred_supplier_party_id uuid,p_reorder_point numeric,p_active boolean,p_actor_id text
) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid:=p_id;v_inv uuid;v_cogs uuid;v_adj uuid;v_existing public.accounting_inventory_items%rowtype;
begin
  if nullif(trim(p_sku),'') is null or nullif(trim(p_name),'') is null then raise exception 'SKU and item name are required.'; end if;
  select id into v_inv from public.accounting_accounts where code='1600' and active=true;
  select id into v_cogs from public.accounting_accounts where code='6000' and active=true;
  select id into v_adj from public.accounting_accounts where code='6100' and active=true;
  if v_inv is null or v_cogs is null or v_adj is null then raise exception 'Inventory control accounts 1600/6000/6100 are required.'; end if;
  if p_preferred_supplier_party_id is not null and not exists(select 1 from public.accounting_party_roles where party_id=p_preferred_supplier_party_id and role='SUPPLIER' and active=true) then raise exception 'Preferred supplier must have an active SUPPLIER role.'; end if;
  if v_id is null then
    insert into public.accounting_inventory_items(sku,name,description,category,unit_of_measure,inventory_account_id,cogs_account_id,adjustment_account_id,preferred_supplier_party_id,reorder_point,active,created_by,updated_by)
    values(upper(trim(p_sku)),trim(p_name),nullif(trim(p_description),''),nullif(trim(p_category),''),upper(coalesce(nullif(trim(p_unit_of_measure),''),'EA')),v_inv,v_cogs,v_adj,p_preferred_supplier_party_id,greatest(coalesce(p_reorder_point,0),0),coalesce(p_active,true),p_actor_id,p_actor_id)
    returning id into v_id;
  else
    select * into v_existing from public.accounting_inventory_items where id=v_id for update;
    if not found then raise exception 'Inventory item not found.'; end if;
    if exists(select 1 from public.accounting_inventory_movements where item_id=v_id)
       and upper(coalesce(nullif(trim(p_unit_of_measure),''),'EA'))<>v_existing.unit_of_measure then
      raise exception 'Unit of measure cannot be changed after inventory movements exist.';
    end if;
    if coalesce(p_active,true)=false and exists(select 1 from public.accounting_inventory_balances where item_id=v_id and abs(quantity_on_hand)>0.0001) then
      raise exception 'Inventory item cannot be deactivated while on-hand quantity exists.';
    end if;
    update public.accounting_inventory_items set sku=upper(trim(p_sku)),name=trim(p_name),description=nullif(trim(p_description),''),category=nullif(trim(p_category),''),unit_of_measure=upper(coalesce(nullif(trim(p_unit_of_measure),''),'EA')),preferred_supplier_party_id=p_preferred_supplier_party_id,reorder_point=greatest(coalesce(p_reorder_point,0),0),active=coalesce(p_active,true),updated_by=p_actor_id where id=v_id;
  end if;
  return v_id;
end $$;

create or replace function public.accounting_save_inventory_location(
  p_id uuid,p_code text,p_name text,p_location_type text,p_address text,p_active boolean,p_actor_id text
) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid:=p_id;v_type text:=upper(coalesce(nullif(trim(p_location_type),''),'WAREHOUSE'));
begin
  if nullif(trim(p_code),'') is null or nullif(trim(p_name),'') is null then raise exception 'Location code and name are required.'; end if;
  if v_type not in ('WAREHOUSE','VEHICLE','JOBSITE','OTHER') then raise exception 'Invalid inventory location type.'; end if;
  if v_id is null then
    insert into public.accounting_inventory_locations(code,name,location_type,address,active,created_by,updated_by)
    values(upper(trim(p_code)),trim(p_name),v_type,nullif(trim(p_address),''),coalesce(p_active,true),p_actor_id,p_actor_id) returning id into v_id;
  else
    if not exists(select 1 from public.accounting_inventory_locations where id=v_id) then raise exception 'Inventory location not found.'; end if;
    if coalesce(p_active,true)=false and exists(select 1 from public.accounting_inventory_balances where location_id=v_id and abs(quantity_on_hand)>0.0001) then
      raise exception 'Inventory location cannot be deactivated while on-hand quantity exists.';
    end if;
    update public.accounting_inventory_locations set code=upper(trim(p_code)),name=trim(p_name),location_type=v_type,address=nullif(trim(p_address),''),active=coalesce(p_active,true),updated_by=p_actor_id where id=v_id;
  end if;
  return v_id;
end $$;

-- Core transaction-safe moving-average movement engine.
create or replace function public.accounting_inventory_apply_movement(
  p_item_id uuid,p_location_id uuid,p_movement_type text,p_movement_date date,p_quantity numeric,p_unit_cost numeric,
  p_reference text,p_reason text,p_project_reference text,p_source_table text,p_source_record_id text,p_source_line_id text,p_source_key text,p_actor_id text
) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare
  v_type text:=upper(trim(p_movement_type));v_item public.accounting_inventory_items%rowtype;v_loc public.accounting_inventory_locations%rowtype;
  v_bal public.accounting_inventory_balances%rowtype;v_qty numeric(18,4);v_cost numeric(18,6);v_delta_qty numeric(18,4);v_delta_value numeric(18,2);
  v_new_qty numeric(18,4);v_new_value numeric(18,2);v_new_avg numeric(18,6);v_id uuid;v_event text;v_row jsonb;
begin
  if v_type not in ('PURCHASE_RECEIPT','DIRECT_EXPENSE_RECEIPT','OPENING','ISSUE','TRANSFER_OUT','TRANSFER_IN','ADJUSTMENT_GAIN','ADJUSTMENT_LOSS') then raise exception 'Invalid inventory movement type %.',v_type; end if;
  select * into v_item from public.accounting_inventory_items where id=p_item_id and active=true;
  if not found then raise exception 'Inventory item is missing or inactive.'; end if;
  select * into v_loc from public.accounting_inventory_locations where id=p_location_id and active=true;
  if not found then raise exception 'Inventory location is missing or inactive.'; end if;
  v_qty:=round(coalesce(p_quantity,0),4);if v_qty<=0 then raise exception 'Inventory movement quantity must be positive.'; end if;
  if v_type in ('ADJUSTMENT_GAIN','ADJUSTMENT_LOSS') and nullif(trim(p_reason),'') is null then raise exception 'Inventory adjustments require a documented reason.'; end if;
  if p_source_key is not null then select id into v_id from public.accounting_inventory_movements where source_key=p_source_key; if v_id is not null then return v_id; end if; end if;
  if coalesce(p_source_table,'')<>'accounting_inventory_counts' and exists(select 1 from public.accounting_inventory_counts where location_id=p_location_id and status='DRAFT') then
    raise exception 'Inventory location has an open physical count. Post or void the count before recording movements.';
  end if;
  insert into public.accounting_inventory_balances(item_id,location_id) values(p_item_id,p_location_id) on conflict do nothing;
  select * into v_bal from public.accounting_inventory_balances where item_id=p_item_id and location_id=p_location_id for update;
  if v_type='OPENING' and exists(select 1 from public.accounting_inventory_movements where item_id=p_item_id and location_id=p_location_id) then raise exception 'Opening balance is allowed only before the first movement for this item/location.'; end if;
  if v_type in ('PURCHASE_RECEIPT','DIRECT_EXPENSE_RECEIPT','OPENING','TRANSFER_IN','ADJUSTMENT_GAIN') then
    v_cost:=round(coalesce(p_unit_cost,0),6);if v_cost<0 then raise exception 'Unit cost cannot be negative.'; end if;
    if v_type='TRANSFER_IN' and v_cost<=0 then raise exception 'Transfer-in cost is required.'; end if;
    v_delta_qty:=v_qty;v_delta_value:=round(v_qty*v_cost,2);v_new_qty:=round(v_bal.quantity_on_hand+v_delta_qty,4);v_new_value:=round(v_bal.inventory_value+v_delta_value,2);v_new_avg:=case when v_new_qty>0 then round(v_new_value/v_new_qty,6) else 0 end;
  else
    if v_bal.quantity_on_hand+0.0001<v_qty then raise exception 'Insufficient inventory. Available %, requested %.',v_bal.quantity_on_hand,v_qty; end if;
    v_cost:=v_bal.average_unit_cost;v_delta_qty:=-v_qty;v_delta_value:=-round(v_qty*v_cost,2);v_new_qty:=round(v_bal.quantity_on_hand-v_qty,4);v_new_value:=case when v_new_qty<=0.0001 then 0 else round(v_bal.inventory_value+v_delta_value,2) end;v_new_avg:=case when v_new_qty<=0.0001 then 0 else round(v_new_value/v_new_qty,6) end;
  end if;
  v_event:=case when v_type='OPENING' then 'INVENTORY_OPENING_POSTED' when v_type='ISSUE' then 'INVENTORY_ISSUE_POSTED' when v_type in ('ADJUSTMENT_GAIN','ADJUSTMENT_LOSS') then 'INVENTORY_ADJUSTMENT_POSTED' else null end;
  insert into public.accounting_inventory_movements(movement_type,movement_date,item_id,location_id,quantity_delta,unit_cost,value_delta,quantity_after,average_cost_after,value_after,reference,reason,project_reference,source_table,source_record_id,source_line_id,source_key,financial_event_type,created_by)
  values(v_type,coalesce(p_movement_date,current_date),p_item_id,p_location_id,v_delta_qty,v_cost,v_delta_value,v_new_qty,v_new_avg,v_new_value,nullif(trim(p_reference),''),nullif(trim(p_reason),''),nullif(trim(p_project_reference),''),nullif(trim(p_source_table),''),nullif(trim(p_source_record_id),''),nullif(trim(p_source_line_id),''),p_source_key,v_event,p_actor_id)
  returning id into v_id;
  update public.accounting_inventory_balances set quantity_on_hand=v_new_qty,average_unit_cost=v_new_avg,inventory_value=v_new_value,last_movement_at=now(),updated_at=now() where item_id=p_item_id and location_id=p_location_id;
  if v_event is not null then
    select to_jsonb(m) into v_row from public.accounting_inventory_movements m where m.id=v_id;
    perform public.accounting_enqueue_event(v_event,'accounting_inventory_movements',v_id::text,(v_row->>'movement_number'),jsonb_build_object('inventory_movement',v_row),coalesce((v_row->>'created_at')::timestamptz,now()),1,p_actor_id,p_item_id::text,null);
  end if;
  return v_id;
end $$;

create or replace function public.accounting_inventory_transfer(
  p_item_id uuid,p_from_location_id uuid,p_to_location_id uuid,p_transfer_date date,p_quantity numeric,p_reference text,p_reason text,p_request_key text,p_actor_id text
) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_group uuid:=gen_random_uuid();v_existing uuid;v_from public.accounting_inventory_balances%rowtype;v_out uuid;v_in uuid;v_cost numeric(18,6);v_key text:=coalesce(nullif(trim(p_request_key),''),v_group::text);
begin
  if p_from_location_id=p_to_location_id then raise exception 'Transfer locations must be different.'; end if;
  select nullif(source_record_id,'')::uuid into v_existing from public.accounting_inventory_movements where source_key='TRANSFER_OUT:'||v_key limit 1;
  if v_existing is not null then return v_existing; end if;
  insert into public.accounting_inventory_balances(item_id,location_id) values(p_item_id,p_from_location_id) on conflict do nothing;
  select * into v_from from public.accounting_inventory_balances where item_id=p_item_id and location_id=p_from_location_id for update;
  if not found or v_from.quantity_on_hand+0.0001<coalesce(p_quantity,0) then raise exception 'Insufficient inventory for transfer.'; end if;
  v_cost:=v_from.average_unit_cost;
  v_out:=public.accounting_inventory_apply_movement(p_item_id,p_from_location_id,'TRANSFER_OUT',p_transfer_date,p_quantity,null,p_reference,p_reason,null,'accounting_inventory_transfers',v_group::text,null,'TRANSFER_OUT:'||v_key,p_actor_id);
  v_in:=public.accounting_inventory_apply_movement(p_item_id,p_to_location_id,'TRANSFER_IN',p_transfer_date,p_quantity,v_cost,p_reference,p_reason,null,'accounting_inventory_transfers',v_group::text,null,'TRANSFER_IN:'||v_key,p_actor_id);
  -- source_record_id carries the immutable transfer-group id on both movement rows; request key makes retries idempotent.
  return v_group;
end $$;

-- Physical count workflow.
create or replace function public.accounting_create_inventory_count(p_location_id uuid,p_count_date date,p_reference text,p_notes text,p_actor_id text)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.accounting_inventory_locations where id=p_location_id and active=true) then raise exception 'Active inventory location is required.'; end if;
  if coalesce(p_count_date,current_date)>current_date then raise exception 'Physical count date cannot be in the future.'; end if;
  if exists(select 1 from public.accounting_inventory_movements where location_id=p_location_id and movement_date>coalesce(p_count_date,current_date)) then raise exception 'Historical physical count cannot be started after later-dated inventory movements exist.'; end if;
  if exists(select 1 from public.accounting_inventory_counts where location_id=p_location_id and status='DRAFT') then raise exception 'An open physical count already exists for this location.'; end if;
  insert into public.accounting_inventory_counts(location_id,count_date,reference,notes,created_by)
  values(p_location_id,coalesce(p_count_date,current_date),nullif(trim(p_reference),''),nullif(trim(p_notes),''),p_actor_id) returning id into v_id;
  insert into public.accounting_inventory_count_lines(inventory_count_id,item_id,system_quantity,counted_quantity,variance_quantity,unit_cost,variance_value)
  select v_id,i.id,coalesce(b.quantity_on_hand,0),null,null,coalesce(b.average_unit_cost,0),null
  from public.accounting_inventory_items i left join public.accounting_inventory_balances b on b.item_id=i.id and b.location_id=p_location_id where i.active=true;
  return v_id;
end $$;

create or replace function public.accounting_save_inventory_count_line(p_count_id uuid,p_item_id uuid,p_counted_quantity numeric,p_actor_id text)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v public.accounting_inventory_counts%rowtype;v_id uuid;v_system numeric(18,4);v_cost numeric(18,6);v_var numeric(18,4);
begin
  select * into v from public.accounting_inventory_counts where id=p_count_id for update;if not found then raise exception 'Physical count not found.'; end if;
  if v.status<>'DRAFT' then raise exception 'Only Draft physical counts can be edited.'; end if;
  if p_counted_quantity is null or p_counted_quantity<0 then raise exception 'Counted quantity must be zero or greater.'; end if;
  select coalesce(quantity_on_hand,0),coalesce(average_unit_cost,0) into v_system,v_cost from public.accounting_inventory_balances where item_id=p_item_id and location_id=v.location_id;
  if not found then v_system:=0;v_cost:=0;end if;
  v_var:=round(p_counted_quantity-v_system,4);
  insert into public.accounting_inventory_count_lines(inventory_count_id,item_id,system_quantity,counted_quantity,variance_quantity,unit_cost,variance_value,updated_by)
  values(p_count_id,p_item_id,v_system,round(p_counted_quantity,4),v_var,v_cost,round(v_var*v_cost,2),p_actor_id)
  on conflict(inventory_count_id,item_id) do update set system_quantity=excluded.system_quantity,counted_quantity=excluded.counted_quantity,variance_quantity=excluded.variance_quantity,unit_cost=excluded.unit_cost,variance_value=excluded.variance_value,updated_by=excluded.updated_by,updated_at=now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.accounting_post_inventory_count(p_count_id uuid,p_actor_id text)
returns text language plpgsql security definer set search_path=public,extensions as $$
declare v public.accounting_inventory_counts%rowtype;l record;v_current numeric(18,4);v_cost numeric(18,6);v_var numeric(18,4);v_movement uuid;
begin
  select * into v from public.accounting_inventory_counts where id=p_count_id for update;if not found then raise exception 'Physical count not found.'; end if;
  if v.status<>'DRAFT' then raise exception 'Only Draft physical counts can be posted.'; end if;
  if exists(select 1 from public.accounting_inventory_count_lines where inventory_count_id=v.id and counted_quantity is null) then raise exception 'Every active inventory item must have a counted quantity before posting.'; end if;
  for l in select * from public.accounting_inventory_count_lines where inventory_count_id=v.id order by item_id loop
    select coalesce(quantity_on_hand,0),coalesce(average_unit_cost,0) into v_current,v_cost from public.accounting_inventory_balances where item_id=l.item_id and location_id=v.location_id;
    if not found then v_current:=0;v_cost:=0;end if;
    v_var:=round(l.counted_quantity-v_current,4);
    if abs(v_var)>0.0001 then
      if v_var>0 then
        if v_cost<=0 then v_cost:=coalesce(l.unit_cost,0);end if;
        v_movement:=public.accounting_inventory_apply_movement(l.item_id,v.location_id,'ADJUSTMENT_GAIN',v.count_date,abs(v_var),v_cost,v.reference,'Physical count '||v.count_number,null,'accounting_inventory_counts',v.id::text,l.id::text,'COUNT:'||v.id::text||':'||l.item_id::text,p_actor_id);
      else
        v_movement:=public.accounting_inventory_apply_movement(l.item_id,v.location_id,'ADJUSTMENT_LOSS',v.count_date,abs(v_var),null,v.reference,'Physical count '||v.count_number,null,'accounting_inventory_counts',v.id::text,l.id::text,'COUNT:'||v.id::text||':'||l.item_id::text,p_actor_id);
      end if;
    end if;
    update public.accounting_inventory_count_lines set system_quantity=v_current,variance_quantity=v_var,unit_cost=v_cost,variance_value=round(v_var*v_cost,2),updated_by=p_actor_id,updated_at=now() where id=l.id;
  end loop;
  update public.accounting_inventory_counts set status='POSTED',posted_by=p_actor_id,posted_at=now() where id=v.id;
  return 'POSTED';
end $$;

-- Exact inventory GL and subledger control balances.
create or replace function public.accounting_inventory_gl_balance(p_as_of date default current_date)
returns numeric language sql security definer set search_path=public,extensions as $$
  select round(coalesce(sum(coalesce(jl.debit,0)-coalesce(jl.credit,0)),0),2)
  from public.accounting_journal_lines jl join public.accounting_journal_entries je on je.id=jl.journal_entry_id
  join public.accounting_accounts a on a.id=jl.account_id
  where je.status='POSTED' and a.code='1600' and je.entry_date<=coalesce(p_as_of,current_date)
$$;
create or replace function public.accounting_inventory_subledger_value()
returns numeric language sql security definer set search_path=public,extensions as $$
  select round(coalesce(sum(inventory_value),0),2) from public.accounting_inventory_balances
$$;

-- Extend Supplier Bill save with optional inventory item/location mapping.
create or replace function public.accounting_save_supplier_bill(
  p_id uuid,p_supplier_party_id uuid,p_supplier_invoice_number text,p_bill_date date,p_due_date date,p_currency text,p_notes text,p_source_reference text,p_lines jsonb,p_actor_id text
) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid:=p_id;v_status text;v_line jsonb;v_subtotal numeric(14,2):=0;v_tax numeric(14,2):=0;v_recoverable numeric(14,2):=0;v_total numeric(14,2):=0;v_count int:=0;v_account_type text;v_account_code text;v_tax_active boolean;v_item uuid;v_location uuid;
begin
  if not exists(select 1 from public.accounting_parties p join public.accounting_party_roles r on r.party_id=p.id where p.id=p_supplier_party_id and p.active=true and r.role='SUPPLIER' and r.active=true) then raise exception 'Supplier is inactive or does not have an active SUPPLIER role.'; end if;
  if p_due_date is not null and p_due_date<p_bill_date then raise exception 'Due date cannot be before bill date.'; end if;
  if jsonb_typeof(coalesce(p_lines,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_lines,'[]'::jsonb))=0 then raise exception 'At least one supplier bill line is required.'; end if;
  if v_id is null then
    insert into public.accounting_supplier_bills(supplier_party_id,supplier_invoice_number,bill_date,due_date,currency,status,notes,source_reference,created_by)
    values(p_supplier_party_id,nullif(btrim(p_supplier_invoice_number),''),coalesce(p_bill_date,current_date),p_due_date,upper(coalesce(nullif(btrim(p_currency),''),'CAD')),'DRAFT',nullif(btrim(p_notes),''),nullif(btrim(p_source_reference),''),p_actor_id) returning id into v_id;
  else
    select status into v_status from public.accounting_supplier_bills where id=v_id for update;if v_status is null then raise exception 'Supplier bill not found.'; end if;if v_status<>'DRAFT' then raise exception 'Only DRAFT supplier bills can be edited.'; end if;
    update public.accounting_supplier_bills set supplier_party_id=p_supplier_party_id,supplier_invoice_number=nullif(btrim(p_supplier_invoice_number),''),bill_date=coalesce(p_bill_date,current_date),due_date=p_due_date,currency=upper(coalesce(nullif(btrim(p_currency),''),'CAD')),notes=nullif(btrim(p_notes),''),source_reference=nullif(btrim(p_source_reference),''),updated_at=now() where id=v_id;
    delete from public.accounting_supplier_bill_lines where supplier_bill_id=v_id;
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_count:=v_count+1;select account_type,code into v_account_type,v_account_code from public.accounting_accounts where id=(v_line->>'posting_account_id')::uuid and active=true;
    if v_account_type not in ('EXPENSE','ASSET') then raise exception 'Purchase line % must post to an active EXPENSE or ASSET account.',v_count; end if;
    v_item:=nullif(v_line->>'inventory_item_id','')::uuid;v_location:=nullif(v_line->>'inventory_location_id','')::uuid;
    if v_account_code='1600' then
      if v_item is null or v_location is null then raise exception 'Purchase line % posts to Inventory and requires an inventory item and location.',v_count; end if;
      if not exists(select 1 from public.accounting_inventory_items where id=v_item and active=true) then raise exception 'Purchase line % inventory item is inactive or missing.',v_count; end if;
      if not exists(select 1 from public.accounting_inventory_locations where id=v_location and active=true) then raise exception 'Purchase line % inventory location is inactive or missing.',v_count; end if;
    elsif v_item is not null or v_location is not null then raise exception 'Purchase line % can map inventory only when posting to account 1600 Inventory.',v_count; end if;
    if nullif(v_line->>'tax_code_id','') is not null then select active into v_tax_active from public.accounting_tax_codes where id=(v_line->>'tax_code_id')::uuid;if coalesce(v_tax_active,false)=false then raise exception 'Purchase line % uses an inactive or missing tax code.',v_count; end if;end if;
    if coalesce((v_line->>'quantity')::numeric,0)<=0 or coalesce((v_line->>'unit_price')::numeric,0)<0 then raise exception 'Invalid quantity or price on purchase line %.',v_count; end if;
    if coalesce((v_line->>'recoverable_tax')::numeric,0)>coalesce((v_line->>'tax_amount')::numeric,0)+0.01 then raise exception 'Recoverable tax exceeds tax on purchase line %.',v_count; end if;
    if abs(coalesce((v_line->>'line_total')::numeric,0)-(coalesce((v_line->>'line_subtotal')::numeric,0)+coalesce((v_line->>'tax_amount')::numeric,0)))>0.02 then raise exception 'Purchase line % total is inconsistent.',v_count; end if;
    insert into public.accounting_supplier_bill_lines(supplier_bill_id,sort_order,description,quantity,unit_price,posting_account_id,tax_code_id,line_subtotal,tax_amount,recoverable_tax,line_total,inventory_item_id,inventory_location_id)
    values(v_id,coalesce((v_line->>'sort_order')::int,v_count),coalesce(nullif(btrim(v_line->>'description'),''),'Purchase'),(v_line->>'quantity')::numeric,(v_line->>'unit_price')::numeric,(v_line->>'posting_account_id')::uuid,nullif(v_line->>'tax_code_id','')::uuid,(v_line->>'line_subtotal')::numeric,(v_line->>'tax_amount')::numeric,(v_line->>'recoverable_tax')::numeric,(v_line->>'line_total')::numeric,v_item,v_location);
    v_subtotal:=v_subtotal+round((v_line->>'line_subtotal')::numeric,2);v_tax:=v_tax+round((v_line->>'tax_amount')::numeric,2);v_recoverable:=v_recoverable+round((v_line->>'recoverable_tax')::numeric,2);v_total:=v_total+round((v_line->>'line_total')::numeric,2);
  end loop;
  update public.accounting_supplier_bills set subtotal=round(v_subtotal,2),tax_total=round(v_tax,2),recoverable_tax=round(v_recoverable,2),total=round(v_total,2),updated_at=now() where id=v_id;return v_id;
end $$;

-- Posted supplier bills automatically create quantity/value subledger receipts for inventory-mapped lines.
create or replace function public.accounting_inventory_supplier_bill_receipt_trigger()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare l record;v_unit numeric(18,6);
begin
  if new.status='POSTED' and old.status='APPROVED' then
    for l in select * from public.accounting_supplier_bill_lines where supplier_bill_id=new.id and inventory_item_id is not null and inventory_location_id is not null loop
      v_unit:=round((l.line_subtotal+greatest(l.tax_amount-l.recoverable_tax,0))/nullif(l.quantity,0),6);
      perform public.accounting_inventory_apply_movement(l.inventory_item_id,l.inventory_location_id,'PURCHASE_RECEIPT',new.bill_date,l.quantity,v_unit,new.bill_number,'Supplier bill inventory receipt',null,'accounting_supplier_bills',new.id::text,l.id::text,'SUPPLIER_BILL_LINE:'||l.id::text,new.posted_by);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_step18_6_supplier_bill_inventory_receipt on public.accounting_supplier_bills;
create trigger trg_step18_6_supplier_bill_inventory_receipt after update of status on public.accounting_supplier_bills
for each row execute function public.accounting_inventory_supplier_bill_receipt_trigger();

-- Extend Advanced Expense save so INVENTORY becomes active in STEP 18.6.
create or replace function public.accounting_save_expense_claim(
  p_id uuid,p_expense_date date,p_posting_date date,p_vendor_party_id uuid,p_payee_party_id uuid,p_payment_mode text,p_financial_account_id uuid,p_currency text,p_reference text,p_description text,p_business_purpose text,p_department text,p_project_reference text,p_receipt_waiver_reason text,p_lines jsonb,p_actor_id text
) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid;v_line jsonb;v_sub numeric(14,2):=0;v_tax numeric(14,2):=0;v_rec numeric(14,2):=0;v_non numeric(14,2):=0;v_total numeric(14,2):=0;v_status text;v_receipt_status text;v_class text;v_code text;v_item uuid;v_loc uuid;
begin
  if p_payment_mode not in ('COMPANY_PAID','REIMBURSEMENT') then raise exception 'Invalid expense payment mode.'; end if;
  if p_payment_mode='COMPANY_PAID' and p_financial_account_id is null then raise exception 'Company-paid expense requires a financial account.'; end if;
  if p_payment_mode='REIMBURSEMENT' and p_payee_party_id is null then raise exception 'Reimbursement expense requires a payee.'; end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'At least one expense line is required.'; end if;
  if p_id is not null then select status,receipt_status into v_status,v_receipt_status from public.accounting_expense_claims where id=p_id for update;if not found then raise exception 'Expense not found.'; end if;if v_status not in ('DRAFT','REJECTED') then raise exception 'Only Draft/Rejected expenses may be edited.'; end if;v_id:=p_id;else v_id:=gen_random_uuid();v_receipt_status:='MISSING';end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_class:=upper(coalesce(v_line->>'classification','EXPENSE'));select code into v_code from public.accounting_accounts where id=(v_line->>'posting_account_id')::uuid and active=true;
    v_item:=nullif(v_line->>'inventory_item_id','')::uuid;v_loc:=nullif(v_line->>'inventory_location_id','')::uuid;
    if v_class='INVENTORY' then
      if v_code<>'1600' or v_item is null or v_loc is null then raise exception 'Inventory expense lines require account 1600 plus inventory item and location.'; end if;
      if not exists(select 1 from public.accounting_inventory_items where id=v_item and active=true) or not exists(select 1 from public.accounting_inventory_locations where id=v_loc and active=true) then raise exception 'Inventory item/location is inactive or missing.'; end if;
    elsif v_item is not null or v_loc is not null then raise exception 'Inventory item/location mapping is allowed only for INVENTORY classification.'; end if;
    v_sub:=v_sub+coalesce((v_line->>'line_subtotal')::numeric,0);v_tax:=v_tax+coalesce((v_line->>'tax_amount')::numeric,0);v_rec:=v_rec+coalesce((v_line->>'recoverable_tax')::numeric,0);v_non:=v_non+coalesce((v_line->>'nonrecoverable_tax')::numeric,0);v_total:=v_total+coalesce((v_line->>'line_total')::numeric,0);
  end loop;
  v_sub:=round(v_sub,2);v_tax:=round(v_tax,2);v_rec:=round(v_rec,2);v_non:=round(v_non,2);v_total:=round(v_total,2);if v_total<=0 then raise exception 'Expense total must be greater than zero.'; end if;
  if p_id is null then insert into public.accounting_expense_claims(id,expense_date,posting_date,vendor_party_id,payee_party_id,payment_mode,financial_account_id,currency,reference,description,business_purpose,department,project_reference,receipt_status,receipt_waiver_reason,subtotal,tax_total,recoverable_tax,nonrecoverable_tax,total,status,created_by)
    values(v_id,coalesce(p_expense_date,current_date),coalesce(p_posting_date,p_expense_date,current_date),p_vendor_party_id,p_payee_party_id,p_payment_mode,p_financial_account_id,upper(coalesce(p_currency,'CAD')),nullif(trim(p_reference),''),p_description,nullif(trim(p_business_purpose),''),nullif(trim(p_department),''),nullif(trim(p_project_reference),''),case when nullif(trim(p_receipt_waiver_reason),'') is null then 'MISSING' else 'WAIVED' end,nullif(trim(p_receipt_waiver_reason),''),v_sub,v_tax,v_rec,v_non,v_total,'DRAFT',p_actor_id);
  else update public.accounting_expense_claims set expense_date=coalesce(p_expense_date,current_date),posting_date=coalesce(p_posting_date,p_expense_date,current_date),vendor_party_id=p_vendor_party_id,payee_party_id=p_payee_party_id,payment_mode=p_payment_mode,financial_account_id=p_financial_account_id,currency=upper(coalesce(p_currency,'CAD')),reference=nullif(trim(p_reference),''),description=p_description,business_purpose=nullif(trim(p_business_purpose),''),department=nullif(trim(p_department),''),project_reference=nullif(trim(p_project_reference),''),receipt_status=case when receipt_document_id is not null then 'ATTACHED' when nullif(trim(p_receipt_waiver_reason),'') is not null then 'WAIVED' else 'MISSING' end,receipt_waiver_reason=nullif(trim(p_receipt_waiver_reason),''),subtotal=v_sub,tax_total=v_tax,recoverable_tax=v_rec,nonrecoverable_tax=v_non,total=v_total,status='DRAFT',rejected_at=null,rejected_by=null,rejected_reason=null where id=v_id;delete from public.accounting_expense_claim_lines where expense_claim_id=v_id;end if;
  insert into public.accounting_expense_claim_lines(expense_claim_id,sort_order,description,classification,quantity,unit_price,posting_account_id,tax_code_id,itc_eligibility,recoverable_percent,line_subtotal,tax_amount,recoverable_tax,nonrecoverable_tax,line_total,inventory_item_id,inventory_location_id)
  select v_id,coalesce((x->>'sort_order')::int,0),x->>'description',upper(coalesce(x->>'classification','EXPENSE')),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,(x->>'posting_account_id')::uuid,nullif(x->>'tax_code_id','')::uuid,upper(coalesce(x->>'itc_eligibility','FULL')),coalesce((x->>'recoverable_percent')::numeric,100),(x->>'line_subtotal')::numeric,(x->>'tax_amount')::numeric,(x->>'recoverable_tax')::numeric,(x->>'nonrecoverable_tax')::numeric,(x->>'line_total')::numeric,nullif(x->>'inventory_item_id','')::uuid,nullif(x->>'inventory_location_id','')::uuid from jsonb_array_elements(p_lines) x;
  return v_id;
end $$;

-- Posted expense inventory lines create subledger receipts; GL is already handled by EXPENSE_POSTED.
create or replace function public.accounting_inventory_expense_receipt_trigger()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare l record;v_unit numeric(18,6);
begin
  if new.status in ('POSTED','PAID') and old.status='APPROVED' then
    for l in select * from public.accounting_expense_claim_lines where expense_claim_id=new.id and classification='INVENTORY' and inventory_item_id is not null and inventory_location_id is not null loop
      v_unit:=round((l.line_subtotal+l.nonrecoverable_tax)/nullif(l.quantity,0),6);
      perform public.accounting_inventory_apply_movement(l.inventory_item_id,l.inventory_location_id,'DIRECT_EXPENSE_RECEIPT',new.posting_date,l.quantity,v_unit,new.expense_number,'Direct expense inventory receipt',new.project_reference,'accounting_expense_claims',new.id::text,l.id::text,'EXPENSE_LINE:'||l.id::text,new.posted_by);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_step18_6_expense_inventory_receipt on public.accounting_expense_claims;
create trigger trg_step18_6_expense_inventory_receipt after update of status on public.accounting_expense_claims
for each row execute function public.accounting_inventory_expense_receipt_trigger();

-- Posting rules for financial inventory events. Purchase/direct-expense receipts reuse their source posting and do not enqueue a second GL event.
insert into public.accounting_posting_rules(source_system,event_type,debit_account_code,credit_account_code,tax_account_code,enabled,rule_version,configuration_json)
values
 ('PLEASE','INVENTORY_OPENING_POSTED','1600','3000',null,true,1,'{}'::jsonb),
 ('PLEASE','INVENTORY_ISSUE_POSTED','6000','1600',null,true,1,'{}'::jsonb),
 ('PLEASE','INVENTORY_ADJUSTMENT_POSTED','6100','1600',null,true,1,jsonb_build_object('gain_credit_account','6100'))
on conflict(source_system,event_type,debit_account_code,credit_account_code) do update set enabled=true,rule_version=greatest(public.accounting_posting_rules.rule_version,excluded.rule_version),configuration_json=excluded.configuration_json;

-- Audit trail.
create or replace function public.accounting_inventory_audit_trigger()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare v_row jsonb;v_id text;v_before jsonb;v_after jsonb;
begin
  if tg_op='DELETE' then v_before=to_jsonb(old);v_after=null;v_row=v_before;elsif tg_op='INSERT' then v_before=null;v_after=to_jsonb(new);v_row=v_after;else v_before=to_jsonb(old);v_after=to_jsonb(new);v_row=v_after;end if;
  v_id=coalesce(v_row->>'id',v_row->>'item_id','');
  insert into public.accounting_audit_log(event_type,object_type,object_id,before_data,after_data,metadata)
  values('INVENTORY_'||tg_op,tg_table_name,nullif(v_id,''),v_before,v_after,jsonb_build_object('step','18.6','source','DATABASE_TRIGGER'));
  if tg_op='DELETE' then return old;end if;return new;
end $$;
do $$ declare t text;begin foreach t in array array['accounting_inventory_items','accounting_inventory_locations','accounting_inventory_movements','accounting_inventory_counts','accounting_inventory_count_lines'] loop execute format('drop trigger if exists %I on public.%I','trg_'||t||'_inventory_audit',t);execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.accounting_inventory_audit_trigger()','trg_'||t||'_inventory_audit',t);end loop;end $$;

-- Security: browser roles do not write/read accounting data directly; Netlify service role mediates access.
do $$ declare t text;begin foreach t in array array['accounting_inventory_items','accounting_inventory_locations','accounting_inventory_balances','accounting_inventory_movements','accounting_inventory_counts','accounting_inventory_count_lines'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);end loop;end $$;
revoke all on sequence public.accounting_inventory_item_number_seq from anon,authenticated;
revoke all on sequence public.accounting_inventory_movement_number_seq from anon,authenticated;
revoke all on sequence public.accounting_inventory_count_number_seq from anon,authenticated;

revoke all on function public.accounting_save_inventory_item(uuid,text,text,text,text,text,uuid,numeric,boolean,text) from public,anon,authenticated;
revoke all on function public.accounting_save_inventory_location(uuid,text,text,text,text,boolean,text) from public,anon,authenticated;
revoke all on function public.accounting_inventory_apply_movement(uuid,uuid,text,date,numeric,numeric,text,text,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.accounting_inventory_transfer(uuid,uuid,uuid,date,numeric,text,text,text,text) from public,anon,authenticated;
revoke all on function public.accounting_create_inventory_count(uuid,date,text,text,text) from public,anon,authenticated;
revoke all on function public.accounting_save_inventory_count_line(uuid,uuid,numeric,text) from public,anon,authenticated;
revoke all on function public.accounting_post_inventory_count(uuid,text) from public,anon,authenticated;
revoke all on function public.accounting_inventory_gl_balance(date) from public,anon,authenticated;
revoke all on function public.accounting_inventory_subledger_value() from public,anon,authenticated;

grant execute on function public.accounting_save_inventory_item(uuid,text,text,text,text,text,uuid,numeric,boolean,text) to service_role;
grant execute on function public.accounting_save_inventory_location(uuid,text,text,text,text,boolean,text) to service_role;
grant execute on function public.accounting_inventory_apply_movement(uuid,uuid,text,date,numeric,numeric,text,text,text,text,text,text,text,text) to service_role;
grant execute on function public.accounting_inventory_transfer(uuid,uuid,uuid,date,numeric,text,text,text,text) to service_role;
grant execute on function public.accounting_create_inventory_count(uuid,date,text,text,text) to service_role;
grant execute on function public.accounting_save_inventory_count_line(uuid,uuid,numeric,text) to service_role;
grant execute on function public.accounting_post_inventory_count(uuid,text) to service_role;
grant execute on function public.accounting_inventory_gl_balance(date) to service_role;
grant execute on function public.accounting_inventory_subledger_value() to service_role;

comment on table public.accounting_inventory_items is 'STEP 18.6 inventory item master. Moving-average valuation only; manufacturing disabled.';
comment on table public.accounting_inventory_movements is 'Immutable perpetual inventory movement ledger. Purchase/expense receipts do not duplicate their source GL posting.';
comment on table public.accounting_inventory_balances is 'Per-item/per-location moving-average quantity and value control.';
comment on table public.accounting_inventory_counts is 'Controlled physical inventory counts; posted counts create immutable adjustment movements.';

commit;
