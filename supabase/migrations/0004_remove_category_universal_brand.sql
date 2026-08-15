-- Category is removed entirely (client decision — it wasn't adding value in
-- practice). Brand becomes a field on every item type instead of being
-- exclusive to Brand New Tyre, sourced from the same `brands` table.
--
-- brand_id stays NULLABLE at the DB level even though the app now requires
-- it on every new/edited item: existing Track Tyre/Engine Oil/etc. rows were
-- created before this change with brand_id = null, and a NOT NULL
-- constraint here would fail the migration outright on any non-empty
-- database. The app-level (zod) validation enforces "required" going
-- forward; old rows can be backfilled via Edit Item at your own pace.

alter table public.inventory_items
  drop constraint inventory_items_category_brand_rule;

alter table public.inventory_items
  drop column category_id;

-- Cascades: categories_admin_insert/update/delete/select policies and any
-- indexes referencing this table only.
drop table public.categories;
