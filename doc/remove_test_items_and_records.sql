-- =====================================================================
-- Twinspark GMS — remove named test items, sales and service jobs
-- =====================================================================
--
-- Three lists, named once each at STEP 2 and used everywhere after that:
--
--   ITEMS    SPR-1015, SPR-1016, SPR-1021, SPR-1025, SPR-1026,
--            SKU-00004, SKU-00011
--   SALES    TW-S-000001, TW-S-000002, TW-S-000003
--   JOBS     SJ-000001, SJ-000002, SJ-000003, SJ-000004,
--            SJ-000006, SJ-000007
--
-- SKU-00005 (Track Tyre - Back) is deliberately NOT here — it is the
-- active Back item the public order page prices and dispatches against.
--
-- Deleting an item takes its purchase batches with it, which is the point:
-- the Purchases list and its totals stop counting stock-ins for things the
-- shop does not carry.
--
-- ---------------------------------------------------------------------
-- STEP 0 — what are these items? (safe, read-only)
-- ---------------------------------------------------------------------

select i.sku_code,
       i.product_name,
       i.item_type,
       i.custom_type_label            as specified_type,
       b.name                         as brand,
       i.purchase_price,
       i.selling_price,
       i.available_quantity,
       i.stock_status,
       i.is_active,
       i.created_at::date             as added_on
from public.inventory_items i
left join public.brands b on b.id = i.brand_id
where i.sku_code in ('SPR-1015','SPR-1016','SPR-1021','SPR-1025','SPR-1026','SKU-00004','SKU-00011')
order by i.sku_code;

-- What is attached to each one, and what it is worth.
with target as (
  select id, sku_code from public.inventory_items
  where sku_code in ('SPR-1015','SPR-1016','SPR-1021','SPR-1025','SPR-1026','SKU-00004','SKU-00011')
)
select t.sku_code,
       (select count(*)              from public.sale_items              x where x.inventory_item_id = t.id) as sale_lines,
       (select count(*)              from public.sale_returns            x where x.inventory_item_id = t.id) as sale_returns,
       (select count(*)              from public.service_inventory_usage x where x.inventory_item_id = t.id) as service_uses,
       (select count(*)              from public.purchase_entries        x where x.inventory_item_id = t.id) as batches,
       (select coalesce(sum(x.total_amount),0) from public.purchase_entries x where x.inventory_item_id = t.id) as purchase_value,
       (select count(*)              from public.stock_movements         x where x.inventory_item_id = t.id) as movements,
       (select count(*)              from public.combo_components        x where x.inventory_item_id = t.id) as in_combos
from target t
order by t.sku_code;


-- ---------------------------------------------------------------------
-- STEP 1 — what the deletion will remove (safe, read-only)
-- ---------------------------------------------------------------------

-- 1a. The sales and service jobs named above, with what they are worth.
select 'Sale' as kind, s.invoice_number as reference, c.name as customer,
       s.sale_date::date as dated, s.grand_total,
       (select count(*) from public.sale_items x where x.sale_id = s.id) as lines
from public.sales s join public.customers c on c.id = s.customer_id
where s.invoice_number in ('TW-S-000001','TW-S-000002','TW-S-000003')
union all
select 'Service job', j.job_number, c.name, j.created_at::date, j.grand_total,
       (select count(*) from public.service_job_lines x where x.service_job_id = j.id)
from public.service_jobs j join public.customers c on c.id = j.customer_id
where j.job_number in ('SJ-000001','SJ-000002','SJ-000003','SJ-000004','SJ-000006','SJ-000007')
order by kind, reference;

-- 1b. THE ONE THAT MATTERS. Any sale or job that is NOT on the delete list
--     but still uses one of the items. Every row here is an invoice that
--     would be damaged — STEP 2 refuses to run while any exist.
with target as (
  select id, sku_code from public.inventory_items
  where sku_code in ('SPR-1015','SPR-1016','SPR-1021','SPR-1025','SPR-1026','SKU-00004','SKU-00011')
)
select 'Sale not on the list' as problem, s.invoice_number as reference, t.sku_code, si.quantity
from public.sale_items si
join target t on t.id = si.inventory_item_id
join public.sales s on s.id = si.sale_id
where s.invoice_number not in ('TW-S-000001','TW-S-000002','TW-S-000003')
union all
select 'Service job not on the list', j.job_number, t.sku_code, u.quantity_used
from public.service_inventory_usage u
join target t on t.id = u.inventory_item_id
join public.service_jobs j on j.id = u.service_job_id
where j.job_number not in ('SJ-000001','SJ-000002','SJ-000003','SJ-000004','SJ-000006','SJ-000007')
order by 1, 2;


-- ---------------------------------------------------------------------
-- STEP 2 — the delete. One transaction: all of it, or none of it.
-- ---------------------------------------------------------------------

begin;

-- The three lists, named once. Everything below reads from these, so the
-- guards and the deletes can never disagree about what they mean.
create temporary table _items on commit drop as
  select id, sku_code from public.inventory_items
  where sku_code in ('SPR-1015','SPR-1016','SPR-1021','SPR-1025','SPR-1026','SKU-00004','SKU-00011');

create temporary table _sales on commit drop as
  select id, invoice_number from public.sales
  where invoice_number in ('TW-S-000001','TW-S-000002','TW-S-000003');

create temporary table _jobs on commit drop as
  select id, job_number from public.service_jobs
  where job_number in ('SJ-000001','SJ-000002','SJ-000003','SJ-000004','SJ-000006','SJ-000007');

create temporary table _batches on commit drop as
  select id from public.purchase_entries where inventory_item_id in (select id from _items);

do $$
declare
  v_items integer;
begin
  select count(*) into v_items from _items;
  if v_items = 0 then
    raise exception 'No item matched those SKU codes — check STEP 0 and correct the list';
  end if;
  raise notice 'Deleting % item(s), % sale(s), % service job(s)',
    v_items, (select count(*) from _sales), (select count(*) from _jobs);
end $$;

-- --- Service jobs on the list, children first -------------------------
delete from public.service_inventory_usage where service_job_id in (select id from _jobs);
delete from public.service_job_events       where service_job_id in (select id from _jobs);
delete from public.service_job_images       where service_job_id in (select id from _jobs);
delete from public.service_job_lines        where service_job_id in (select id from _jobs);
delete from public.service_jobs             where id             in (select id from _jobs);

-- --- Sales on the list, children first --------------------------------
-- Whole sales, not just the lines that use these items: a sale's totals are
-- stored on the sales row and are NOT recalculated from its lines, so
-- removing one line would leave an invoice printing a grand total that its
-- own line items no longer add up to.
delete from public.sale_returns where sale_item_id in (select id from public.sale_items where sale_id in (select id from _sales));
delete from public.sale_events  where sale_id in (select id from _sales);
delete from public.sale_items   where sale_id in (select id from _sales);
delete from public.sales        where id      in (select id from _sales);

-- --- Guard: nothing outside those lists may still need these items ----
do $$
declare
  v_sales   integer;
  v_returns integer;
  v_service integer;
begin
  select count(*) into v_sales   from public.sale_items              where inventory_item_id in (select id from _items);
  select count(*) into v_returns from public.sale_returns            where inventory_item_id in (select id from _items);
  select count(*) into v_service from public.service_inventory_usage where inventory_item_id in (select id from _items);

  if v_sales + v_returns + v_service > 0 then
    raise exception
      'After deleting the listed sales and jobs, these items are STILL on % sale line(s), % return(s) and % service job(s) that were not listed. Nothing was deleted — run STEP 1b to see which.',
      v_sales, v_returns, v_service;
  end if;
end $$;

-- --- Catalogue links --------------------------------------------------
-- The combo / package / service survives; it just no longer lists this part.
delete from public.combo_components              where inventory_item_id in (select id from _items);
delete from public.general_service_package_items where inventory_item_id in (select id from _items);
delete from public.specific_service_items        where inventory_item_id in (select id from _items);

-- --- Purchase side ----------------------------------------------------
-- This is what fixes the Purchases list: the batches for these items go, so
-- their cost stops counting toward purchase totals.
delete from public.purchase_returns
 where inventory_item_id in (select id from _items)
    or purchase_entry_id in (select id from _batches);

delete from public.stock_movements
 where inventory_item_id in (select id from _items)
    or purchase_entry_id in (select id from _batches);

delete from public.purchase_entries where inventory_item_id in (select id from _items);

-- --- The items --------------------------------------------------------
delete from public.inventory_items where id in (select id from _items);

-- --- Guard: the public order page must still work ---------------------
-- get_track_tyre_prices() and dispatch_online_order() both look up the
-- ACTIVE item named "Track Tyre - Front" / "Track Tyre - Back". Lose either
-- and /order stops pricing that position and dispatch fails outright. This
-- is checked here rather than trusted to the list above, because the cost of
-- getting it wrong is a customer paying for a tyre that can never ship.
do $$
declare
  v_front integer;
  v_back  integer;
begin
  select count(*) into v_front from public.inventory_items
   where item_type = 'TRACK_TYRE' and product_name = 'Track Tyre - Front' and is_active;
  select count(*) into v_back from public.inventory_items
   where item_type = 'TRACK_TYRE' and product_name = 'Track Tyre - Back' and is_active;

  if v_front = 0 or v_back = 0 then
    raise exception
      'This would leave the online order page with no active Track Tyre (Front: %, Back: %). Nothing was deleted.',
      v_front, v_back;
  end if;
end $$;

commit;


-- ---------------------------------------------------------------------
-- STEP 3 — confirm
-- ---------------------------------------------------------------------

-- All three should return no rows.
select sku_code, product_name from public.inventory_items
where sku_code in ('SPR-1015','SPR-1016','SPR-1021','SPR-1025','SPR-1026','SKU-00004','SKU-00011');

select invoice_number from public.sales
where invoice_number in ('TW-S-000001','TW-S-000002','TW-S-000003');

select job_number from public.service_jobs
where job_number in ('SJ-000001','SJ-000002','SJ-000003','SJ-000004','SJ-000006','SJ-000007');

-- The order page still has both positions priced.
select * from public.get_track_tyre_prices();

-- Purchases now total only what the shop actually carries.
select count(*) as purchase_entries, sum(total_amount) as total_purchase_value
from public.purchase_entries;
