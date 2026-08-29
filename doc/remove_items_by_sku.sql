-- =====================================================================
-- Twinspark GMS — remove specific inventory items by SKU
-- Currently set to remove:  SKU-00004, SKU-00005, SKU-00011
-- =====================================================================
--
-- Auto-generated SKUs in this app look like SKU-00004 (five digits, zero
-- padded), so "4, 5, 11" is SKU-00004 / SKU-00005 / SKU-00011. If the items
-- you mean carry a different code — the seeded catalogue uses TYR-1001,
-- BRK-1002, SPR-1003 and so on — run STEP 0 first and put the real codes in
-- the list at STEP 1.
--
-- Removing an item takes its purchase batches and its stock history with it,
-- because Postgres will not let those rows point at something that no longer
-- exists. That is the whole cost of a hard delete, and it is why STEP 0 is
-- worth ten seconds.
--
-- ---------------------------------------------------------------------
-- STEP 0 — find them (safe, read-only). Run this on its own first.
-- ---------------------------------------------------------------------
-- Anything whose SKU ends in 4, 5 or 11, in any format, so you can see
-- exactly which code you actually mean before naming it below.

select id, sku_code, product_name, item_type, brand_id, available_quantity, is_active
from public.inventory_items
where sku_code in ('SKU-00004', 'SKU-00005', 'SKU-00011')
   or sku_code ~ '(^|[^0-9])0*(4|5|11)$'
order by sku_code;


-- ---------------------------------------------------------------------
-- STEP 1 — confirm exactly what will be deleted (safe, read-only)
--
-- EDIT THE LIST if STEP 0 showed different codes. It appears here and
-- again in STEP 2 — change BOTH, or you will preview one set and delete
-- another.
-- ---------------------------------------------------------------------

-- 1a. The items themselves. Read this list before going on.
select sku_code, product_name, item_type, available_quantity, is_active
from public.inventory_items
where sku_code in ('SKU-00004', 'SKU-00005', 'SKU-00011')
order by sku_code;

-- 1b. Everything in the database that points at them.
--     "sale_items", "sale_returns" and "service_inventory_usage" MUST be 0 —
--     STEP 2 aborts otherwise (see the note under it).
with target as (
  select id from public.inventory_items
   where sku_code in ('SKU-00004', 'SKU-00005', 'SKU-00011')
)
select 'sale_items'                     as references_them, count(*) from public.sale_items                  where inventory_item_id in (select id from target)
union all select 'sale_returns',                  count(*) from public.sale_returns                          where inventory_item_id in (select id from target)
union all select 'service_inventory_usage',       count(*) from public.service_inventory_usage               where inventory_item_id in (select id from target)
union all select 'purchase_entries',              count(*) from public.purchase_entries                      where inventory_item_id in (select id from target)
union all select 'purchase_returns',              count(*) from public.purchase_returns                      where inventory_item_id in (select id from target)
union all select 'stock_movements',               count(*) from public.stock_movements                       where inventory_item_id in (select id from target)
union all select 'combo_components',              count(*) from public.combo_components                      where inventory_item_id in (select id from target)
union all select 'general_service_package_items', count(*) from public.general_service_package_items         where inventory_item_id in (select id from target)
union all select 'specific_service_items',        count(*) from public.specific_service_items                where inventory_item_id in (select id from target)
order by 1;

-- 1c. Which combos / packages / services currently include one of them.
--     These keep working, but they will contain one part fewer.
with target as (
  select id from public.inventory_items
   where sku_code in ('SKU-00004', 'SKU-00005', 'SKU-00011')
)
select 'Combo' as kind, c.name, i.sku_code, i.product_name as part_removed
  from public.combo_components cc
  join public.combos c on c.id = cc.combo_id
  join public.inventory_items i on i.id = cc.inventory_item_id
 where cc.inventory_item_id in (select id from target)
union all
select 'Service package', p.name, i.sku_code, i.product_name
  from public.general_service_package_items gi
  join public.general_service_packages p on p.id = gi.general_service_package_id
  join public.inventory_items i on i.id = gi.inventory_item_id
 where gi.inventory_item_id in (select id from target)
union all
select 'Specific service', s.name, i.sku_code, i.product_name
  from public.specific_service_items si
  join public.specific_services s on s.id = si.specific_service_id
  join public.inventory_items i on i.id = si.inventory_item_id
 where si.inventory_item_id in (select id from target)
order by 1, 2;


-- ---------------------------------------------------------------------
-- STEP 2 — the delete
--
-- Aborts and changes nothing if any of these items appear on a past sale
-- or service job. Deleting a line off a completed invoice would silently
-- change a total the customer has already paid. If it aborts, use the
-- ALTERNATIVE at the bottom instead.
--
-- ORDER MATTERS. Every foreign key here is ON DELETE RESTRICT, so children
-- must go before parents or Postgres refuses.
-- ---------------------------------------------------------------------

begin;

-- The list lives in exactly one place from here on, so the guard, the
-- deletes and the count can never disagree about which items they mean.
create temporary table _victims on commit drop as
  select id, sku_code from public.inventory_items
   where sku_code in ('SKU-00004', 'SKU-00005', 'SKU-00011');

create temporary table _victim_entries on commit drop as
  select id from public.purchase_entries where inventory_item_id in (select id from _victims);

do $$
declare
  v_found   integer;
  v_sales   integer;
  v_returns integer;
  v_service integer;
begin
  select count(*) into v_found from _victims;
  if v_found = 0 then
    raise exception 'No item matches those SKU codes — check STEP 0 and correct the list';
  end if;

  select count(*) into v_sales   from public.sale_items              where inventory_item_id in (select id from _victims);
  select count(*) into v_returns from public.sale_returns            where inventory_item_id in (select id from _victims);
  select count(*) into v_service from public.service_inventory_usage where inventory_item_id in (select id from _victims);

  if v_sales + v_returns + v_service > 0 then
    raise exception
      'These items appear on % sale line(s), % return(s) and % service job(s). Deleting them would change invoices that are already issued — nothing was deleted. Use the deactivate option instead.',
      v_sales, v_returns, v_service;
  end if;

  raise notice 'Deleting % item(s)', v_found;
end $$;

-- Catalogue links. The combo / package / service itself survives; it just
-- no longer lists this part.
delete from public.combo_components              where inventory_item_id in (select id from _victims);
delete from public.general_service_package_items where inventory_item_id in (select id from _victims);
delete from public.specific_service_items        where inventory_item_id in (select id from _victims);

-- Purchase side. Returns reference both the item and its batch, and stock
-- movements reference the batch — so both go before the batches do.
delete from public.purchase_returns
 where inventory_item_id in (select id from _victims)
    or purchase_entry_id in (select id from _victim_entries);

delete from public.stock_movements
 where inventory_item_id in (select id from _victims)
    or purchase_entry_id in (select id from _victim_entries);

delete from public.purchase_entries where inventory_item_id in (select id from _victims);

-- Finally the items themselves.
delete from public.inventory_items where id in (select id from _victims);

commit;


-- ---------------------------------------------------------------------
-- STEP 3 — confirm. Should return no rows.
-- ---------------------------------------------------------------------

select sku_code, product_name
from public.inventory_items
where sku_code in ('SKU-00004', 'SKU-00005', 'SKU-00011');


-- =====================================================================
-- ALTERNATIVE — if STEP 2 aborted because the items are on past invoices
-- =====================================================================
-- Deactivate instead of delete. The app filters every list, picker and
-- dropdown on is_active = true, so a deactivated item disappears from
-- Inventory, New Sale, New Purchase and Service parts immediately, while
-- the invoices that reference it stay intact and printable. This is the
-- same thing the Delete button in the Inventory screen does.
--
-- update public.inventory_items
--    set is_active = false
--  where sku_code in ('SKU-00004', 'SKU-00005', 'SKU-00011');
--
-- Re-adding later works either way: the name-uniqueness rule only applies
-- to active items.
