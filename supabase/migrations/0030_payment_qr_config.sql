-- Admin-configurable payment QR/UPI destination shown read-only on the
-- public Track Tyre order form (/order), directly above the payment
-- screenshot upload. Display only — no validation against what the customer
-- actually paid, no reconciliation, no FK from online_orders. That stays out
-- of scope on purpose (doc/payment-qr-config-scope.md §"Decisions").
--
-- Many rows, one active (§"Decisions" — lets the client keep a second UPI on
-- file, e.g. a backup GPay/PhonePe number, and switch without retyping).
-- Enforced in the DB, not app code: a partial unique index means at most one
-- row can ever have is_active = true, and set_active_payment_qr() below is
-- the only sanctioned way to flip which one — it deactivates the rest in the
-- same statement so there's never a window with zero or two active rows.

create table public.payment_qr_configs (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  upi_id text not null,
  payee_name text not null,
  qr_image_path text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

-- At most one active config, enforced by Postgres itself rather than trusted
-- to application code — a partial unique index only applies to rows where
-- is_active is true, so any number of inactive rows can coexist freely.
create unique index payment_qr_configs_one_active
  on public.payment_qr_configs (is_active)
  where is_active;

-- public.set_updated_at() already exists (0020_user_roles_profiles.sql) —
-- reused here, not redefined.
create trigger payment_qr_configs_set_updated_at
  before update on public.payment_qr_configs
  for each row
  execute function public.set_updated_at();

-- The only sanctioned way to change which config is active — deactivates
-- every other row and activates `p_id` in one statement, so a client-side
-- window can never see zero or two active rows. Raises if p_id doesn't
-- exist so the admin UI gets a clear error instead of a silent no-op.
create or replace function public.set_active_payment_qr(p_id uuid)
returns public.payment_qr_configs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payment_qr_configs;
begin
  if not exists (select 1 from public.payment_qr_configs where id = p_id) then
    raise exception 'Payment QR config % not found', p_id using errcode = 'P0002';
  end if;

  update public.payment_qr_configs set is_active = false where is_active and id <> p_id;
  update public.payment_qr_configs set is_active = true where id = p_id
    returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.set_active_payment_qr(uuid) to authenticated;

alter table public.payment_qr_configs enable row level security;

-- Admin-only write. Mirrors the auth.jwt() role check every other
-- Admin-owned RLS policy in this project uses (e.g. inventory_images
-- storage policies, 0002_inventory_images.sql) rather than the service-role
-- client — this table has no auth.users dependency the way profiles does,
-- so there's no need for the heavier admin client here.
create policy "payment_qr_configs_admin_select" on public.payment_qr_configs
  for select to authenticated
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

create policy "payment_qr_configs_admin_insert" on public.payment_qr_configs
  for insert to authenticated
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

create policy "payment_qr_configs_admin_update" on public.payment_qr_configs
  for update to authenticated
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

create policy "payment_qr_configs_admin_delete" on public.payment_qr_configs
  for delete to authenticated
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

-- The public order form (anon, no session — same surface as
-- online_orders/get_track_tyre_prices) may read *only* the active row, and
-- nothing else on this table. This is what makes it safe for /order to
-- query payment_qr_configs directly rather than needing its own RPC.
create policy "payment_qr_configs_anon_select_active" on public.payment_qr_configs
  for select to anon
  using (is_active);

-- Public-read bucket so the QR image renders directly from its public URL on
-- /order without a signed-request round trip — same shape as
-- inventory-images (0002_inventory_images.sql). Write access is admin-gated.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-qr-images',
  'payment-qr-images',
  true,
  5242880, -- 5 MB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

create policy "payment_qr_images_admin_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'payment-qr-images'
    and (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );

create policy "payment_qr_images_admin_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'payment-qr-images'
    and (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );

create policy "payment_qr_images_admin_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'payment-qr-images'
    and (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );
