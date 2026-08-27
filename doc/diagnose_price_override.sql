-- DIAGNOSTIC — writes nothing. The final ROLLBACK undoes the test sale, so no
-- invoice, no stock movement and no customer survive this script.
--
-- Answers one question: does the DATABASE honour a per-line price override?
-- If it does, the fault is in the running app (stale build). If it doesn't,
-- the fault is in the migration and I'll fix that instead.

begin;

-- ---------------------------------------------------------------------------
-- 1. Which versions of the sale functions are actually installed?
--    More than one row for record_sale / record_sale_with_payment means
--    overloads coexist and PostgREST may be calling an older one.
-- ---------------------------------------------------------------------------
select p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('record_sale', 'record_sale_with_payment', 'replace_sale_lines')
 order by p.proname, arguments;

-- ---------------------------------------------------------------------------
-- 2. Did 0034's columns land?
-- ---------------------------------------------------------------------------
select column_name
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'sale_items'
   and column_name in ('list_price', 'discount_given');

-- ---------------------------------------------------------------------------
-- 3. Does record_sale delegate to replace_sale_lines, or does it still price
--    lines inline? An older inline version would ignore the override even
--    though replace_sale_lines itself understands it.
-- ---------------------------------------------------------------------------
select p.oid::regprocedure                                as which_record_sale,
       position('replace_sale_lines' in p.prosrc) > 0     as delegates_to_replace_sale_lines,
       position('select selling_price into' in p.prosrc) > 0 as prices_lines_itself
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'record_sale';

-- ---------------------------------------------------------------------------
-- 4. THE DECISIVE TEST — record a real sale with an explicit price of 2000
--    on an item whose catalogue price is 1900, then read back what was
--    stored. Rolled back below.
-- ---------------------------------------------------------------------------
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id from public.profiles where role = 'admin' and is_active order by created_at limit 1),
    'user_metadata', json_build_object('role', 'admin')
  )::text,
  true
);

-- A temp table, not psql's \gset — the Supabase SQL editor has no meta-commands.
create temp table _diag_sale on commit drop as
select public.record_sale_with_payment(
  'DIAGNOSTIC — rolled back', '9999999999', null,
  false, 0, false, 0,
  json_build_array(
    json_build_object(
      'line_type', 'PRODUCT',
      'inventory_item_id', (select id from public.inventory_items where sku_code = 'SKU-00015'),
      'quantity', 1,
      'unit_selling_price', 2000
    )
  )::jsonb,
  'CASH', 2000, 0, null
) as sale_id;

-- EXPECTED IF THE DATABASE IS CORRECT: charged = 2000, subtotal = 2000.
-- IF IT SHOWS 1900, the database is ignoring the override and the migration
-- is at fault — send me this row and I'll fix it.
select si.unit_selling_price as charged,
       si.list_price,
       si.discount_given,
       s.subtotal,
       s.grand_total
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
 where si.sale_id = (select sale_id from _diag_sale);

rollback;
