-- Two independent Inventory form improvements:
-- 1) "Other Spare Part" items can carry a free-text label describing what
--    they actually are (e.g. "Helmet Lock"), shown in place of the generic
--    type badge everywhere the item appears.
-- 2) SKU / Code becomes optional on create — a Postgres sequence backs a
--    simple global "SKU-00001" style auto-number when the field is left
--    blank, atomic across concurrent creates.

alter table public.inventory_items
  add column custom_type_label text;

-- Backfill first: any Other Spare Part row created before this migration
-- would otherwise get a NULL custom_type_label and immediately violate the
-- check constraint added right below, failing the migration on non-empty
-- databases. product_name is a reasonable default — better than blocking
-- deploy, and admins can refine it via Edit Item afterwards.
update public.inventory_items
set custom_type_label = product_name
where item_type = 'OTHER_SPARE_PART' and custom_type_label is null;

-- Same shape as the existing category/brand rule: required exactly when the
-- type demands it, forbidden otherwise — enforced at the DB level so this
-- can never drift out of sync with app-level validation.
alter table public.inventory_items
  add constraint inventory_items_custom_type_label_rule check (
    (item_type = 'OTHER_SPARE_PART' and custom_type_label is not null and btrim(custom_type_label) <> '')
    or
    (item_type <> 'OTHER_SPARE_PART' and custom_type_label is null)
  );

create sequence public.inventory_sku_seq;

create or replace function public.next_inventory_sku()
returns text
language sql
as $$
  select 'SKU-' || lpad(nextval('public.inventory_sku_seq')::text, 5, '0');
$$;

grant usage on sequence public.inventory_sku_seq to authenticated;
grant execute on function public.next_inventory_sku to authenticated;
