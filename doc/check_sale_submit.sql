-- One-shot check for "I can't submit a sale". Writes nothing — the final
-- ROLLBACK undoes the test sale entirely.
--
-- It records the exact sale that is failing, straight against the database,
-- bypassing the app. Whatever it says isolates the fault to one side:
--   * it succeeds  -> the database is fine, the block is in the browser
--   * it errors    -> the error text is the real reason the app is refusing

begin;

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id from public.profiles where role = 'admin' and is_active order by created_at limit 1),
    'user_metadata', json_build_object('role', 'admin')
  )::text,
  true
);

create temp table _check on commit drop as
select public.record_sale_with_payment(
  'SUBMIT CHECK — rolled back', '9999999999', null,
  false, 0, false, 0,
  json_build_array(
    json_build_object('line_type','PRODUCT',
      'inventory_item_id', (select id from public.inventory_items where sku_code = 'SKU-00015'),
      'quantity', 1, 'unit_selling_price', 2300),
    json_build_object('line_type','PRODUCT',
      'inventory_item_id', (select id from public.inventory_items where sku_code = 'SKU-00014'),
      'quantity', 1, 'unit_selling_price', 2300)
  )::jsonb,
  'CASH', 4600, 0,
  (select id from public.profiles where role = 'admin' and is_active order by created_at limit 1)
) as sale_id;

-- EXPECTED: two rows charged 2300, subtotal 4600, grand 4600.
select i.sku_code,
       si.unit_selling_price as charged,
       si.list_price,
       s.subtotal,
       s.grand_total
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  join public.inventory_items i on i.id = si.inventory_item_id
 where si.sale_id = (select sale_id from _check)
 order by si.position;

rollback;
