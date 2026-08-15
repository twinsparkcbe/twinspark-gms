-- Seed a starter inventory catalog (dev/demo data).
--
-- Idempotent: brands upsert on their (name, item_type) unique key, items
-- upsert on their unique sku_code. Safe to re-run.
--
-- Two notes on how this differs from the app's normal write path:
--
-- 1) available_quantity is set DIRECTLY here, not via adjust_stock(). That
--    function requires an authenticated JWT with a role in user_metadata
--    (see 0001_inventory_schema.sql) which a migration doesn't have — it
--    runs as the DB owner and bypasses RLS. To keep the balance and the
--    movement ledger consistent, each seeded quantity also gets a matching
--    stock_movements row (reason PURCHASE, source_module 'SEED', created_by
--    null). resulting_balance equals the opening quantity since these are
--    the first movements for each item.
--
-- 2) Brands are scoped per item type (see 0006_brand_per_item_type.sql), so
--    a brand used under two types (Motul: Engine Oil + Coolant) is seeded as
--    two separate rows.
--
-- Type mapping for products without a dedicated enum value:
--   Air Filter, Spark Plug -> OTHER_SPARE_PART (custom_type_label carries the
--                             real category name shown on the badge)
--   Coolant                -> LUBRICANT (closest existing type)
-- Track Tyre / Used Track Tyre rows from the source sheet are intentionally
-- omitted.

-- ---------------------------------------------------------------------------
-- Brands (one row per name+type)
-- ---------------------------------------------------------------------------
insert into public.brands (name, item_type) values
  ('Michelin',   'BRAND_NEW_TYRE'),
  ('Motul',      'ENGINE_OIL'),
  ('Liqui Moly', 'ENGINE_OIL'),
  ('DID',        'CHAIN'),
  ('EBC',        'BRAKE_PART'),
  ('BMC',        'OTHER_SPARE_PART'),
  ('NGK',        'OTHER_SPARE_PART'),
  ('Motul',      'LUBRICANT')
on conflict (name, item_type) do nothing;

-- ---------------------------------------------------------------------------
-- Items
--
-- BRAND_NEW_TYRE requires brand_id (DB constraint). OTHER_SPARE_PART requires
-- a non-empty custom_type_label. All other types must have custom_type_label
-- null. brand_id is resolved by name+type sub-select against the rows above.
-- ---------------------------------------------------------------------------
insert into public.inventory_items
  (item_type, product_name, sku_code, brand_id, purchase_price, selling_price,
   low_stock_threshold, available_quantity, custom_type_label)
values
  ('BRAND_NEW_TYRE', 'Michelin Pilot Street 2 140/70 R17', 'TYR-0001',
     (select id from public.brands where name = 'Michelin'   and item_type = 'BRAND_NEW_TYRE'),
     5800, 6800, 5, 20, null),

  ('ENGINE_OIL', 'Motul 7100 10W40 1L', 'OIL-0001',
     (select id from public.brands where name = 'Motul'      and item_type = 'ENGINE_OIL'),
     900, 1250, 10, 45, null),

  ('ENGINE_OIL', 'Liqui Moly Street Race 10W50 1L', 'OIL-0002',
     (select id from public.brands where name = 'Liqui Moly' and item_type = 'ENGINE_OIL'),
     1250, 1650, 8, 30, null),

  ('CHAIN', 'DID 520VX3 Chain & Sprocket Kit', 'CHN-0001',
     (select id from public.brands where name = 'DID'        and item_type = 'CHAIN'),
     5200, 6800, 4, 12, null),

  ('BRAKE_PART', 'EBC Double-H Front Brake Pads', 'BRK-0001',
     (select id from public.brands where name = 'EBC'        and item_type = 'BRAKE_PART'),
     1450, 2100, 6, 18, null),

  ('OTHER_SPARE_PART', 'BMC Performance Air Filter (R15 V4)', 'AFR-0001',
     (select id from public.brands where name = 'BMC'        and item_type = 'OTHER_SPARE_PART'),
     3200, 4100, 3, 10, 'Air Filter'),

  ('OTHER_SPARE_PART', 'NGK Iridium CR9EIX', 'SPK-0001',
     (select id from public.brands where name = 'NGK'        and item_type = 'OTHER_SPARE_PART'),
     550, 850, 10, 35, 'Spark Plug'),

  ('LUBRICANT', 'Motul Motocool Expert 1L', 'CLT-0001',
     (select id from public.brands where name = 'Motul'      and item_type = 'LUBRICANT'),
     450, 700, 8, 25, null)
on conflict (sku_code) do nothing;

-- ---------------------------------------------------------------------------
-- Opening-stock movement ledger — one PURCHASE row per seeded item so the
-- movement history matches available_quantity. Only for items that actually
-- got inserted above (left join guards against a re-run where the item
-- already existed and shouldn't get a second opening movement).
-- ---------------------------------------------------------------------------
insert into public.stock_movements
  (inventory_item_id, delta, resulting_balance, reason, source_module, note, created_by)
select i.id, i.available_quantity, i.available_quantity, 'PURCHASE', 'SEED', 'Opening stock (seed)', null
from public.inventory_items i
where i.sku_code in ('TYR-0001','OIL-0001','OIL-0002','CHN-0001','BRK-0001','AFR-0001','SPK-0001','CLT-0001')
  and not exists (
    select 1 from public.stock_movements m where m.inventory_item_id = i.id
  );
