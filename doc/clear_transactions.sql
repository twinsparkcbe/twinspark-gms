-- =====================================================================
-- Twinspark GMS — clear all Sales, Service and Online Order records
-- Stock is left EXACTLY as it is now.
-- =====================================================================
--
-- Run this in the Supabase SQL editor. It removes every sale, every
-- service job and every online order, together with their child rows
-- (line items, events, images, returns, inventory usage).
--
-- WHAT IT DOES NOT TOUCH
--   inventory_items.available_quantity      — current stock, unchanged
--   purchase_entries / remaining_quantity   — purchase batches, unchanged
--   customers, vehicles, brands             — kept
--   combos, service catalogue, packages     — kept
--   attendance, users, payment QR config    — kept
--
-- Deleting a sale does NOT put stock back. There are no delete triggers
-- on any of these tables (verified against the schema), so the units
-- those sales consumed stay consumed — which is what you asked for: the
-- stock figure you are looking at today is the stock figure you keep.
-- The transaction below proves it rather than assuming it: if any item's
-- available_quantity moves by so much as one unit, everything rolls back.
--
-- ORDER MATTERS. Every foreign key in this schema is ON DELETE RESTRICT,
-- so children must go before parents or Postgres refuses the delete.
--
-- ---------------------------------------------------------------------
-- STEP 1 — see what you are about to delete (safe, read-only)
-- ---------------------------------------------------------------------

select 'sales'                   as table_name, count(*) from public.sales
union all select 'sale_items',              count(*) from public.sale_items
union all select 'sale_events',             count(*) from public.sale_events
union all select 'sale_returns',            count(*) from public.sale_returns
union all select 'service_jobs',            count(*) from public.service_jobs
union all select 'service_job_lines',       count(*) from public.service_job_lines
union all select 'service_job_events',      count(*) from public.service_job_events
union all select 'service_job_images',      count(*) from public.service_job_images
union all select 'service_inventory_usage', count(*) from public.service_inventory_usage
union all select 'online_orders',           count(*) from public.online_orders
order by 1;


-- ---------------------------------------------------------------------
-- STEP 2 — the delete
-- ---------------------------------------------------------------------

begin;

-- Snapshot stock first so the guard at the end has something to compare
-- against. Dropped automatically when the transaction commits.
create temporary table _stock_before on commit drop as
  select id, available_quantity from public.inventory_items;

-- Sales: returns reference sale_items, events and items reference sales.
delete from public.sale_returns;
delete from public.sale_events;
delete from public.sale_items;
delete from public.sales;

-- Service: four child tables, all pointing at service_jobs.
delete from public.service_inventory_usage;
delete from public.service_job_events;
delete from public.service_job_images;
delete from public.service_job_lines;
delete from public.service_jobs;

-- Online orders have no child tables.
delete from public.online_orders;

-- Guard: stock must be byte-for-byte what it was when this transaction
-- started. If anything moved, nothing is committed.
do $$
declare
  v_changed integer;
begin
  select count(*) into v_changed
  from public.inventory_items i
  join _stock_before b on b.id = i.id
  where i.available_quantity is distinct from b.available_quantity;

  if v_changed > 0 then
    raise exception 'Stock changed on % item(s) — rolling back, nothing was deleted', v_changed;
  end if;
end $$;

commit;


-- ---------------------------------------------------------------------
-- STEP 3 — confirm (all counts should be 0, stock untouched)
-- ---------------------------------------------------------------------

select 'sales'                   as table_name, count(*) from public.sales
union all select 'sale_items',              count(*) from public.sale_items
union all select 'sale_events',             count(*) from public.sale_events
union all select 'sale_returns',            count(*) from public.sale_returns
union all select 'service_jobs',            count(*) from public.service_jobs
union all select 'service_job_lines',       count(*) from public.service_job_lines
union all select 'service_job_events',      count(*) from public.service_job_events
union all select 'service_job_images',      count(*) from public.service_job_images
union all select 'service_inventory_usage', count(*) from public.service_inventory_usage
union all select 'online_orders',           count(*) from public.online_orders
order by 1;

select count(*) as items, sum(available_quantity) as total_units
from public.inventory_items;


-- =====================================================================
-- OPTIONAL EXTRAS — run only if you want them. None of these change
-- stock either.
-- =====================================================================

-- (A) Restart invoice / job numbering at 1. Without this the next sale
--     carries on from wherever the deleted ones left off, which looks odd
--     on a handover but is otherwise harmless.
--
-- alter sequence public.sales_invoice_number_seq   restart with 1;
-- alter sequence public.service_job_number_seq     restart with 1;
-- alter sequence public.service_invoice_number_seq restart with 1;


-- (B) Clear the stock-movement ledger entries those sales/services/
--     dispatches wrote. This is the audit trail in Inventory > Stock
--     History, NOT the stock figure — available_quantity is stored on
--     inventory_items and is not recalculated from this table, so
--     deleting these rows cannot change your stock.
--
--     Leave it alone if you want the history; clear it if the ledger
--     showing sales that no longer exist would confuse the client.
--
-- delete from public.stock_movements
--  where reason in ('SALE', 'SALE_RETURN', 'SERVICE_USAGE', 'ONLINE_ORDER_DISPATCH');


-- (C) Also clear customers and their vehicles. Only possible AFTER the
--     deletes above (sales and service jobs reference customers with
--     ON DELETE RESTRICT). Vehicles go first — service_jobs is gone by
--     now, but vehicles still point at customers.
--
-- delete from public.vehicles;
-- delete from public.customers;


-- =====================================================================
-- NOT handled by SQL: uploaded files
-- =====================================================================
-- Payment screenshots (bucket `online-order-screenshots`) and service job
-- photos (bucket `service-job-images`) live in Supabase Storage, not in
-- these tables. The rows pointing at them are gone, so nothing in the app
-- can reach them any more, but the files themselves remain until you
-- empty those buckets from Storage in the Supabase dashboard.
