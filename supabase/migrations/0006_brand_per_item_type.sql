-- Brands are now scoped to a single item type: each item type has its own
-- brand list (e.g. BRAND_NEW_TYRE = Ceat/MRF/Eurogrip, ENGINE_OIL = Castrol).
-- Previously `brands` was a flat global list with no type association, so
-- every brand appeared under every item type in the Add/Edit Item form.
--
-- This is a hard reset of inventory data (agreed as throwaway dev data) — the
-- old brands have no item_type and can't be sensibly backfilled, so we wipe
-- brands and inventory and let them be re-added from scratch under the new
-- per-type model.

-- Wipe in dependency order (stock_movements -> inventory_items -> brands).
-- CASCADE covers the FKs between them; RESTART IDENTITY is harmless here
-- (all PKs are uuids) but keeps intent explicit.
truncate table public.stock_movements, public.inventory_items restart identity cascade;
truncate table public.brands restart identity cascade;

-- Every brand now belongs to exactly one item type.
alter table public.brands
  add column item_type public.item_type not null;

-- A brand name is unique *within* an item type, not globally — so "Ceat" can
-- exist under both BRAND_NEW_TYRE and (if ever needed) another type as
-- separate rows, while duplicates inside a single type are still blocked.
alter table public.brands
  drop constraint brands_name_key;

alter table public.brands
  add constraint brands_name_item_type_key unique (name, item_type);

-- Re-seed the shared Track Tyre brand under its own type. The Add/Edit Item
-- form auto-selects and locks this whenever Item Type = Track Tyre (see
-- components/inventory/item-form-dialog.tsx). Idempotent on re-run.
insert into public.brands (name, item_type)
values ('Track Tyre', 'TRACK_TYRE')
on conflict (name, item_type) do nothing;
