-- Adds product photo support to Inventory (INV redesign — reference mockup
-- shows a thumbnail per row). Nullable: existing/created items work fine
-- without one, table/form fall back to a placeholder icon.

alter table public.inventory_items
  add column image_url text;

-- Public bucket so item photos render directly from their public URL without
-- a signed-request round trip; write access is still admin-gated (mirrors
-- the item CRUD policies on inventory_items itself).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inventory-images',
  'inventory-images',
  true,
  5242880, -- 5 MB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

create policy "inventory_images_admin_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'inventory-images'
    and (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );

create policy "inventory_images_admin_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'inventory-images'
    and (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );

create policy "inventory_images_admin_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'inventory-images'
    and (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );
