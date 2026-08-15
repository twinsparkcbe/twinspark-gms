-- Track Tyres don't have a real, meaningful brand (they're generic/re-tread
-- tyres, not a branded product) but every inventory item now requires a
-- brand_id (see 0004_remove_category_universal_brand.sql). Rather than
-- carving out an exception to that rule, seed one shared "Track Tyre" brand
-- row that the Add/Edit Item form auto-selects and locks whenever
-- Item Type = Track Tyre — see components/inventory/item-form-dialog.tsx.
--
-- Idempotent: safe to re-run, and the app also self-heals if this hasn't
-- been applied yet (the Brand combobox falls back to its normal
-- create-a-new-brand flow, which produces the same row).
insert into public.brands (name)
values ('Track Tyre')
on conflict (name) do nothing;
