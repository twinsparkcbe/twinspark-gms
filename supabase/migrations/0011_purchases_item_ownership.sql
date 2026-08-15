-- Purchases becomes the sole place inventory items are created and priced.
-- See doc/inventory-purchase-simplification-scope.md.
--
-- Idempotency note (established in 0010 after a real production incident —
-- see that file's header): Supabase's SQL editor does NOT wrap a pasted
-- script in one all-or-nothing transaction, so every statement here is
-- guarded to be safely re-runnable regardless of how far a previous attempt
-- got.

-- ---------------------------------------------------------------------------
-- 1. purchase_entries.selling_price_override -> selling_price, now required.
--    (Signature-wise this doesn't affect record_purchase_entry's argument
--    TYPES below — only the column and the parameter's internal name/
--    validation change.)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_entries' and column_name = 'selling_price_override'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_entries' and column_name = 'selling_price'
  ) then
    alter table public.purchase_entries rename column selling_price_override to selling_price;
  end if;
end;
$$;

-- Some environments may never have run 0010's selling_price_override
-- addition at all yet — cover that case too.
alter table public.purchase_entries add column if not exists selling_price numeric(10, 2);

-- Backfill any batch still missing a selling price from the item's current
-- selling_price (confirmed approach — doc/inventory-purchase-simplification-
-- scope.md).
update public.purchase_entries pe
  set selling_price = ii.selling_price
  from public.inventory_items ii
  where pe.inventory_item_id = ii.id
    and pe.selling_price is null;

-- Defensive floor for the rare case an item's own selling_price is itself 0
-- (shouldn't happen — selling_price has always been required > 0 at item
-- creation — but guards this migration from ever failing on the NOT NULL
-- below).
update public.purchase_entries set selling_price = 0.01 where selling_price is null;

alter table public.purchase_entries alter column selling_price set not null;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'purchase_entries_selling_price_override_check') then
    alter table public.purchase_entries drop constraint purchase_entries_selling_price_override_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'purchase_entries_selling_price_check') then
    alter table public.purchase_entries
      add constraint purchase_entries_selling_price_check check (selling_price > 0);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. record_purchase_entry(): selling price is now required (was optional/
--    nullable-with-fallback), and syncs inventory_items.selling_price the
--    same way it already syncs purchase_price — both become auto-synced
--    *reference* values only, never directly editable anywhere.
--
--    Argument TYPES are unchanged from 0010 (uuid, integer, numeric,
--    timestamptz, text, text, numeric), but the last parameter's NAME changes
--    (p_selling_price_override -> p_selling_price). Postgres resolves
--    overloads by name + argument types, but CREATE OR REPLACE still refuses
--    to rename a parameter in place (error 42P13) — it has to be dropped
--    first. The DROP is idempotent: it's a no-op if 0010 was never applied
--    (function doesn't exist yet) or if this migration already ran once
--    (parameter is already named p_selling_price).
-- ---------------------------------------------------------------------------

drop function if exists public.record_purchase_entry(
  uuid, integer, numeric, timestamptz, text, text, numeric
);

create or replace function public.record_purchase_entry(
  p_inventory_item_id uuid,
  p_quantity integer,
  p_unit_price numeric,
  p_purchase_date timestamptz,
  p_supplier_name text default null,
  p_note text default null,
  p_selling_price numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_item_active boolean;
begin
  if p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero' using errcode = '22023';
  end if;
  if p_unit_price <= 0 then
    raise exception 'Purchase price must be greater than zero' using errcode = '22023';
  end if;
  if p_selling_price is null or p_selling_price <= 0 then
    raise exception 'Selling price is required and must be greater than zero' using errcode = '22023';
  end if;

  select is_active into v_item_active from public.inventory_items where id = p_inventory_item_id;

  if v_item_active is null then
    raise exception 'Inventory item % not found', p_inventory_item_id using errcode = 'P0002';
  end if;
  if not v_item_active then
    raise exception 'Cannot record a purchase against an inactive item' using errcode = '22023';
  end if;

  insert into public.purchase_entries
    (inventory_item_id, quantity, unit_price, remaining_quantity, supplier_name, purchase_date, note, created_by, batch_number, selling_price)
  values
    (p_inventory_item_id, p_quantity, p_unit_price, p_quantity, nullif(btrim(p_supplier_name), ''), p_purchase_date, p_note, auth.uid(), public.next_batch_number(), p_selling_price)
  returning id into v_entry_id;

  -- adjust_stock() enforces PURCHASE-reason admin authorization and is the
  -- sole path that mutates available_quantity — not duplicated here.
  perform public.adjust_stock(p_inventory_item_id, p_quantity, 'PURCHASE', 'purchases', p_note, v_entry_id);

  -- Both purchase_price and selling_price are auto-synced *reference* values
  -- only now (doc/inventory-purchase-simplification-scope.md) — never
  -- directly editable; always mirror the newest batch.
  update public.inventory_items
    set purchase_price = p_unit_price,
        selling_price = p_selling_price
    where id = p_inventory_item_id;

  return v_entry_id;
end;
$$;

grant execute on function public.record_purchase_entry(
  uuid, integer, numeric, timestamptz, text, text, numeric
) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. create_inventory_item_with_purchase(): atomic "New Item" — creates the
--    item and its opening batch in one transaction, so Purchases' New Item
--    flow can never leave a half-created item (item exists, no batch — or
--    vice versa). First-time function in this migration, so CREATE OR
--    REPLACE is naturally idempotent across re-runs of this same file.
-- ---------------------------------------------------------------------------

create or replace function public.create_inventory_item_with_purchase(
  p_item_type public.item_type,
  p_product_name text,
  p_sku_code text,
  p_brand_id uuid,
  p_low_stock_threshold integer,
  p_custom_type_label text,
  p_image_url text,
  p_quantity integer,
  p_unit_price numeric,
  p_selling_price numeric,
  p_purchase_date timestamptz,
  p_supplier_name text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
  v_sku text;
  v_role text;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if v_role is distinct from 'admin' then
    raise exception 'Only Administrators can create inventory items' using errcode = '42501';
  end if;

  if btrim(coalesce(p_product_name, '')) = '' then
    raise exception 'Product name is required' using errcode = '22023';
  end if;
  if p_low_stock_threshold < 0 then
    raise exception 'Low stock threshold cannot be negative' using errcode = '22023';
  end if;

  -- SKU / Code is optional — auto-assign the next value from the shared
  -- sequence when left blank, same as the old Inventory Add Item flow
  -- (next_inventory_sku(), 0003_inventory_custom_type_sku.sql).
  v_sku := nullif(btrim(coalesce(p_sku_code, '')), '');
  if v_sku is null then
    select public.next_inventory_sku() into v_sku;
  end if;

  insert into public.inventory_items
    (item_type, product_name, sku_code, brand_id, purchase_price, selling_price,
     low_stock_threshold, image_url, custom_type_label, available_quantity)
  values
    (p_item_type, p_product_name, v_sku, p_brand_id, p_unit_price, p_selling_price,
     p_low_stock_threshold, p_image_url,
     case when p_item_type = 'OTHER_SPARE_PART' then nullif(btrim(coalesce(p_custom_type_label, '')), '') else null end,
     0)
  returning id into v_item_id;

  -- record_purchase_entry() re-validates quantity/prices, creates the first
  -- batch (with its own batch_number + remaining_quantity), and — via
  -- adjust_stock() — is the sole path that mutates available_quantity. Not
  -- duplicated here. If anything in it raises, the item insert above rolls
  -- back too (same function, same transaction) — never a half-created item.
  perform public.record_purchase_entry(
    v_item_id, p_quantity, p_unit_price, p_purchase_date, p_supplier_name, p_note, p_selling_price
  );

  return v_item_id;
end;
$$;

grant execute on function public.create_inventory_item_with_purchase(
  public.item_type, text, text, uuid, integer, text, text, integer, numeric, numeric, timestamptz, text, text
) to authenticated;
