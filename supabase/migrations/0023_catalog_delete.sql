-- Deleting catalog entries — Combos, General Service Packages, Specific
-- Services.
--
-- The standing convention is soft-deactivate, never delete (service scope doc
-- §16): an entry used on a past job must keep resolving forever, or that job's
-- invoice becomes unreadable. That convention is right and stays.
--
-- What it doesn't cover is the mistake case — a typo'd entry, a duplicate
-- created by accident, a combo cloned and never finished. Those are pure
-- clutter with no history behind them, and deactivating them just moves the
-- clutter rather than removing it.
--
-- So: delete is allowed **only when nothing references the entry**. The
-- functions below check every referencing table first and refuse with a
-- readable message otherwise, telling the caller to deactivate instead. That
-- keeps history safe by construction rather than by convention — even a
-- direct API call can't orphan an invoice.
--
-- (The FK constraints are already `on delete restrict`, so the database would
-- refuse anyway. These functions exist to turn an opaque 23503 into an
-- explanation the admin can act on.)
--
-- Idempotency note (see prior migration headers): safely re-runnable.

-- ---------------------------------------------------------------------------
-- 1. delete_combo()
-- ---------------------------------------------------------------------------

create or replace function public.delete_combo(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_job_uses integer;
  v_sale_uses integer;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if v_role is distinct from 'admin' then
    raise exception 'Only Administrators can manage Combo Offers' using errcode = '42501';
  end if;

  if not exists (select 1 from public.combos where id = p_id) then
    raise exception 'Combo % not found', p_id using errcode = 'P0002';
  end if;

  select count(*) into v_job_uses from public.service_job_lines where combo_id = p_id;
  select count(*) into v_sale_uses from public.sale_items where combo_id = p_id;

  if v_job_uses + v_sale_uses > 0 then
    raise exception
      'This combo has been used on % job(s) and % sale(s), so it cannot be deleted. Switch it off instead — it will stop appearing on new jobs while past invoices keep working.',
      v_job_uses, v_sale_uses
      using errcode = '23503';
  end if;

  -- combo_components cascades (0021).
  delete from public.combos where id = p_id;
end;
$$;

grant execute on function public.delete_combo(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. delete_general_service_package()
-- ---------------------------------------------------------------------------

create or replace function public.delete_general_service_package(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_job_uses integer;
  v_combo_uses integer;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if v_role is distinct from 'admin' then
    raise exception 'Only Administrators can manage the Service Catalog' using errcode = '42501';
  end if;

  if not exists (select 1 from public.general_service_packages where id = p_id) then
    raise exception 'General Service Package % not found', p_id using errcode = 'P0002';
  end if;

  select count(*) into v_job_uses from public.service_job_lines where general_service_package_id = p_id;
  -- Also blocked while a combo still contains it, or deleting would silently
  -- gut that combo's contents.
  select count(*) into v_combo_uses from public.combo_components where general_service_package_id = p_id;

  if v_job_uses > 0 then
    raise exception
      'This package has been used on % job(s), so it cannot be deleted. Switch it off instead — it will stop appearing on new jobs while past invoices keep working.',
      v_job_uses
      using errcode = '23503';
  end if;
  if v_combo_uses > 0 then
    raise exception 'This package is part of % combo offer(s). Remove it from those combos first, or switch it off instead.', v_combo_uses
      using errcode = '23503';
  end if;

  delete from public.general_service_package_items where general_service_package_id = p_id;
  delete from public.general_service_packages where id = p_id;
end;
$$;

grant execute on function public.delete_general_service_package(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. delete_specific_service()
-- ---------------------------------------------------------------------------

create or replace function public.delete_specific_service(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_job_uses integer;
  v_combo_uses integer;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if v_role is distinct from 'admin' then
    raise exception 'Only Administrators can manage the Service Catalog' using errcode = '42501';
  end if;

  if not exists (select 1 from public.specific_services where id = p_id) then
    raise exception 'Specific Service % not found', p_id using errcode = 'P0002';
  end if;

  select count(*) into v_job_uses from public.service_job_lines where specific_service_id = p_id;
  select count(*) into v_combo_uses from public.combo_components where specific_service_id = p_id;

  if v_job_uses > 0 then
    raise exception
      'This service has been used on % job(s), so it cannot be deleted. Switch it off instead — it will stop appearing on new jobs while past invoices keep working.',
      v_job_uses
      using errcode = '23503';
  end if;
  if v_combo_uses > 0 then
    raise exception 'This service is part of % combo offer(s). Remove it from those combos first, or switch it off instead.', v_combo_uses
      using errcode = '23503';
  end if;

  delete from public.specific_service_items where specific_service_id = p_id;
  delete from public.specific_services where id = p_id;
end;
$$;

grant execute on function public.delete_specific_service(uuid) to authenticated;
