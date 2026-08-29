-- =====================================================================
-- Twinspark GMS — remove every BRAKE PAD item
-- from Inventory, Purchases and everywhere else in the database.
-- =====================================================================
--
-- Match rule: product_name ILIKE '%brake pad%'
--
-- That catches all twelve seeded pads (BRK-1001 … BRK-1012, Front/Back
-- for MT, R15, NS, RS, KTM, RC) plus any older one whose name reads
-- "... Brake Pads". It deliberately does NOT catch BRAKE LEVER, or the
-- BRAKE_PART item *type* — the type stays, so brake levers and anything
-- else under it are unaffected, and new pads can be added under it again
-- later exactly as before.
--
-- Nothing in the application code names brake pads (checked — the only
-- hits are the BRAKE_PART type label and unrelated *service* names like
-- "Brake Bleeding"). This is purely data, so no deploy is needed.
--
-- STEP 1 previews. STEP 2 deletes, inside a transaction that refuses to
-- run if any of these pads appear on a past sale or service job.
--
-- ---------------------------------------------------------------------
-- STEP 1 — preview (safe, read-only). Run this on its own first.
-- ---------------------------------------------------------------------

-- 1a. The items that will be deleted. Read this list before going on.
select sku_code, product_name, item_type, available_quantity, is_active
from public.inventory_items
where product_name ilike '%brake pad%'
order by sku_code;

-- 1b. What else in the database points at them.
--     "sale_items", "sale_returns" and "service_inventory_usage" MUST be
--     0 — STEP 2 aborts otherwise (see the note under it).
with target as (
  select id from public.inventory_items where product_name ilike '%brake pad%'
)
select 'sale_items'                    as references_them, count(*) from public.sale_items              where inventory_item_id in (select id from target)
union all select 'sale_returns',                 count(*) from public.sale_returns                      where inventory_item_id in (select id from target)
union all select 'service_inventory_usage',      count(*) from public.service_inventory_usage           where inventory_item_id in (select id from target)
union all select 'purchase_entries',             count(*) from public.purchase_entries                  where inventory_item_id in (select id from target)
union all select 'purchase_returns',             count(*) from public.purchase_returns                  where inventory_item_id in (select id from target)
union all select 'stock_movements',              count(*) from public.stock_movements                   where inventory_item_id in (select id from target)
union all select 'combo_components',             count(*) from public.combo_components                  where inventory_item_id in (select id from target)
union all select 'general_service_package_items',count(*) from public.general_service_package_items     where inventory_item_id in (select id from target)
union all select 'specific_service_items',       count(*) from public.specific_service_items            where inventory_item_id in (select id from target)
order by 1;

-- 1c. Which combos / packages / services currently include a brake pad.
--     These keep working, but they will contain one part fewer — check
--     nothing here surprises you before running STEP 2.
with target as (
  select id from public.inventory_items where product_name ilike '%brake pad%'
)
select 'Combo' as kind, c.name, i.product_name as part_removed
  from public.combo_components cc
  join public.combos c on c.id = cc.combo_id
  join public.inventory_items i on i.id = cc.inventory_item_id
 where cc.inventory_item_id in (select id from target)
union all
select 'Service package', p.name, i.product_name
  from public.general_service_package_items gi
  join public.general_service_packages p on p.id = gi.general_service_package_id
  join public.inventory_items i on i.id = gi.inventory_item_id
 where gi.inventory_item_id in (select id from target)
union all
select 'Specific service', s.name, i.product_name
  from public.specific_service_items si
  join public.specific_services s on s.id = si.specific_service_id
  join public.inventory_items i on i.id = si.inventory_item_id
 where si.inventory_item_id in (select id from target)
order by 1, 2;


-- ---------------------------------------------------------------------
-- STEP 2 — the delete
--
-- Aborts and changes nothing if any of these pads appear on a past sale
-- or service job. That is on purpose: deleting a line off a completed
-- invoice would silently change a total the customer has already paid.
-- If it aborts, use the ALTERNATIVE at the bottom of this file instead.
-- ---------------------------------------------------------------------

begin;

-- Resolve the target ids once, so the match rule is stated in exactly one
-- place and cannot drift between statements.
create temporary table _pads on commit drop as
  select id from public.inventory_items where product_name ilike '%brake pad%';

create temporary table _pad_entries on commit drop as
  select id from public.purchase_entries where inventory_item_id in (select id from _pads);

do $$
declare
  v_sales   integer;
  v_returns integer;
  v_service integer;
begin
  select count(*) into v_sales   from public.sale_items              where inventory_item_id in (select id from _pads);
  select count(*) into v_returns from public.sale_returns            where inventory_item_id in (select id from _pads);
  select count(*) into v_service from public.service_inventory_usage where inventory_item_id in (select id from _pads);

  if v_sales + v_returns + v_service > 0 then
    raise exception
      'Brake pads appear on % sale line(s), % return(s) and % service job(s). Deleting them would change invoices that are already issued — nothing was deleted. Use the deactivate option instead.',
      v_sales, v_returns, v_service;
  end if;
end $$;

-- Catalogue links. The combo / package / service itself survives; it
-- just no longer lists a brake pad among its parts.
delete from public.combo_components              where inventory_item_id in (select id from _pads);
delete from public.general_service_package_items where inventory_item_id in (select id from _pads);
delete from public.specific_service_items        where inventory_item_id in (select id from _pads);

-- Purchase side. Returns reference both the item and its batch, and
-- stock movements reference the batch — so both go before the batches do.
delete from public.purchase_returns
 where inventory_item_id in (select id from _pads)
    or purchase_entry_id in (select id from _pad_entries);

delete from public.stock_movements
 where inventory_item_id in (select id from _pads)
    or purchase_entry_id in (select id from _pad_entries);

delete from public.purchase_entries where inventory_item_id in (select id from _pads);

-- Finally the items themselves.
delete from public.inventory_items where id in (select id from _pads);

commit;


-- ---------------------------------------------------------------------
-- STEP 3 — confirm. Both should come back with no rows / zero.
-- ---------------------------------------------------------------------

select sku_code, product_name
from public.inventory_items
where product_name ilike '%brake pad%';

select count(*) as brake_parts_remaining, count(*) filter (where is_active) as active
from public.inventory_items
where item_type = 'BRAKE_PART';


-- =====================================================================
-- ALTERNATIVE — if STEP 2 aborted because pads are on past invoices
-- =====================================================================
-- Deactivate instead of delete. The app filters every list, picker and
-- dropdown on is_active = true, so a deactivated pad disappears from
-- Inventory, New Sale, New Purchase and Service parts immediately, while
-- the invoices that reference it stay intact and printable.
--
-- This is the same thing the Delete button in the Inventory screen does,
-- just applied to all of them at once.
--
-- update public.inventory_items
--    set is_active = false
--  where product_name ilike '%brake pad%';
--
-- Re-adding later is unaffected either way: the uniqueness rule on item
-- names only applies to active items, so a new "BRAKE PAD - FRONT - MT"
-- can be created even while a deactivated one of the same name exists.
