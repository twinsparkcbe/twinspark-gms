-- Data reconciliation: zero out available_quantity for any item that has no
-- backing purchase_entries batch.
--
-- Root cause: adjust_stock()'s FIFO decrease path (0010_purchase_batch_fifo.
-- sql) only ever consumes from purchase_entries.remaining_quantity — never
-- from inventory_items.available_quantity directly. Any item whose
-- available_quantity was set outside record_purchase_entry() (e.g. entered
-- directly against the item, the way 0007_seed_inventory.sql's seed rows
-- were) has a cached total with nothing behind it, so Sales/Service can
-- never sell it: FIFO finds zero eligible batch rows and raises "Insufficient
-- stock" even though the UI shows stock available. Confirmed live for
-- SKU-00008 (Milaze tyre): available_quantity = 60, batch_count = 0.
--
-- Fix: reset available_quantity to 0 for every item in that state, with a
-- MANUAL_CORRECTION audit row explaining why. adjust_stock() itself can't be
-- used here — its decrease path requires real batch rows to decrement, which
-- is exactly what's missing — so this updates inventory_items directly, the
-- same way 0007's seed script did (mirrored, not new precedent). Once this
-- runs, re-add real stock for these items through Purchases → Add Purchase
-- Entry so they get a proper FIFO batch and are sellable again.
--
-- Idempotent: the WHERE clause only matches items still in the stray state,
-- so re-running this after it's already applied is a no-op.

do $$
declare
  v_row record;
begin
  for v_row in
    select i.id, i.available_quantity
      from public.inventory_items i
      where i.available_quantity > 0
        and coalesce(
          (select sum(pe.remaining_quantity) from public.purchase_entries pe where pe.inventory_item_id = i.id),
          0
        ) = 0
  loop
    update public.inventory_items
      set available_quantity = 0
      where id = v_row.id;

    insert into public.stock_movements
      (inventory_item_id, delta, resulting_balance, reason, source_module, note, created_by)
    values
      (
        v_row.id,
        -v_row.available_quantity,
        0,
        'MANUAL_CORRECTION',
        'system_reconciliation',
        'Reset stray available_quantity with no backing purchase batch (0014_reconcile_stray_available_quantity.sql). Re-add stock via Purchases.',
        null
      );
  end loop;
end;
$$;

-- Preview/verify: run this after the block above to confirm no stray items
-- remain (should return 0 rows).
-- select i.product_name, i.sku_code, i.available_quantity
--   from public.inventory_items i
--   where i.available_quantity > 0
--     and coalesce((select sum(pe.remaining_quantity) from public.purchase_entries pe where pe.inventory_item_id = i.id), 0) = 0;
