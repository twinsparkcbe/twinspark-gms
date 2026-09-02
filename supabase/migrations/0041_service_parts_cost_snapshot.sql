-- Per-job parts cost on a Service Job — what the spares actually cost the
-- shop, recorded on the job itself instead of being reconstructed later.
--
-- Confirmed with the developer 2026-09-02, for the Service Profit Report.
--
-- WHY THIS EXISTS
--
-- Until now the only record of what service parts cost was
-- `stock_movements` (reason = 'SERVICE_USAGE') joined to the FIFO batch it
-- drew from. That is exact at the level of the whole shop, and it is what
-- `getCostOfGoodsSold()` and the Profit Report use. It cannot answer "what
-- did THIS job cost", and doc/diagnose_service_cost.sql and
-- doc/fix_orphaned_service_cost.sql are both artefacts of that gap:
--
--   * `stock_movements` has no `service_job_id`, so a deleted job leaves its
--     cost behind with no revenue to match it — the whole reason the cleanup
--     scripts had to re-label rows as MANUAL_CORRECTION.
--   * Editing or undoing a completed job puts stock back at the item's most
--     recent cost (restore_service_job_stock → adjust_stock's synthetic
--     batch) but takes it again at FIFO cost. The difference stays in the
--     movement ledger and compounds with every edit.
--
-- Snapshotting the cost onto the usage row at the moment stock is deducted
-- closes both: the figure is attached to the job that consumed it, an edit
-- re-costs the row from scratch rather than layering a correction on top,
-- and deleting a job takes its cost with it.
--
-- This changes NOTHING about stock, revenue, or any existing report. The
-- Dashboard and the Profit Report keep reading `stock_movements` exactly as
-- before; this is a second, per-job record written alongside them.

-- ---------------------------------------------------------------------------
-- 1. What the parts on this row cost the shop
-- ---------------------------------------------------------------------------

-- The TOTAL for the row, not a per-unit price. A FIFO consumption can split
-- across batches at different prices — 2 units at ₹1,900 and 1 at ₹2,050 —
-- and a per-unit column would have to round that into a lie. Per-unit is
-- cost_total / quantity_used wherever it is wanted for display.
alter table public.service_inventory_usage
  add column if not exists cost_total numeric(14, 2);

alter table public.service_inventory_usage
  drop constraint if exists service_inventory_usage_cost_total_non_negative;

alter table public.service_inventory_usage
  add constraint service_inventory_usage_cost_total_non_negative
    check (cost_total is null or cost_total >= 0);

-- True only on back-filled rows whose exact batch cost could not be
-- recovered (see §4). The report shows these apart rather than mixing an
-- estimate into an otherwise exact figure without saying so.
alter table public.service_inventory_usage
  add column if not exists cost_is_estimated boolean not null default false;

create index if not exists service_inventory_usage_costed_idx
  on public.service_inventory_usage (service_job_id)
  where cost_total is not null;

-- ---------------------------------------------------------------------------
-- 2. deduct_service_job_stock() — cost the row as it is deducted.
--
--    The FIFO walk below reads the same batches, in the same order, that
--    adjust_stock() is about to drain, and takes the same `for update` locks
--    first. Both run inside this one transaction, so the batches cannot move
--    between the two: the cost recorded here is the cost actually consumed,
--    not an estimate of it.
--
--    Everything else is byte-identical to 0038.
-- ---------------------------------------------------------------------------

create or replace function public.deduct_service_job_stock(
  p_service_job_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usage record;
  v_short text;
  v_batch record;
  v_remaining integer;
  v_take integer;
  v_cost numeric;
begin
  -- Checked up front, across the whole parts list, so the message can name
  -- every shortfall at once (0038).
  select string_agg(x.msg, '; ' order by x.product_name) into v_short
  from (
    select i.product_name,
           format(
             '%s (need %s, have %s)',
             i.product_name,
             sum(u.quantity_used),
             i.available_quantity
           ) as msg
    from public.service_inventory_usage u
    join public.inventory_items i on i.id = u.inventory_item_id
    where u.service_job_id = p_service_job_id
      and not u.stock_deducted
    group by i.id, i.product_name, i.available_quantity
    having sum(u.quantity_used) > i.available_quantity
  ) x;

  if v_short is not null then
    raise exception 'Not enough stock: %', v_short using errcode = 'P0001';
  end if;

  for v_usage in
    select id, inventory_item_id, quantity_used
      from public.service_inventory_usage
      where service_job_id = p_service_job_id and not stock_deducted
      for update
  loop
    -- Price the consumption before it happens, walking the batches exactly
    -- as adjust_stock's FIFO loop will: oldest purchase first, splitting
    -- across as many batches as the quantity needs. `for update` here is
    -- what makes the two walks see the same rows.
    v_remaining := v_usage.quantity_used;
    v_cost := 0;

    for v_batch in
      select id, remaining_quantity, unit_price
        from public.purchase_entries
        where inventory_item_id = v_usage.inventory_item_id and remaining_quantity > 0
        order by purchase_date asc, created_at asc
        for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_batch.remaining_quantity, v_remaining);
      v_cost := v_cost + (v_take * v_batch.unit_price);
      v_remaining := v_remaining - v_take;
    end loop;

    -- A shortfall would abort inside adjust_stock() below anyway; the guard
    -- above has already made that unreachable in practice. Cost is recorded
    -- for what could actually be drawn, so it can never exceed reality.
    perform public.adjust_stock(v_usage.inventory_item_id, -v_usage.quantity_used, 'SERVICE_USAGE', 'service', null);

    update public.service_inventory_usage
       set stock_deducted = true,
           cost_total = round(v_cost, 2),
           cost_is_estimated = false
     where id = v_usage.id;
  end loop;
end;
$$;

revoke execute on function public.deduct_service_job_stock(uuid) from public;

-- ---------------------------------------------------------------------------
-- 3. restore_service_job_stock() — putting the parts back un-costs the row.
--
--    Otherwise a job that was undone, or a completed job being corrected,
--    would keep the cost of parts it no longer holds. The row is re-costed
--    from scratch the next time it is deducted, which is what stops the
--    restore-at-latest-cost / deduct-at-FIFO-cost gap from accumulating on
--    the job's own figures.
--
--    Everything else is byte-identical to 0028.
-- ---------------------------------------------------------------------------

create or replace function public.restore_service_job_stock(
  p_service_job_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usage record;
begin
  for v_usage in
    select id, inventory_item_id, quantity_used
      from public.service_inventory_usage
      where service_job_id = p_service_job_id and stock_deducted
      for update
  loop
    -- Positive delta: adjust_stock creates a synthetic batch at the item's
    -- most recent cost, the same approach Sale Return uses (0026) rather
    -- than reconstructing which FIFO batches the original deduction drained.
    perform public.adjust_stock(v_usage.inventory_item_id, v_usage.quantity_used, 'SERVICE_USAGE', 'service', p_note);
    update public.service_inventory_usage
       set stock_deducted = false,
           cost_total = null,
           cost_is_estimated = false
     where id = v_usage.id;
  end loop;
end;
$$;

revoke execute on function public.restore_service_job_stock(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- 4. Back-fill — every part already consumed by a completed job.
--
--    Without this the Service Profit Report reads zero cost, and therefore
--    pure profit, for every job billed before today. Two passes:
--
--    PASS A (exact). A service job's stock leaves the shelf inside the same
--    transaction that stamps its completed_at, so the movement's created_at
--    and the job's completed_at are the same instant to the microsecond —
--    the identity doc/fix_orphaned_service_cost.sql already relies on.
--    Matching on (instant, item) recovers the real batch cost. Jobs sharing
--    an instant are excluded rather than guessed at.
--
--    PASS B (estimate). Anything left — chiefly rows re-deducted by a later
--    edit, whose movements no longer line up with completed_at — is priced
--    at the item's current purchase_price and flagged, exactly the
--    approximation doc/diagnose_service_cost.sql's Q4 uses. Flagged, so the
--    report can say which figures are estimates instead of quietly blending
--    them in.
--
--    Rows that were never deducted (drafts, jobs in progress) are left null:
--    nothing has left the shelf, so there is no cost to record yet.
-- ---------------------------------------------------------------------------

-- PASS A
with job_instants as (
  select completed_at
    from public.service_jobs
   where status = 'COMPLETED' and completed_at is not null
   group by completed_at
  having count(*) = 1
),
movement_cost as (
  select sm.created_at,
         sm.inventory_item_id,
         sum(-sm.delta * pe.unit_price) as cost,
         sum(-sm.delta)                 as units
    from public.stock_movements sm
    join public.purchase_entries pe on pe.id = sm.purchase_entry_id
    join job_instants ji on ji.completed_at = sm.created_at
   where sm.reason = 'SERVICE_USAGE'
     and sm.delta < 0
   group by sm.created_at, sm.inventory_item_id
),
job_item_units as (
  select u.service_job_id,
         j.completed_at,
         u.inventory_item_id,
         sum(u.quantity_used) as units
    from public.service_inventory_usage u
    join public.service_jobs j on j.id = u.service_job_id
   where j.status = 'COMPLETED'
     and u.stock_deducted
     and u.cost_total is null
   group by u.service_job_id, j.completed_at, u.inventory_item_id
),
matched as (
  -- Only where the units agree: a mismatch means the movements for that
  -- instant are not this job's parts, and a cost derived from them would be
  -- worse than no cost at all.
  select jiu.service_job_id, jiu.inventory_item_id, mc.cost, jiu.units
    from job_item_units jiu
    join movement_cost mc
      on mc.created_at = jiu.completed_at
     and mc.inventory_item_id = jiu.inventory_item_id
     and mc.units = jiu.units
)
update public.service_inventory_usage u
   set cost_total = round(m.cost * u.quantity_used / nullif(m.units, 0), 2),
       cost_is_estimated = false
  from matched m
 where u.service_job_id = m.service_job_id
   and u.inventory_item_id = m.inventory_item_id
   and u.stock_deducted
   and u.cost_total is null;

-- PASS B
update public.service_inventory_usage u
   set cost_total = round(u.quantity_used * coalesce(i.purchase_price, 0), 2),
       cost_is_estimated = true
  from public.inventory_items i,
       public.service_jobs j
 where i.id = u.inventory_item_id
   and j.id = u.service_job_id
   and j.status = 'COMPLETED'
   and u.stock_deducted
   and u.cost_total is null;
