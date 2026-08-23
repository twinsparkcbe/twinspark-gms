-- Seed the client's real inventory catalogue — 90 SKUs from their price
-- list (doc/Twinspark_Inventory_Import.xlsx, returned completed 2026-08-23).
--
-- WHY THIS GOES THROUGH create_inventory_item_with_purchase() RATHER THAN
-- PLAIN INSERTS: adjust_stock()'s FIFO decrease path consumes
-- purchase_entries.remaining_quantity, never inventory_items.
-- available_quantity directly. An item whose quantity was written straight
-- into the column has a cached total with no batch behind it, so Sales and
-- Service can never sell it — FIFO finds zero eligible batches and raises
-- "Insufficient stock" while the UI cheerfully shows stock available. That
-- is exactly the bug 0014_reconcile_stray_available_quantity.sql was written
-- to clean up after 0007's seed rows. Going through the app's own function
-- gives every item a real batch, a stock_movements audit row, and correctly
-- synced reference prices — identical to what Purchases -> Record Purchase
-- produces by hand.
--
-- THE JWT SHIM: create_inventory_item_with_purchase() and adjust_stock() both
-- gate on (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'. Run from the
-- Supabase SQL editor there is no JWT at all, so both would refuse. Rather
-- than reimplementing their logic here (which would silently drift from the
-- app the first time either changes), the block below sets the claim for the
-- duration of its own transaction only — set_config(..., is_local => true)
-- reverts on commit and affects nothing else.
--
-- NON-DESTRUCTIVE: existing items are left completely alone. 0007's demo
-- SKUs (OIL-0001, TYR-0001, ...) and anything recorded during testing already
-- carry purchase entries and possibly sales, so deleting them would orphan
-- real history. Deactivate them by hand in Purchases if they're unwanted.
-- Re-running this file is a no-op: every insert is guarded on sku_code.
--
-- SPELLING CORRECTED FROM THE CLIENT'S SHEET (revert here if intended):
--   'Geniune Parts' -> 'Genuine Parts'   (12 items)
--   'Ktm' -> 'KTM', 'Prs' -> 'PRS'
--   23 items the client left as 'TO CONFIRM' are assigned a per-type
--   'Generic' brand; the client can reassign them any time via
--   Purchases -> Edit Item Details, which is what that dialog is for.
--
-- CUSTOM TYPE LABELS: inventory_items_custom_type_label_rule (0003) makes
-- custom_type_label mandatory for OTHER_SPARE_PART and forbidden for every
-- other type — it is the "Specify Type" field in Purchases -> Edit Item
-- Details. The client's sheet has no such column, so the 16 affected rows
-- carry a sensible label chosen here (Fastener, Lever, Cable, Spark Plug,
-- Air Filter, Rubber Bush, Oil Filter, Bearing, Key Set). "MOUTH" is labelled
-- 'Unclassified' because nobody has yet established what that item is.
-- All of them are editable afterwards in that dialog.
--
-- OPENING STOCK is 50 for every item, per the developer's instruction. It is
-- NOT a counted figure — the client's sheet had an empty stock column. That
-- is 4,500 units and roughly Rs 36.9 lakh of stock value, which will show in
-- the Dashboard, Inventory Value and Ageing Stock reports. Replace 50 with a
-- real count before the client relies on those numbers.

-- ---------------------------------------------------------------------------
-- 1. Brands. Unique on (name, item_type) since 0006, so the same name can
--    legitimately exist under two types and each pair is inserted once.
-- ---------------------------------------------------------------------------

insert into public.brands (name, item_type) values
  ('Apollo', 'BRAND_NEW_TYRE'),
  ('Bajaj', 'OTHER_SPARE_PART'),
  ('Ceat', 'BRAND_NEW_TYRE'),
  ('Gabriel', 'BRAND_NEW_TYRE'),
  ('Generic', 'ACCESSORY'),
  ('Generic', 'BRAKE_PART'),
  ('Generic', 'CHAIN'),
  ('Generic', 'LUBRICANT'),
  ('Generic', 'OTHER_SPARE_PART'),
  ('Genuine Parts', 'BRAKE_PART'),
  ('KTM', 'OTHER_SPARE_PART'),
  ('Motul', 'ENGINE_OIL'),
  ('Moxey', 'ACCESSORY'),
  ('PRS', 'BRAND_NEW_TYRE'),
  ('Rolon', 'SPROCKET_KIT'),
  ('Yamaha', 'OTHER_SPARE_PART')
on conflict (name, item_type) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Items + their opening purchase batch.
-- ---------------------------------------------------------------------------

do $$
declare
  v_brand_id uuid;
  v_seeded   integer := 0;
  v_skipped  integer := 0;
  r          record;
begin
  -- Scoped to this transaction only (is_local => true).
  perform set_config('request.jwt.claims', '{"user_metadata":{"role":"admin"}}', true);

  for r in
    select * from (values
      ('OIL-1001', 'ENGINE_OIL'::public.item_type, 'MOTUL - 7100', 'Motul', 772.00, 1100.00, 50, 5, null),
      ('SPR-1001', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - MT', 'Rolon', 1890.00, 2718.00, 50, 5, null),
      ('SPR-1002', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - R15', 'Rolon', 1596.00, 2218.00, 50, 5, null),
      ('SPR-1003', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - R15 V1/FZR', 'Rolon', 1923.00, 2500.00, 50, 5, null),
      ('SPR-1004', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - NS', 'Rolon', 1843.00, 2703.00, 50, 5, null),
      ('SPR-1005', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - RS', 'Rolon', 1843.00, 2591.00, 50, 5, null),
      ('SPR-1006', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - DUKE 390 GEN1', 'Rolon', 2468.00, 3428.00, 50, 5, null),
      ('SPR-1007', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - DUKE 390 GEN2', 'Rolon', 2468.00, 3428.00, 50, 5, null),
      ('SPR-1008', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - DUKE 390 GEN3', 'Rolon', 2468.00, 3308.00, 50, 5, null),
      ('SPR-1009', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - DUKE 200 GEN1', 'Rolon', 2330.00, 3236.00, 50, 5, null),
      ('SPR-1010', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - DUKE 200 GEN2', 'Rolon', 2330.00, 3236.00, 50, 5, null),
      ('SPR-1011', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - DUKE 200 GEN3', 'Rolon', 2330.00, 3236.00, 50, 5, null),
      ('SPR-1012', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - DUKE 250 GEN1', 'Rolon', 1773.00, 3672.00, 50, 5, null),
      ('SPR-1013', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - DUKE 250 GEN2', 'Rolon', 1773.00, 3672.00, 50, 5, null),
      ('SPR-1014', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - DUKE 250 GEN3', 'Rolon', 1773.00, 3339.00, 50, 5, null),
      ('SPR-1015', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - DUKE 125 GEN1', 'Rolon', 1773.00, 2867.00, 50, 5, null),
      ('SPR-1016', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - DUKE 125 GEN2', 'Rolon', 1773.00, 2867.00, 50, 5, null),
      ('SPR-1017', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - DUKE 125 GEN3', 'Rolon', 1773.00, 2867.00, 50, 5, null),
      ('SPR-1018', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - RC 390 GEN1', 'Rolon', 1773.00, 3428.00, 50, 5, null),
      ('SPR-1019', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - RC 390 GEN2', 'Rolon', 1773.00, 3428.00, 50, 5, null),
      ('SPR-1020', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - RC 390 GEN3', 'Rolon', 1773.00, 3308.00, 50, 5, null),
      ('SPR-1021', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - RC 200 GEN1', 'Rolon', 1773.00, 2584.00, 50, 5, null),
      ('SPR-1022', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - RC 200 GEN2', 'Rolon', 1773.00, 2584.00, 50, 5, null),
      ('SPR-1023', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - RC 200 GEN3', 'Rolon', 1773.00, 2584.00, 50, 5, null),
      ('SPR-1024', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - RC 125 GEN1', 'Rolon', 1773.00, 2867.00, 50, 5, null),
      ('SPR-1025', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - RC 125 GEN2', 'Rolon', 1773.00, 2867.00, 50, 5, null),
      ('SPR-1026', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - RC 125 GEN3', 'Rolon', 1773.00, 2867.00, 50, 5, null),
      ('SPR-1027', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - DOMINOR 250', 'Rolon', 2258.00, 3138.00, 50, 5, null),
      ('SPR-1028', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - DOMINOR 400', 'Rolon', 2258.00, 3899.00, 50, 5, null),
      ('SPR-1029', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - PULSER 220', 'Rolon', 1808.00, 2680.00, 50, 5, null),
      ('SPR-1030', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - METOR/CLASSIC/HUNTER 35OCC', 'Rolon', 1808.00, 1985.00, 50, 5, null),
      ('SPR-1031', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - HIMALAYAN 411', 'Rolon', 1808.00, 3251.00, 50, 5, null),
      ('SPR-1032', 'SPROCKET_KIT'::public.item_type, 'CHAIN SPROCKET - HIMALAYAN 450', 'Rolon', 1808.00, 3999.00, 50, 5, null),
      ('BRK-1001', 'BRAKE_PART'::public.item_type, 'BRAKE PAD - FRONT - MT', 'Genuine Parts', 98.00, 220.00, 50, 5, null),
      ('BRK-1002', 'BRAKE_PART'::public.item_type, 'BRAKE PAD - FRONT - R15', 'Genuine Parts', 98.00, 220.00, 50, 5, null),
      ('BRK-1003', 'BRAKE_PART'::public.item_type, 'BRAKE PAD - FRONT - NS', 'Genuine Parts', 98.00, 230.00, 50, 5, null),
      ('BRK-1004', 'BRAKE_PART'::public.item_type, 'BRAKE PAD - FRONT - RS', 'Genuine Parts', 98.00, 230.00, 50, 5, null),
      ('BRK-1005', 'BRAKE_PART'::public.item_type, 'BRAKE PAD - FRONT - KTM', 'Genuine Parts', 100.00, 240.00, 50, 5, null),
      ('BRK-1006', 'BRAKE_PART'::public.item_type, 'BRAKE PAD - FRONT - RC', 'Genuine Parts', 100.00, 240.00, 50, 5, null),
      ('BRK-1007', 'BRAKE_PART'::public.item_type, 'BRAKE PAD - BACK - MT', 'Genuine Parts', 98.00, 240.00, 50, 5, null),
      ('BRK-1008', 'BRAKE_PART'::public.item_type, 'BRAKE PAD - BACK - R15', 'Genuine Parts', 98.00, 240.00, 50, 5, null),
      ('BRK-1009', 'BRAKE_PART'::public.item_type, 'BRAKE PAD - BACK - NS', 'Genuine Parts', 98.00, 240.00, 50, 5, null),
      ('BRK-1010', 'BRAKE_PART'::public.item_type, 'BRAKE PAD - BACK - RS', 'Genuine Parts', 98.00, 240.00, 50, 5, null),
      ('BRK-1011', 'BRAKE_PART'::public.item_type, 'BRAKE PAD - BACK - KTM', 'Genuine Parts', 98.00, 240.00, 50, 5, null),
      ('BRK-1012', 'BRAKE_PART'::public.item_type, 'BRAKE PAD - BACK - RC', 'Genuine Parts', 98.00, 240.00, 50, 5, null),
      ('LUB-1001', 'LUBRICANT'::public.item_type, 'COOLANT', 'Generic', 41.00, 150.00, 50, 5, null),
      ('BRK-1013', 'BRAKE_PART'::public.item_type, 'DISC OIL', 'Generic', 72.00, 150.00, 50, 5, null),
      ('LUB-1002', 'LUBRICANT'::public.item_type, 'CHAIN LUBE', 'Generic', 128.00, 168.00, 50, 5, null),
      ('ACC-1001', 'ACCESSORY'::public.item_type, 'INDICATOR', 'Moxey', 100.00, 300.00, 50, 5, null),
      ('ACC-1002', 'ACCESSORY'::public.item_type, 'NUMBER PLATE', 'Generic', 100.00, 300.00, 50, 5, null),
      ('PRT-1001', 'OTHER_SPARE_PART'::public.item_type, 'BOLT', 'Generic', 5.00, 20.00, 50, 5, 'Fastener'),
      ('BRK-1014', 'BRAKE_PART'::public.item_type, 'BRAKE LEVER', 'Generic', 215.00, 300.00, 50, 5, null),
      ('PRT-1002', 'OTHER_SPARE_PART'::public.item_type, 'CLUTCH LEVER', 'Generic', 280.00, 300.00, 50, 5, 'Lever'),
      ('PRT-1003', 'OTHER_SPARE_PART'::public.item_type, 'ACCELERATOR CABLE', 'Generic', 408.00, 602.00, 50, 5, 'Cable'),
      ('ACC-1003', 'ACCESSORY'::public.item_type, 'HANDLE BAR', 'Generic', 1100.00, 1800.00, 50, 5, null),
      ('ACC-1004', 'ACCESSORY'::public.item_type, 'TAIL TIDY', 'Generic', 100.00, 300.00, 50, 5, null),
      ('LUB-1003', 'LUBRICANT'::public.item_type, 'FORK OIL', 'Generic', 70.00, 180.00, 50, 5, null),
      ('PRT-1004', 'OTHER_SPARE_PART'::public.item_type, 'SPARK PLUG - NORMAL', 'Generic', 80.00, 150.00, 50, 5, 'Spark Plug'),
      ('PRT-1005', 'OTHER_SPARE_PART'::public.item_type, 'SPARK PLUG - IRIDIUM', 'Generic', 437.00, 890.00, 50, 5, 'Spark Plug'),
      ('PRT-1006', 'OTHER_SPARE_PART'::public.item_type, 'AIR FILTER - YAMAHA', 'Yamaha', 133.00, 350.00, 50, 5, 'Air Filter'),
      ('PRT-1007', 'OTHER_SPARE_PART'::public.item_type, 'AIR FILTER - KTM', 'KTM', 110.00, 420.00, 50, 5, 'Air Filter'),
      ('PRT-1008', 'OTHER_SPARE_PART'::public.item_type, 'AIR FILTER - BAJAJ', 'Bajaj', 110.00, 420.00, 50, 5, 'Air Filter'),
      ('PRT-1009', 'OTHER_SPARE_PART'::public.item_type, 'RUBBER BUSH - YAMAHA', 'Yamaha', 70.00, 200.00, 50, 5, 'Rubber Bush'),
      ('PRT-1010', 'OTHER_SPARE_PART'::public.item_type, 'RUBBER BUSH - KTM', 'KTM', 60.00, 482.00, 50, 5, 'Rubber Bush'),
      ('PRT-1011', 'OTHER_SPARE_PART'::public.item_type, 'RUBBER BUSH - BAJAJ', 'Bajaj', 60.00, 200.00, 50, 5, 'Rubber Bush'),
      ('PRT-1012', 'OTHER_SPARE_PART'::public.item_type, 'OIL FILTER - Yamaha', 'Yamaha', 42.00, 120.00, 50, 5, 'Oil Filter'),
      ('PRT-1013', 'OTHER_SPARE_PART'::public.item_type, 'OIL FILTER - Ktm', 'KTM', 60.00, 160.00, 50, 5, 'Oil Filter'),
      ('BRK-1015', 'BRAKE_PART'::public.item_type, 'DISC PLATE', 'Generic', 900.00, 1200.00, 50, 5, null),
      ('LUB-1004', 'LUBRICANT'::public.item_type, 'PACKING PASTE', 'Generic', 35.00, 50.00, 50, 5, null),
      ('LUB-1005', 'LUBRICANT'::public.item_type, 'ENGINE FLUSH', 'Generic', 110.00, 200.00, 50, 5, null),
      ('LUB-1006', 'LUBRICANT'::public.item_type, 'CLEAN FLUSH', 'Generic', 90.00, 215.00, 50, 5, null),
      ('CHN-1001', 'CHAIN'::public.item_type, 'CHAIN LINK', 'Generic', 18.00, 58.00, 50, 5, null),
      ('ACC-1005', 'ACCESSORY'::public.item_type, 'RC UNDERBELLY', 'Generic', 2600.00, 3600.00, 50, 5, null),
      ('PRT-1014', 'OTHER_SPARE_PART'::public.item_type, 'MOUTH', 'Generic', 20.00, 300.00, 50, 5, 'Unclassified'),
      ('PRT-1015', 'OTHER_SPARE_PART'::public.item_type, 'WEEL BEARING', 'Generic', 128.00, 250.00, 50, 5, 'Bearing'),
      ('PRT-1016', 'OTHER_SPARE_PART'::public.item_type, 'KEY SET ASSAMBLY', 'Generic', 1600.00, 1790.00, 50, 5, 'Key Set'),
      ('LUB-1007', 'LUBRICANT'::public.item_type, 'THROTTLE BODY CLEANER', 'Generic', 120.00, 650.00, 50, 5, null),
      ('TYR-1001', 'BRAND_NEW_TYRE'::public.item_type, 'TYRES - Alpha H1 - 110/70/R17', 'Apollo', 4450.00, 5300.00, 50, 5, null),
      ('TYR-1002', 'BRAND_NEW_TYRE'::public.item_type, 'TYRES - Alpha H1 - 140/70/R17', 'Apollo', 3300.00, 5200.00, 50, 5, null),
      ('TYR-1003', 'BRAND_NEW_TYRE'::public.item_type, 'TYRES - Alpha H1 - 150/60/R17', 'Apollo', 5600.00, 6200.00, 50, 5, null),
      ('TYR-1004', 'BRAND_NEW_TYRE'::public.item_type, 'TYRES - Alpha Front - 100/80/R17', 'Apollo', 1618.00, 2100.00, 50, 5, null),
      ('TYR-1005', 'BRAND_NEW_TYRE'::public.item_type, 'TYRES - Zoom Plus - 100/80/17', 'Ceat', 1600.00, 2250.00, 50, 5, null),
      ('TYR-1006', 'BRAND_NEW_TYRE'::public.item_type, 'TYRES - Ceat Sport Rad - 140/70/17', 'Ceat', 2975.00, 3800.00, 50, 5, null),
      ('TYR-1007', 'BRAND_NEW_TYRE'::public.item_type, 'TYRES - Zoom Rad X1TL66H - 150/60/17', 'Ceat', 3691.00, 4950.00, 50, 5, null),
      ('TYR-1008', 'BRAND_NEW_TYRE'::public.item_type, 'TYRES - Ceat MILAZETT41L - 90/100/10', 'Ceat', 950.00, 1350.00, 50, 5, null),
      ('TYR-1009', 'BRAND_NEW_TYRE'::public.item_type, 'TYRES - Ceat zoom X3 - 90/90/10', 'Ceat', 1050.00, 1480.00, 50, 5, null),
      ('TYR-1010', 'BRAND_NEW_TYRE'::public.item_type, 'TYRES - Ceat M1LAZETT54S - 90/90/12', 'Ceat', 1100.00, 1580.00, 50, 5, null),
      ('TYR-1011', 'BRAND_NEW_TYRE'::public.item_type, 'TYRES - Ceat Zoom X3 - 90/90/12', 'Ceat', 1050.00, 1580.00, 50, 5, null),
      ('TYR-1012', 'BRAND_NEW_TYRE'::public.item_type, 'TYRES - PRS - 140/70/17', 'PRS', 1881.00, 3500.00, 50, 5, null),
      ('TYR-1013', 'BRAND_NEW_TYRE'::public.item_type, 'TYRES - Gabriel - 140/70/17', 'Gabriel', 2180.00, 3800.00, 50, 5, null)
    ) as t(sku, item_type, product_name, brand_name, purchase_price, selling_price, qty, low_stock, custom_type_label)
  loop
    -- Idempotent: skip anything already present under this SKU.
    if exists (select 1 from public.inventory_items where sku_code = r.sku) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select id into strict v_brand_id
      from public.brands
     where name = r.brand_name and item_type = r.item_type;

    perform public.create_inventory_item_with_purchase(
      r.item_type,
      r.product_name,
      r.sku,
      v_brand_id,
      r.low_stock,
      r.custom_type_label,     -- required for OTHER_SPARE_PART, forbidden otherwise
      null,                    -- image_url
      r.qty,
      r.purchase_price,
      r.selling_price,
      now(),
      'Opening stock',         -- supplier_name
      'Opening stock seeded from the client price list'
    );
    v_seeded := v_seeded + 1;
  end loop;

  raise notice 'Inventory catalogue seed: % item(s) created, % already present.', v_seeded, v_skipped;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Verify. Every figure below should be non-zero, and batch_count must
--    equal item_count — an item with no batch is the unsellable state
--    described in the header.
-- ---------------------------------------------------------------------------

select
  (select count(*) from public.inventory_items)                             as items_total,
  (select count(*) from public.inventory_items where available_quantity > 0) as items_in_stock,
  (select count(distinct inventory_item_id) from public.purchase_entries)   as items_with_a_batch,
  (select count(*) from public.inventory_items i
     where i.available_quantity > 0
       and not exists (select 1 from public.purchase_entries pe
                        where pe.inventory_item_id = i.id
                          and pe.remaining_quantity > 0))                    as unsellable_items;
