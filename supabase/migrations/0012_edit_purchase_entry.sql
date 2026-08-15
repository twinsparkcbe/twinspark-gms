-- Edit Purchase Entry: correct a data-entry mistake on an already-recorded
-- batch (quantity, purchase price, selling price, purchase date, supplier,
-- note). Confirmed decision (chat): any batch can be edited at any time —
-- no restriction requiring it to be untouched. Reducing quantity below what
-- has already been sold/returned from this batch is still rejected, via
-- adjust_stock()'s existing remaining_quantity floor check (see below).
--
-- New function only — no schema/column changes — so CREATE OR REPLACE is
-- naturally idempotent across re-runs of this file, same as
-- create_inventory_item_with_purchase() in 0011.

create or replace function public.update_purchase_entry(
  p_entry_id uuid,
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
  v_role text;
  v_item_id uuid;
  v_old_quantity integer;
  v_old_remaining integer;
  v_delta integer;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if v_role is distinct from 'admin' then
    raise exception 'Only Administrators can edit a purchase entry' using errcode = '42501';
  end if;

  if p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero' using errcode = '22023';
  end if;
  if p_unit_price <= 0 then
    raise exception 'Purchase price must be greater than zero' using errcode = '22023';
  end if;
  if p_selling_price <= 0 then
    raise exception 'Selling price is required and must be greater than zero' using errcode = '22023';
  end if;

  select inventory_item_id, quantity, remaining_quantity
    into v_item_id, v_old_quantity, v_old_remaining
    from public.purchase_entries
    where id = p_entry_id
    for update;

  if not found then
    raise exception 'Purchase entry % not found', p_entry_id using errcode = 'P0002';
  end if;

  v_delta := p_quantity - v_old_quantity;

  if v_delta > 0 then
    -- Bump quantity and remaining_quantity together, in the SAME statement.
    -- purchase_entries has a check constraint (remaining_quantity <=
    -- quantity, added in 0010) — updating them in separate statements would
    -- transiently violate it here, since a bigger remaining_quantity would
    -- briefly be compared against the still-old (smaller) quantity.
    update public.purchase_entries
      set quantity = p_quantity,
          remaining_quantity = remaining_quantity + v_delta
      where id = p_entry_id;

    -- adjust_stock()'s positive-delta-with-an-existing-batch path only
    -- bumps inventory_items.available_quantity and logs the movement —
    -- remaining_quantity is the caller's responsibility for a batch that
    -- already exists (mirrors record_purchase_entry(), which sets
    -- remaining_quantity in its own INSERT before ever calling this).
    perform public.adjust_stock(v_item_id, v_delta, 'PURCHASE', 'purchases', p_note, p_entry_id);

  elsif v_delta < 0 then
    -- adjust_stock()'s negative-delta-with-an-explicit-batch path decrements
    -- this batch's remaining_quantity itself, with a built-in floor check
    -- (remaining_quantity + delta >= 0). Driven by delta = p_quantity -
    -- v_old_quantity, that check is algebraically identical to "the new
    -- quantity can't drop below what's already been sold/returned from this
    -- batch" (v_old_quantity - v_old_remaining) — no separate validation
    -- needed here. Raises P0001 ("Insufficient remaining quantity on this
    -- batch") if violated.
    perform public.adjust_stock(v_item_id, v_delta, 'PURCHASE', 'purchases', p_note, p_entry_id);

    -- remaining_quantity is already correct (set above); quantity can now
    -- safely follow — proof: new_remaining = p_quantity - consumed, and
    -- consumed >= 0, so new_remaining <= p_quantity always holds.
    update public.purchase_entries
      set quantity = p_quantity
      where id = p_entry_id;
  end if;

  update public.purchase_entries
    set unit_price = p_unit_price,
        selling_price = p_selling_price,
        purchase_date = p_purchase_date,
        supplier_name = nullif(btrim(coalesce(p_supplier_name, '')), ''),
        note = p_note
    where id = p_entry_id;

  -- Both purchase_price and selling_price on the item are auto-synced
  -- *reference* values that always mirror whichever batch is currently
  -- newest by insertion order (created_at) — same rule record_purchase_
  -- entry() established (0011). This batch's created_at doesn't change on
  -- edit, so editing an older batch's price doesn't silently overwrite the
  -- item's current reference price; editing the newest batch does flow
  -- through.
  update public.inventory_items ii
    set purchase_price = newest.unit_price,
        selling_price = newest.selling_price
    from (
      select unit_price, selling_price
        from public.purchase_entries
        where inventory_item_id = v_item_id
        order by created_at desc
        limit 1
    ) newest
    where ii.id = v_item_id;

  return p_entry_id;
end;
$$;

grant execute on function public.update_purchase_entry(
  uuid, integer, numeric, numeric, timestamptz, text, text
) to authenticated;
