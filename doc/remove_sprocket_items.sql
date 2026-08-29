-- =====================================================================
-- Twinspark GMS — remove 9 CHAIN SPROCKET items
-- =====================================================================
--
--   SPR-1001  CHAIN SPROCKET - MT
--   SPR-1005  CHAIN SPROCKET - RS
--   SPR-1009  CHAIN SPROCKET - DUKE 200 GEN1
--   SPR-1010  CHAIN SPROCKET - DUKE 200 GEN2
--   SPR-1011  CHAIN SPROCKET - DUKE 200 GEN3
--   SPR-1012  CHAIN SPROCKET - DUKE 250 GEN1
--   SPR-1013  CHAIN SPROCKET - DUKE 250 GEN2
--   SPR-1017  CHAIN SPROCKET - DUKE 125 GEN3
--   SPR-1028  CHAIN SPROCKET - DOMINOR 400
--
-- OIL-1001 (MOTUL - 7100) is deliberately NOT here. It is on sale
-- TW-S-000010 and service job SJ-000005 — neither of which is on the
-- removal list — so deleting it would strip the cost out of two bills
-- while their revenue stayed, quietly inflating past profit. It needs its
-- own decision.
--
-- Verified clean: these nine appear on no sale line and no service job, so
-- nothing that has been invoiced is touched. Their purchase batches and
-- stock movements go with them, which is what takes them out of the
-- Purchases total, the Purchase Report, Inventory, Ageing Stock and the
-- cost side of Profit.
--
-- ---------------------------------------------------------------------
-- STEP 0 — what goes, and what it is worth (safe, read-only)
-- ---------------------------------------------------------------------

with target as (
  select id, sku_code, product_name, available_quantity, is_active
  from public.inventory_items
  where sku_code in ('SPR-1001','SPR-1005','SPR-1009','SPR-1010','SPR-1011',
                     'SPR-1012','SPR-1013','SPR-1017','SPR-1028')
)
select t.sku_code, t.product_name, t.available_quantity as stock, t.is_active,
       (select count(*) from public.purchase_entries x where x.inventory_item_id = t.id) as batches,
       (select coalesce(sum(x.total_amount),0) from public.purchase_entries x where x.inventory_item_id = t.id) as purchase_value,
       (select count(*) from public.stock_movements x where x.inventory_item_id = t.id) as movements
from target t
order by t.sku_code;

-- How much the Purchases figure will drop by.
select count(*) as batches_removed, coalesce(sum(pe.total_amount), 0) as purchase_value_removed
from public.purchase_entries pe
join public.inventory_items i on i.id = pe.inventory_item_id
where i.sku_code in ('SPR-1001','SPR-1005','SPR-1009','SPR-1010','SPR-1011',
                     'SPR-1012','SPR-1013','SPR-1017','SPR-1028');

-- Still unresolved from Gokul's first list: what is BATCH-000093, and does
-- it belong to an item that is staying? If it does, deleting that row on
-- its own would leave the item's stock overstated — there is no trigger
-- that puts stock back. Use Edit Purchase in the app for that case.
select pe.batch_number, i.sku_code, i.product_name, pe.quantity,
       pe.remaining_quantity, pe.unit_price, pe.total_amount, pe.purchase_date::date
from public.purchase_entries pe
join public.inventory_items i on i.id = pe.inventory_item_id
where pe.batch_number = 'BATCH-000093';


-- ---------------------------------------------------------------------
-- STEP 1 — the delete. One transaction: all of it, or none of it.
-- ---------------------------------------------------------------------

begin;

create temporary table _items on commit drop as
  select id, sku_code from public.inventory_items
  where sku_code in ('SPR-1001','SPR-1005','SPR-1009','SPR-1010','SPR-1011',
                     'SPR-1012','SPR-1013','SPR-1017','SPR-1028');

create temporary table _batches on commit drop as
  select id from public.purchase_entries where inventory_item_id in (select id from _items);

-- Snapshot of what the online order page can serve right now. The guard at
-- the end compares against this rather than asserting a Track Tyre must
-- exist: a shop that never stocked them has nothing to lose, and an
-- absolute check would block it for no reason. What must not happen is a
-- position going from available to unavailable *because of this script*.
create temporary table _tyres_before on commit drop as
  select product_name, count(*) as active_count
  from public.inventory_items
  where item_type = 'TRACK_TYRE'
    and product_name in ('Track Tyre - Front', 'Track Tyre - Back')
    and is_active
  group by product_name;

do $$
declare
  v_items   integer;
  v_sales   integer;
  v_returns integer;
  v_service integer;
begin
  select count(*) into v_items from _items;
  if v_items <> 9 then
    raise exception 'Expected 9 items, matched % — check STEP 0 before continuing', v_items;
  end if;

  -- Re-checked here rather than trusted to the query that was run earlier:
  -- the shop is live, and a sale could have been rung up on one of these
  -- between reading STEP 0 and running this.
  select count(*) into v_sales   from public.sale_items              where inventory_item_id in (select id from _items);
  select count(*) into v_returns from public.sale_returns            where inventory_item_id in (select id from _items);
  select count(*) into v_service from public.service_inventory_usage where inventory_item_id in (select id from _items);

  if v_sales + v_returns + v_service > 0 then
    raise exception
      'These items are on % sale line(s), % return(s) and % service job(s). Deleting them would strip the cost out of bills that keep their revenue, inflating past profit. Nothing was deleted.',
      v_sales, v_returns, v_service;
  end if;

  raise notice 'Deleting % items', v_items;
end $$;

-- Catalogue links. The combo / package / service survives; it just no
-- longer lists this part.
delete from public.combo_components              where inventory_item_id in (select id from _items);
delete from public.general_service_package_items where inventory_item_id in (select id from _items);
delete from public.specific_service_items        where inventory_item_id in (select id from _items);

-- Purchase side — this is what takes them out of the Purchases figures.
delete from public.purchase_returns
 where inventory_item_id in (select id from _items)
    or purchase_entry_id in (select id from _batches);

delete from public.stock_movements
 where inventory_item_id in (select id from _items)
    or purchase_entry_id in (select id from _batches);

delete from public.purchase_entries where inventory_item_id in (select id from _items);

delete from public.inventory_items where id in (select id from _items);

-- No Track Tyre position that worked before this script may stop working
-- because of it. Not expected to fire here — none are on this list — but
-- the cost of being wrong is a customer paying for a tyre that can never
-- ship, so it is checked rather than assumed.
do $$
declare v_lost text;
begin
  select string_agg(b.product_name, ', ') into v_lost
  from _tyres_before b
  where not exists (
    select 1 from public.inventory_items i
     where i.item_type = 'TRACK_TYRE'
       and i.product_name = b.product_name
       and i.is_active
  );

  if v_lost is not null then
    raise exception
      'This would leave the online order page unable to sell: %. Nothing was deleted.', v_lost;
  end if;
end $$;

commit;


-- ---------------------------------------------------------------------
-- STEP 2 — confirm. Run this on its own: the SQL editor only shows the
-- last statement's result, so a single check beats four separate ones.
-- ---------------------------------------------------------------------

select 'sprockets still there' as check, count(*)::text as value
from public.inventory_items
where sku_code in ('SPR-1001','SPR-1005','SPR-1009','SPR-1010','SPR-1011',
                   'SPR-1012','SPR-1013','SPR-1017','SPR-1028')
union all
select 'active Track Tyre - Front', count(*)::text from public.inventory_items
 where item_type = 'TRACK_TYRE' and product_name = 'Track Tyre - Front' and is_active
union all
select 'active Track Tyre - Back', count(*)::text from public.inventory_items
 where item_type = 'TRACK_TYRE' and product_name = 'Track Tyre - Back' and is_active
union all
select 'purchase entries', count(*)::text from public.purchase_entries
union all
select 'purchase value', sum(total_amount)::text from public.purchase_entries;
-- Want: first row 0, the two Track Tyre rows 1 or more.
