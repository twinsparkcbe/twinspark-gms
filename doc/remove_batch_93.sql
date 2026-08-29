-- =====================================================================
-- Twinspark GMS — remove the test purchase BATCH-000093
-- Track Tyre - Back (SKU-00005) · 200 × ₹850 = ₹1,70,000 · 24 Aug 2026
-- =====================================================================
--
-- Why this cannot be done in the app: Edit Purchase refuses to reduce the
-- quantity below what has already left the batch, and all 200 units have
-- (6 on sales, 184 on a manual correction, the rest consumed). The guard is
-- right in general — it stops stock going negative — but it also blocks the
-- correction this batch actually needs.
--
-- WHAT THIS DOES TO STOCK: nothing. The batch put 200 units in and 200 came
-- back out, so its net effect on Track Tyre - Back's shelf count is zero.
-- available_quantity is deliberately never touched, and the transaction
-- aborts if it moves by even one unit.
--
-- WHAT IT DOES TO THE BOOKS: Purchases drops by ₹1,70,000. The 6 units that
-- went out on real sales lose their recorded cost (6 × ₹850 = ₹5,100), so
-- profit for those days rises by that much. STEP 0 prints the exact figure —
-- read it before running STEP 1. If those three sales are test sales too,
-- delete them separately and the distortion goes with them.
--
-- ---------------------------------------------------------------------
-- STEP 0 — what goes, and what it costs (safe, read-only)
-- ---------------------------------------------------------------------

select pe.batch_number, i.sku_code, i.product_name,
       pe.quantity, pe.remaining_quantity, pe.unit_price, pe.total_amount,
       pe.purchase_date::date, i.available_quantity as item_stock_now
from public.purchase_entries pe
join public.inventory_items i on i.id = pe.inventory_item_id
where pe.batch_number = 'BATCH-000093';

-- Every movement that will be removed with it.
select sm.reason, sm.source_module, sm.delta, sm.created_at::date as dated, sm.note
from public.stock_movements sm
join public.purchase_entries pe on pe.id = sm.purchase_entry_id
where pe.batch_number = 'BATCH-000093'
order by sm.created_at;

-- THE NUMBER THAT MATTERS: cost currently recorded against real sales and
-- service jobs from this batch. Deleting the batch erases it, and profit for
-- those days rises by exactly this much.
select coalesce(sum(-sm.delta * pe.unit_price), 0) as cogs_that_will_be_lost,
       coalesce(sum(-sm.delta), 0)                 as units_involved
from public.stock_movements sm
join public.purchase_entries pe on pe.id = sm.purchase_entry_id
where pe.batch_number = 'BATCH-000093'
  and sm.reason in ('SALE', 'SERVICE_USAGE', 'ONLINE_ORDER_DISPATCH');


-- ---------------------------------------------------------------------
-- STEP 1 — the delete
-- ---------------------------------------------------------------------

begin;

create temporary table _batch on commit drop as
  select pe.id, pe.inventory_item_id, pe.total_amount
  from public.purchase_entries pe
  where pe.batch_number = 'BATCH-000093';

-- Stock is the thing most easily broken here, so it is measured before and
-- compared after rather than reasoned about.
create temporary table _stock_before on commit drop as
  select id, available_quantity from public.inventory_items;

do $$
declare v_n integer;
begin
  select count(*) into v_n from _batch;
  if v_n <> 1 then
    raise exception 'Expected exactly 1 batch named BATCH-000093, found % — nothing was deleted', v_n;
  end if;
  raise notice 'Removing BATCH-000093 (₹% of purchases)', (select total_amount from _batch);
end $$;

-- Returns and movements point at the batch with ON DELETE RESTRICT, so they
-- go first or Postgres refuses.
delete from public.purchase_returns  where purchase_entry_id in (select id from _batch);
delete from public.stock_movements   where purchase_entry_id in (select id from _batch);
delete from public.purchase_entries  where id                in (select id from _batch);

do $$
declare v_changed integer;
begin
  select count(*) into v_changed
  from public.inventory_items i
  join _stock_before b on b.id = i.id
  where i.available_quantity is distinct from b.available_quantity;

  if v_changed > 0 then
    raise exception 'Stock moved on % item(s) — rolling back, nothing was deleted', v_changed;
  end if;
end $$;

commit;


-- ---------------------------------------------------------------------
-- STEP 2 — confirm. Run on its own.
-- ---------------------------------------------------------------------

select 'BATCH-000093 still there' as check, count(*)::text as value
from public.purchase_entries where batch_number = 'BATCH-000093'
union all
select 'Track Tyre - Back stock', available_quantity::text
from public.inventory_items where sku_code = 'SKU-00005'
union all
select 'active Track Tyre - Back', count(*)::text
from public.inventory_items
where item_type = 'TRACK_TYRE' and product_name = 'Track Tyre - Back' and is_active
union all
select 'purchase entries', count(*)::text from public.purchase_entries
union all
select 'purchase value', sum(total_amount)::text from public.purchase_entries;
-- Want: first row 0, stock unchanged from STEP 0, active Back still 1 or more.
