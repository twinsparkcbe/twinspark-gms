-- =====================================================================
-- Twinspark GMS — why today's service cost is ₹39,482 on ₹11,751 of work
-- =====================================================================
--
-- Read-only. Nothing here changes any data.
--
-- Today's numbers split like this:
--
--   SALES    ₹61,784.98 revenue − ₹33,909 cost  = +₹27,876   (55% cost — healthy)
--   SERVICE  ₹11,750.98 revenue − ₹39,482 cost  = −₹27,731   (336% cost)
--                                                  ─────────
--                                                    +₹145
--
-- Sales is fine. The whole profit collapse is service parts. Three things
-- can put cost on the service side with no revenue behind it, and the
-- queries below tell them apart:
--
--   A. DELETED JOBS. The cleanup scripts removed service jobs but could not
--      remove their stock movements — stock_movements has no service_job_id
--      column, and the stock genuinely did leave the shelf, so the rows had
--      to stay. The job's revenue went; its cost did not. If those jobs were
--      created today, their cost is in today's figure.
--
--   B. EDITED JOBS. Editing or undoing a completed job puts stock back at
--      the item's MOST RECENT cost but takes it again at FIFO cost. When
--      those differ the gap stays in the cost figure, and it compounds with
--      every edit.
--
--   C. GENUINE. Jobs really did consume more in parts than they billed —
--      combo parts billed at ₹0, or a job priced below the parts it used.
--
-- Run each query on its own (the Supabase editor only shows one result).
--
-- ---------------------------------------------------------------------
-- Q1 — THE DECIDING QUERY: units that left vs units on jobs that exist
-- ---------------------------------------------------------------------
-- units_moved_today  = parts taken off the shelf by service work today
-- units_on_live_jobs = parts recorded against service jobs that STILL EXIST
--                      and were billed today
--
-- orphaned_units is the difference: stock whose cost is counted with no
-- surviving job to account for it. Multiply by the cost and you have cause
-- A, to the rupee.

with w as (
  select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as f, now() as t
),
moved as (
  select sm.inventory_item_id,
         sum(-sm.delta)                        as units_moved,
         sum(-sm.delta * pe.unit_price)        as cost_moved
  from public.stock_movements sm
  join public.purchase_entries pe on pe.id = sm.purchase_entry_id, w
  where sm.reason = 'SERVICE_USAGE'
    and sm.created_at >= w.f and sm.created_at <= w.t
  group by sm.inventory_item_id
),
on_live_jobs as (
  select u.inventory_item_id, sum(u.quantity_used) as units_on_jobs
  from public.service_inventory_usage u
  join public.service_jobs j on j.id = u.service_job_id, w
  where j.status = 'COMPLETED'
    and j.completed_at >= w.f and j.completed_at <= w.t
  group by u.inventory_item_id
)
select i.sku_code,
       i.product_name,
       coalesce(m.units_moved, 0)                                   as units_moved_today,
       coalesce(l.units_on_jobs, 0)                                 as units_on_live_jobs,
       coalesce(m.units_moved, 0) - coalesce(l.units_on_jobs, 0)    as orphaned_units,
       round(coalesce(m.cost_moved, 0), 2)                          as cost_counted_today,
       round(case when coalesce(m.units_moved, 0) <> 0
                  then coalesce(m.cost_moved, 0)
                       * (coalesce(m.units_moved,0) - coalesce(l.units_on_jobs,0))
                       / coalesce(m.units_moved,0)
                  else 0 end, 2)                                    as cost_with_no_job
from moved m
full join on_live_jobs l on l.inventory_item_id = m.inventory_item_id
join public.inventory_items i on i.id = coalesce(m.inventory_item_id, l.inventory_item_id)
order by orphaned_units desc, cost_counted_today desc;
-- Read the cost_with_no_job column. If it adds up to most of the ₹39,482,
-- the cause is A — deleted jobs — and no code is broken.


-- ---------------------------------------------------------------------
-- Q2 — the same thing as one number
-- ---------------------------------------------------------------------

with w as (
  select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as f, now() as t
)
select (select coalesce(sum(-sm.delta), 0)
          from public.stock_movements sm, w
         where sm.reason = 'SERVICE_USAGE'
           and sm.created_at >= w.f and sm.created_at <= w.t)          as units_moved_today,
       (select coalesce(sum(u.quantity_used), 0)
          from public.service_inventory_usage u
          join public.service_jobs j on j.id = u.service_job_id, w
         where j.status = 'COMPLETED'
           and j.completed_at >= w.f and j.completed_at <= w.t)        as units_on_live_jobs,
       (select coalesce(round(sum(-sm.delta * pe.unit_price), 2), 0)
          from public.stock_movements sm
          join public.purchase_entries pe on pe.id = sm.purchase_entry_id, w
         where sm.reason = 'SERVICE_USAGE'
           and sm.created_at >= w.f and sm.created_at <= w.t)          as service_cost_today;


-- ---------------------------------------------------------------------
-- Q3 — cause B: how much of it is edits and undos
-- ---------------------------------------------------------------------
-- A restore carries a note naming the invoice; a plain completion has none.
-- If units cancel between the two rows but the money does not, that gap is
-- the edit bug, and its size is the gap.

with w as (
  select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as f, now() as t
)
select case when sm.delta < 0 then '1. taken off the shelf'
            else                   '2. put back (edit or undo)' end as direction,
       coalesce(sm.note, '(no note — plain completion)')            as note,
       count(*)                                                     as movements,
       sum(abs(sm.delta))                                           as units,
       round(sum(-sm.delta * pe.unit_price), 2)                     as cost_effect
from public.stock_movements sm
join public.purchase_entries pe on pe.id = sm.purchase_entry_id, w
where sm.reason = 'SERVICE_USAGE'
  and sm.created_at >= w.f and sm.created_at <= w.t
group by 1, 2
order by 1, 5 desc;


-- ---------------------------------------------------------------------
-- Q4 — cause C: the two jobs that DID bill today, and what they consumed
-- ---------------------------------------------------------------------
-- parts_cost above grand_total is a job that lost money on its own terms —
-- real, and worth knowing about, but it is only cause C if these two jobs
-- account for the whole ₹39,482.

with w as (
  select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as f, now() as t
)
select j.job_number,
       j.invoice_number,
       c.name                                     as customer,
       j.grand_total                              as billed,
       j.subtotal                                 as labour_and_services,
       j.inventory_total                          as parts_charged_to_customer,
       coalesce(sum(u.quantity_used), 0)          as part_units,
       round(coalesce(sum(u.quantity_used * i.purchase_price), 0), 2) as parts_cost_approx
from public.service_jobs j
join public.customers c on c.id = j.customer_id
left join public.service_inventory_usage u on u.service_job_id = j.id
left join public.inventory_items i on i.id = u.inventory_item_id, w
where j.status = 'COMPLETED'
  and j.completed_at >= w.f and j.completed_at <= w.t
group by j.id, j.job_number, j.invoice_number, c.name, j.grand_total, j.subtotal, j.inventory_total
order by j.job_number;
