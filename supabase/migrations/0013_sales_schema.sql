-- Sales Management schema.
-- See doc/sales-module-scope.md for the confirmed feature/use-case list this
-- implements. Covers: customers, sales, sale_items, sale_returns, the
-- record_sale() / record_sale_return() / escalate_sale_to_service()
-- functions, and an updated adjust_stock() that recognizes the new
-- SALE_RETURN reason.
--
-- Idempotency note (see 0010/0011's headers — a real production incident
-- established this pattern): Supabase's SQL editor does not wrap a pasted
-- script in one all-or-nothing transaction, so every statement here is
-- guarded to be safely re-runnable regardless of how far a previous attempt
-- got.

-- ---------------------------------------------------------------------------
-- 1. New stock_movement_reason value
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'SALE_RETURN'
      and enumtypid = 'public.stock_movement_reason'::regtype
  ) then
    alter type public.stock_movement_reason add value 'SALE_RETURN';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Lookup/create key (scope doc §2) — one customer per mobile number.
  mobile_number text not null unique,
  address text,
  created_at timestamptz not null default now()
);

create index if not exists customers_mobile_idx on public.customers (mobile_number);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  sale_date timestamptz not null default now(),
  gst_applicable boolean not null default false,
  gst_amount numeric(12, 2) not null default 0 check (gst_amount >= 0),
  discount_applicable boolean not null default false,
  discount_amount numeric(12, 2) not null default 0 check (discount_amount >= 0),
  -- Aggregated from sale_items by record_sale() at insert time (can't be a
  -- generated column — it aggregates across a child table). Sales are
  -- immutable after creation (scope doc §3 note), so these never drift.
  subtotal numeric(14, 2) not null default 0,
  installation_total numeric(14, 2) not null default 0,
  grand_total numeric(14, 2) not null default 0,
  invoice_number text not null unique,
  -- Escalate to Service (scope doc §5) — flag + note only; no Service Job
  -- exists yet. When Service is built, it queries needs_service_followup.
  needs_service_followup boolean not null default false,
  service_followup_note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists sales_customer_idx on public.sales (customer_id, sale_date desc);
create index if not exists sales_date_idx on public.sales (sale_date desc);
create index if not exists sales_followup_idx on public.sales (needs_service_followup) where needs_service_followup;

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete restrict,
  -- Preserves "itemized in the order added" (scope doc §4) — set by
  -- record_sale() as it inserts each line from the input array.
  position integer not null,
  line_type text not null check (line_type in ('PRODUCT', 'INSTALLATION')),

  -- PRODUCT-only columns.
  inventory_item_id uuid references public.inventory_items (id) on delete restrict,
  quantity integer,
  -- Copied from inventory_items.selling_price at time of sale (scope doc
  -- §4/PRD §3.9) — one flat customer-facing price per line, regardless of
  -- which purchase batch(es) FIFO actually draws the stock from underneath.
  -- Batch-level cost variance stays an internal COGS concern, invisible here.
  unit_selling_price numeric(12, 2),

  -- INSTALLATION-only columns.
  installation_subtype text check (installation_subtype in ('TYRE_FITTING', 'CUSTOM')),
  wheel_count integer,
  description text,
  amount numeric(12, 2),
  installed_by text,

  line_total numeric(14, 2) generated always as (
    case
      when line_type = 'PRODUCT' then coalesce(quantity, 0) * coalesce(unit_selling_price, 0)
      else coalesce(amount, 0)
    end
  ) stored,

  created_at timestamptz not null default now(),

  constraint sale_items_product_shape check (
    line_type <> 'PRODUCT'
    or (inventory_item_id is not null and quantity is not null and quantity > 0 and unit_selling_price is not null)
  ),
  constraint sale_items_installation_shape check (
    line_type <> 'INSTALLATION'
    or (
      installation_subtype is not null
      and amount is not null and amount >= 0
      and (
        (installation_subtype = 'TYRE_FITTING' and wheel_count is not null and wheel_count > 0)
        or (installation_subtype = 'CUSTOM' and description is not null and btrim(description) <> '')
      )
    )
  )
);

create index if not exists sale_items_sale_idx on public.sale_items (sale_id, position);
create index if not exists sale_items_item_idx on public.sale_items (inventory_item_id) where inventory_item_id is not null;

create table if not exists public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  -- Targets one specific PRODUCT sale_item (scope doc §6), not the whole sale.
  sale_item_id uuid not null references public.sale_items (id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items (id) on delete restrict,
  quantity integer not null check (quantity > 0),
  reason text not null check (btrim(reason) <> ''),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists sale_returns_item_idx on public.sale_returns (sale_item_id);

-- ---------------------------------------------------------------------------
-- 3. Invoice numbering — same sequence-backed pattern as next_batch_number()
--    / next_inventory_sku(), so concurrent sales never collide.
-- ---------------------------------------------------------------------------

create sequence if not exists public.sales_invoice_number_seq;

create or replace function public.next_sales_invoice_number()
returns text
language sql
as $$
  select 'TW-S-' || lpad(nextval('public.sales_invoice_number_seq')::text, 6, '0');
$$;

-- ---------------------------------------------------------------------------
-- 4. adjust_stock(): re-declared (same signature — CREATE OR REPLACE, no
--    DROP needed) to extend its per-reason rules to SALE_RETURN: admin-only
--    (matches PURCHASE_RETURN's precedent — a stock reversal warrants the
--    same authorization tier as the correction it mirrors), and requires a
--    note, same as every other correction reason.
-- ---------------------------------------------------------------------------

create or replace function public.adjust_stock(
  p_item_id uuid,
  p_delta integer,
  p_reason public.stock_movement_reason,
  p_source_module text,
  p_note text default null,
  p_purchase_entry_id uuid default null,
  p_unit_cost numeric default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_new_balance integer;
  v_cost numeric;
  v_batch record;
  v_remaining_to_consume integer;
  v_take integer;
begin
  if p_delta = 0 then
    raise exception 'Adjustment quantity cannot be zero' using errcode = '22023';
  end if;

  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');

  -- Admin-only reasons: Purchases, Purchase Returns, Sale Returns, Service
  -- usage, and any manual correction/damage write-off.
  if p_reason in ('PURCHASE', 'PURCHASE_RETURN', 'SALE_RETURN', 'SERVICE_USAGE', 'MANUAL_CORRECTION', 'DAMAGE')
     and v_role is distinct from 'admin' then
    raise exception 'Only Administrators can record % stock movements', p_reason
      using errcode = '42501';
  end if;

  -- Admin or Sales Person: Sales and Online Order dispatch.
  if p_reason in ('SALE', 'ONLINE_ORDER_DISPATCH')
     and v_role is distinct from 'admin'
     and v_role is distinct from 'sales_person' then
    raise exception 'Not authorized to record % stock movements', p_reason
      using errcode = '42501';
  end if;

  if p_reason in ('MANUAL_CORRECTION', 'DAMAGE', 'PURCHASE_RETURN', 'SALE_RETURN') and (p_note is null or btrim(p_note) = '') then
    raise exception 'A note is required for % adjustments', p_reason
      using errcode = '22023';
  end if;

  if p_delta > 0 then
    -- An increase always needs a batch — create a synthetic one if the
    -- caller didn't already create/identify one. Sale Return deliberately
    -- restocks via a synthetic batch at the item's most recent cost rather
    -- than reconstructing which exact original batch(es) a FIFO-split sale
    -- drew from — simpler, and correct enough for a floor-level correction.
    if p_purchase_entry_id is null then
      v_cost := p_unit_cost;
      if v_cost is null then
        select unit_price into v_cost
          from public.purchase_entries
          where inventory_item_id = p_item_id
          order by purchase_date desc, created_at desc
          limit 1;
      end if;
      v_cost := coalesce(v_cost, 0);

      insert into public.purchase_entries
        (inventory_item_id, quantity, unit_price, remaining_quantity, selling_price, supplier_name, purchase_date, note, created_by, batch_number)
      values
        (p_item_id, p_delta, v_cost, p_delta,
         coalesce((select selling_price from public.inventory_items where id = p_item_id), v_cost),
         null, now(), p_note, auth.uid(), public.next_batch_number())
      returning id into p_purchase_entry_id;
    end if;

    update public.inventory_items
      set available_quantity = available_quantity + p_delta
      where id = p_item_id
      returning available_quantity into v_new_balance;

    if not found then
      raise exception 'Item % not found', p_item_id using errcode = 'P0002';
    end if;

    insert into public.stock_movements
      (inventory_item_id, delta, resulting_balance, reason, source_module, note, created_by, purchase_entry_id)
    values
      (p_item_id, p_delta, v_new_balance, p_reason, p_source_module, p_note, auth.uid(), p_purchase_entry_id);

  elsif p_purchase_entry_id is not null then
    -- Explicit single-batch decrease (Purchase Return). Race-safe: the
    -- WHERE clause re-checks the batch's remaining_quantity at write time.
    update public.purchase_entries
      set remaining_quantity = remaining_quantity + p_delta
      where id = p_purchase_entry_id
        and remaining_quantity + p_delta >= 0
      returning inventory_item_id into p_item_id;

    if not found then
      raise exception 'Insufficient remaining quantity on this batch' using errcode = 'P0001';
    end if;

    update public.inventory_items
      set available_quantity = available_quantity + p_delta
      where id = p_item_id
        and available_quantity + p_delta >= 0
      returning available_quantity into v_new_balance;

    if not found then
      raise exception 'Insufficient stock, or item % not found', p_item_id using errcode = 'P0001';
    end if;

    insert into public.stock_movements
      (inventory_item_id, delta, resulting_balance, reason, source_module, note, created_by, purchase_entry_id)
    values
      (p_item_id, p_delta, v_new_balance, p_reason, p_source_module, p_note, auth.uid(), p_purchase_entry_id);

  else
    -- FIFO: drain oldest batches first, splitting across as many as needed.
    -- Used by SALE (and, later, SERVICE_USAGE/ONLINE_ORDER_DISPATCH/DAMAGE/
    -- negative MANUAL_CORRECTION) — Sales gets this for free, no new logic.
    v_remaining_to_consume := -p_delta;

    for v_batch in
      select id, remaining_quantity
        from public.purchase_entries
        where inventory_item_id = p_item_id and remaining_quantity > 0
        order by purchase_date asc, created_at asc
        for update
    loop
      exit when v_remaining_to_consume <= 0;

      v_take := least(v_batch.remaining_quantity, v_remaining_to_consume);

      update public.purchase_entries
        set remaining_quantity = remaining_quantity - v_take
        where id = v_batch.id;

      update public.inventory_items
        set available_quantity = available_quantity - v_take
        where id = p_item_id
        returning available_quantity into v_new_balance;

      if not found then
        raise exception 'Item % not found', p_item_id using errcode = 'P0002';
      end if;

      insert into public.stock_movements
        (inventory_item_id, delta, resulting_balance, reason, source_module, note, created_by, purchase_entry_id)
      values
        (p_item_id, -v_take, v_new_balance, p_reason, p_source_module, p_note, auth.uid(), v_batch.id);

      v_remaining_to_consume := v_remaining_to_consume - v_take;
    end loop;

    if v_remaining_to_consume > 0 then
      raise exception 'Insufficient stock, or item % not found', p_item_id using errcode = 'P0001';
    end if;
  end if;

  return v_new_balance;
end;
$$;

grant execute on function public.adjust_stock(
  uuid, integer, public.stock_movement_reason, text, text, uuid, numeric
) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. record_sale(): the ONLY way to record a Sale. Finds-or-creates the
--    Customer, inserts the Sale + every Sale Item (product and installation
--    lines, in the order given via p_lines), deducts stock per PRODUCT line
--    via adjust_stock() (FIFO, reason SALE), and computes/stores the
--    aggregated totals — all in one transaction, so a mid-way failure (e.g.
--    insufficient stock on line 3 of 4) leaves nothing partially recorded
--    (SALE-027).
--
--    p_lines shape (jsonb array), one object per line:
--      PRODUCT:      {"line_type":"PRODUCT","inventory_item_id":"...","quantity":2}
--      INSTALLATION: {"line_type":"INSTALLATION","installation_subtype":"TYRE_FITTING","wheel_count":2,"installed_by":"Ravi"}
--                 or {"line_type":"INSTALLATION","installation_subtype":"CUSTOM","description":"Chain Kit Install","amount":250,"installed_by":"Ravi"}
-- ---------------------------------------------------------------------------

create or replace function public.record_sale(
  p_customer_name text,
  p_customer_mobile text,
  p_customer_address text,
  p_gst_applicable boolean,
  p_gst_amount numeric,
  p_discount_applicable boolean,
  p_discount_amount numeric,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_customer_id uuid;
  v_sale_id uuid;
  v_line jsonb;
  v_position integer := 0;
  v_product_count integer := 0;
  v_subtotal numeric := 0;
  v_installation_total numeric := 0;
  v_unit_price numeric;
  v_quantity integer;
  v_subtype text;
  v_wheel_count integer;
  v_amount numeric;
  v_description text;
  v_installed_by text;
  v_gst_amount numeric := coalesce(p_gst_amount, 0);
  v_discount_amount numeric := coalesce(p_discount_amount, 0);
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if v_role is distinct from 'admin' and v_role is distinct from 'sales_person' then
    raise exception 'Not authorized to record sales' using errcode = '42501';
  end if;

  if p_customer_mobile is null or btrim(p_customer_mobile) = '' then
    raise exception 'Customer mobile number is required' using errcode = '22023';
  end if;
  if p_customer_name is null or btrim(p_customer_name) = '' then
    raise exception 'Customer name is required' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'A sale requires at least one line item' using errcode = '22023';
  end if;
  if v_gst_amount < 0 then
    raise exception 'GST amount cannot be negative' using errcode = '22023';
  end if;
  if v_discount_amount < 0 then
    raise exception 'Discount amount cannot be negative' using errcode = '22023';
  end if;

  -- Find-or-create Customer by mobile number (scope doc §2).
  select id into v_customer_id from public.customers where mobile_number = btrim(p_customer_mobile);
  if v_customer_id is null then
    insert into public.customers (name, mobile_number, address)
    values (btrim(p_customer_name), btrim(p_customer_mobile), nullif(btrim(p_customer_address), ''))
    returning id into v_customer_id;
  end if;

  insert into public.sales
    (customer_id, gst_applicable, gst_amount, discount_applicable, discount_amount,
     subtotal, installation_total, grand_total, invoice_number, created_by)
  values
    (v_customer_id, coalesce(p_gst_applicable, false), v_gst_amount,
     coalesce(p_discount_applicable, false), v_discount_amount,
     0, 0, 0, public.next_sales_invoice_number(), auth.uid())
  returning id into v_sale_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_position := v_position + 1;

    if (v_line ->> 'line_type') = 'PRODUCT' then
      v_product_count := v_product_count + 1;
      v_quantity := (v_line ->> 'quantity')::integer;

      if v_quantity is null or v_quantity <= 0 then
        raise exception 'Quantity must be greater than zero' using errcode = '22023';
      end if;

      select selling_price into v_unit_price
        from public.inventory_items
        where id = (v_line ->> 'inventory_item_id')::uuid and is_active;

      if v_unit_price is null then
        raise exception 'Inventory item % not found or inactive', v_line ->> 'inventory_item_id' using errcode = 'P0002';
      end if;

      insert into public.sale_items
        (sale_id, position, line_type, inventory_item_id, quantity, unit_selling_price)
      values
        (v_sale_id, v_position, 'PRODUCT', (v_line ->> 'inventory_item_id')::uuid, v_quantity, v_unit_price);

      v_subtotal := v_subtotal + (v_unit_price * v_quantity);

      -- FIFO consumption, reason SALE — adjust_stock() enforces admin-or-
      -- sales_person authorization and is the sole path that mutates
      -- available_quantity. An insufficient-stock raise here aborts this
      -- entire function (and the sale insert above), per SALE-027.
      perform public.adjust_stock((v_line ->> 'inventory_item_id')::uuid, -v_quantity, 'SALE', 'sales', null);

    elsif (v_line ->> 'line_type') = 'INSTALLATION' then
      v_subtype := v_line ->> 'installation_subtype';
      v_wheel_count := (v_line ->> 'wheel_count')::integer;
      v_description := nullif(btrim(coalesce(v_line ->> 'description', '')), '');
      v_installed_by := nullif(btrim(coalesce(v_line ->> 'installed_by', '')), '');

      if v_subtype = 'TYRE_FITTING' then
        if v_wheel_count is null or v_wheel_count <= 0 then
          raise exception 'Wheel count is required for Tyre Fitting' using errcode = '22023';
        end if;
        -- Auto-calculated (wheel_count x 300), but the caller may pass an
        -- explicit override amount for a one-off rate (scope doc §4) — if
        -- present, it's trusted as-is; otherwise the formula applies.
        v_amount := coalesce((v_line ->> 'amount')::numeric, v_wheel_count * 300);
      elsif v_subtype = 'CUSTOM' then
        if v_description is null then
          raise exception 'A description is required for a custom installation charge' using errcode = '22023';
        end if;
        v_amount := (v_line ->> 'amount')::numeric;
        if v_amount is null then
          raise exception 'An amount is required for a custom installation charge' using errcode = '22023';
        end if;
      else
        raise exception 'Unknown installation subtype %', v_subtype using errcode = '22023';
      end if;

      if v_amount < 0 then
        raise exception 'Installation amount cannot be negative' using errcode = '22023';
      end if;

      insert into public.sale_items
        (sale_id, position, line_type, installation_subtype, wheel_count, description, amount, installed_by)
      values
        (v_sale_id, v_position, 'INSTALLATION', v_subtype, v_wheel_count, v_description, v_amount, v_installed_by);

      v_installation_total := v_installation_total + v_amount;
    else
      raise exception 'Unknown line type %', v_line ->> 'line_type' using errcode = '22023';
    end if;
  end loop;

  if v_product_count = 0 then
    raise exception 'A sale requires at least one product line' using errcode = '22023';
  end if;

  update public.sales
    set subtotal = v_subtotal,
        installation_total = v_installation_total,
        grand_total = v_subtotal + v_installation_total + v_gst_amount - v_discount_amount
    where id = v_sale_id;

  return v_sale_id;
end;
$$;

grant execute on function public.record_sale(
  text, text, text, boolean, numeric, boolean, numeric, jsonb
) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. record_sale_return(): the ONLY way to record a Sale Return. Locks the
--    source sale_items row (FOR UPDATE), validates the requested quantity
--    against what's actually remaining on that line, restocks via
--    adjust_stock (reason SALE_RETURN — admin-only per §4 above), and
--    inserts the sale_returns row, all atomically. Only PRODUCT lines are
--    returnable (scope doc §6) — an INSTALLATION line's charge is never
--    auto-reversed by this function.
-- ---------------------------------------------------------------------------

create or replace function public.record_sale_return(
  p_sale_item_id uuid,
  p_quantity integer,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_already_returned integer;
  v_remaining integer;
  v_return_id uuid;
begin
  if p_quantity <= 0 then
    raise exception 'Return quantity must be greater than zero' using errcode = '22023';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required for a sale return' using errcode = '22023';
  end if;

  select * into v_item from public.sale_items where id = p_sale_item_id for update;
  if not found then
    raise exception 'Sale item % not found', p_sale_item_id using errcode = 'P0002';
  end if;
  if v_item.line_type <> 'PRODUCT' then
    raise exception 'Only product lines can be returned' using errcode = '22023';
  end if;

  select coalesce(sum(quantity), 0) into v_already_returned
    from public.sale_returns where sale_item_id = p_sale_item_id;
  v_remaining := v_item.quantity - v_already_returned;

  if p_quantity > v_remaining then
    raise exception 'Cannot return % units — only % remaining on this line', p_quantity, v_remaining
      using errcode = '22023';
  end if;

  -- adjust_stock() enforces SALE_RETURN admin authorization and the
  -- required-note rule, and is the sole path that mutates available_quantity.
  perform public.adjust_stock(v_item.inventory_item_id, p_quantity, 'SALE_RETURN', 'sales', p_reason);

  insert into public.sale_returns
    (sale_item_id, inventory_item_id, quantity, reason, created_by)
  values
    (p_sale_item_id, v_item.inventory_item_id, p_quantity, p_reason, auth.uid())
  returning id into v_return_id;

  return v_return_id;
end;
$$;

grant execute on function public.record_sale_return to authenticated;

-- ---------------------------------------------------------------------------
-- 7. escalate_sale_to_service(): sets the "Needs Service Follow-up" flag
--    (scope doc §5). Admin or Sales Person — same authorization as creating
--    the sale in the first place, since this is that same counter flagging
--    its own follow-up. Only allowed on a sale that has at least one
--    INSTALLATION line (SALE-036).
-- ---------------------------------------------------------------------------

create or replace function public.escalate_sale_to_service(
  p_sale_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_has_installation boolean;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if v_role is distinct from 'admin' and v_role is distinct from 'sales_person' then
    raise exception 'Not authorized to escalate sales to Service' using errcode = '42501';
  end if;

  select exists(
    select 1 from public.sale_items where sale_id = p_sale_id and line_type = 'INSTALLATION'
  ) into v_has_installation;

  if not v_has_installation then
    raise exception 'Only a sale with at least one installation line can be escalated to Service' using errcode = '22023';
  end if;

  update public.sales
    set needs_service_followup = true,
        service_followup_note = nullif(btrim(coalesce(p_note, '')), '')
    where id = p_sale_id;

  if not found then
    raise exception 'Sale % not found', p_sale_id using errcode = 'P0002';
  end if;
end;
$$;

grant execute on function public.escalate_sale_to_service to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Row Level Security
-- ---------------------------------------------------------------------------

alter table public.customers enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_returns enable row level security;

-- Admin AND Sales Person can read — first module where Sales Person needs
-- real access, unlike Inventory/Purchases' admin-only tables (scope doc §1).
-- No insert/update/delete policy on any of these — all writes go through the
-- SECURITY DEFINER functions above, same immutable-audit-trail pattern as
-- purchase_entries/purchase_returns.
create policy "customers_read" on public.customers
  for select using (
    (auth.jwt() -> 'user_metadata' ->> 'role') in ('admin', 'sales_person')
  );

create policy "sales_read" on public.sales
  for select using (
    (auth.jwt() -> 'user_metadata' ->> 'role') in ('admin', 'sales_person')
  );

create policy "sale_items_read" on public.sale_items
  for select using (
    (auth.jwt() -> 'user_metadata' ->> 'role') in ('admin', 'sales_person')
  );

-- Sale Returns are admin-only to read (mirrors purchase_returns — matches
-- SALE_RETURN's admin-only authorization in adjust_stock() above).
create policy "sale_returns_admin_select" on public.sale_returns
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
