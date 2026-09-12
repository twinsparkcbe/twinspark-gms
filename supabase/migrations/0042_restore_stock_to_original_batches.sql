-- Restores put stock back where it came from, instead of inventing a batch.
--
-- THE BUG
--
-- Editing a sale, voiding a sale, or undoing a service completion all restore
-- stock by calling adjust_stock() with a positive delta and no batch. That
-- branch INVENTS a purchase_entries row — a batch that was never bought —
-- valued at the item's most recent cost.
--
-- Two things go wrong every single time:
--
--   1. Purchases grows by a purchase that never happened. Sixty-one of these
--      have accumulated in this database, worth Rs 97,544.
--   2. The real batch never gets its units back. The restore puts them in the
--      new batch, then the re-deduction takes FIFO from the OLD one again, so
--      the original batch drains one unit per edit while a phantom batch sits
--      on the shelf holding one.
--
-- Measured on a replay: a one-unit sale edited three times with nothing
-- changed left the real batch at 6 remaining instead of 9, plus three phantom
-- batches worth Rs 2,100. available_quantity stayed correct throughout, which
-- is why this went unnoticed — the shelf count is right, the books are not.
--
-- THE FIX
--
-- The information needed was always there and simply unused: every unit that
-- leaves is written to stock_movements WITH the purchase_entry_id it was
-- drawn from. A restore can therefore read its own history and give each unit
-- back to the batch that supplied it.
--
-- Nothing in the schema changes, and adjust_stock() is NOT touched. Two
-- restore functions change and one helper is added, every signature identical
-- so CREATE OR REPLACE genuinely replaces rather than leaving a second
-- overload behind (the trap 0035 exists to repair).
--
-- The helper credits remaining_quantity itself before calling adjust_stock()
-- with the batch. That is the contract adjust_stock already documents and the
-- purchase functions already follow: "remaining_quantity is the caller's
-- responsibility for a batch that already exists" (0012). Making adjust_stock
-- credit it instead would have double-counted every purchase, which is
-- exactly what happened on the first attempt at this fix.
--
-- SALE_RETURN is deliberately left alone. A customer bringing a tyre back
-- days later is genuinely new stock arriving, and the shop may not want it
-- valued at what it originally cost. That one keeps the synthetic batch.

-- ---------------------------------------------------------------------------
-- 1. restore_stock_to_source_batches() — the new helper both restores use.
-- ---------------------------------------------------------------------------
-- Gives p_quantity units of an item back to the batches they were actually
-- taken from, most recently consumed first.
--
-- "Most recently consumed first" is the right order because a restore is
-- always undoing the latest thing that happened to this item — an edit, a
-- void, an undo. It is also the exact inverse of FIFO: FIFO drains the oldest
-- batch first, so un-draining walks back up from the newest consumption.
--
-- Each batch is capped by how many of ITS units are actually out
-- (quantity - remaining_quantity), so this can never credit a batch more than
-- it gave. If the movement history somehow cannot account for every unit —
-- data repaired by hand, a batch deleted by a cleanup script — the leftover
-- falls through to a synthetic batch rather than losing the stock, and says
-- so in its note.

create or replace function public.restore_stock_to_source_batches(
  p_item_id uuid,
  p_quantity integer,
  p_reason public.stock_movement_reason,
  p_source_module text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch record;
  v_left integer := p_quantity;
  v_give integer;
begin
  if p_quantity is null or p_quantity <= 0 then
    return;
  end if;

  for v_batch in
    -- Batches this item was drawn from, newest consumption first. The cap is
    -- the batch's own outstanding units, read from the batch row rather than
    -- summed from movements: purchase returns and manual corrections also
    -- move remaining_quantity, and the batch row is the one figure that is
    -- always current.
    select pe.id,
           (pe.quantity - pe.remaining_quantity) as out_now,
           max(sm.created_at) as last_taken
      from public.purchase_entries pe
      join public.stock_movements sm
        on sm.purchase_entry_id = pe.id and sm.delta < 0
     where pe.inventory_item_id = p_item_id
       and pe.quantity > pe.remaining_quantity
     group by pe.id, pe.quantity, pe.remaining_quantity
     order by max(sm.created_at) desc
  loop
    exit when v_left <= 0;

    v_give := least(v_batch.out_now, v_left);
    if v_give > 0 then
      -- The batch's own count first. adjust_stock() deliberately leaves
      -- remaining_quantity to the caller whenever a batch is named (0012) —
      -- record_purchase_entry and update_purchase_entry both set it
      -- themselves for the same reason. The guard means a concurrent sale
      -- that drained this batch further cannot push it past what was bought.
      update public.purchase_entries
         set remaining_quantity = remaining_quantity + v_give
       where id = v_batch.id
         and remaining_quantity + v_give <= quantity;

      if found then
        -- Then the shelf and the ledger row, tied to this same batch so the
        -- cost of the restore cancels the cost of the original deduction to
        -- the rupee.
        perform public.adjust_stock(p_item_id, v_give, p_reason, p_source_module, p_note, v_batch.id);
        v_left := v_left - v_give;
      end if;
    end if;
  end loop;

  -- Nothing left to credit but units still to return. Rather than lose them,
  -- fall back to the old behaviour and mark the row so it is findable.
  if v_left > 0 then
    perform public.adjust_stock(
      p_item_id, v_left, p_reason, p_source_module,
      coalesce(p_note, '') || ' [no source batch found]'
    );
  end if;
end;
$$;

revoke execute on function public.restore_stock_to_source_batches(uuid, integer, public.stock_movement_reason, text, text) from public;

-- ---------------------------------------------------------------------------
-- 2. restore_sale_stock() — same signature, now returns units to their batches
-- ---------------------------------------------------------------------------

create or replace function public.restore_sale_stock(
  p_sale_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
begin
  for v_item in
    select inventory_item_id, quantity
      from public.sale_items
      where sale_id = p_sale_id
        and line_type = 'PRODUCT'
        and inventory_item_id is not null
        and coalesce(quantity, 0) > 0
      for update
  loop
    perform public.restore_stock_to_source_batches(
      v_item.inventory_item_id, v_item.quantity, 'SALE', 'sales', p_note
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. restore_service_job_stock() — same change
-- ---------------------------------------------------------------------------

create or replace function public.restore_service_job_stock(
  p_service_job_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usage record;
begin
  for v_usage in
    select id, inventory_item_id, quantity_used
      from public.service_inventory_usage
      where service_job_id = p_service_job_id and stock_deducted
      for update
  loop
    perform public.restore_stock_to_source_batches(
      v_usage.inventory_item_id, v_usage.quantity_used, 'SERVICE_USAGE', 'service', p_note
    );
    update public.service_inventory_usage set stock_deducted = false where id = v_usage.id;
  end loop;
end;
$$;

revoke execute on function public.restore_sale_stock(uuid, text) from public;
revoke execute on function public.restore_service_job_stock(uuid, text) from public;

notify pgrst, 'reload schema';
