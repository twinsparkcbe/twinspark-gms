-- =====================================================================
-- Twinspark GMS — where today's Profit figure comes from
-- =====================================================================
--
-- Read-only. Nothing here changes any data.
--
-- The Dashboard computes:
--
--     Profit = Sales + Service + Online − Cost of Goods Sold
--
-- Cost of Goods Sold is NOT "what we bought today" (that is the Purchases
-- card). It is the FIFO cost of the stock that actually left today: each
-- stock movement is tied to the exact purchase batch it was drawn from, and
-- the cost is that batch's own unit_price.
--
-- So when Profit looks wrong, one of five things is true, and STEP 5 says
-- which:
--
--   1. Sales, Service or Online is being counted differently than expected.
--   2. A purchase batch has the SELLING price in its unit_price — the item
--      then costs what it sells for and earns nothing.
--   3. Stock left today that was drawn from an unusually expensive old batch.
--   4. An edit or a void restored stock at one cost and re-deducted it at
--      another, leaving a difference behind in the cost figure.
--   5. Stock left today for work that is billed on a DIFFERENT day (the cost
--      lands today, the revenue landed yesterday or lands tomorrow).
--
-- Every window below is IST midnight → now, exactly what the Dashboard's
-- "Today" uses.
--
-- HOW TO RUN IT: the Supabase SQL editor only shows ONE result at a time, so
-- running the whole file shows you one step and hides the rest. Highlight a
-- single STEP (from its "with w as (" or "select" down to the semicolon) and
-- press Run, then move to the next.
--
-- If you only run three, run STEP 2, STEP 3 and STEP 7 — those settle it.
--
-- ---------------------------------------------------------------------
-- STEP 1 — the window itself
-- ---------------------------------------------------------------------

select date_trunc('day', now() at time zone 'Asia/Kolkata')
         at time zone 'Asia/Kolkata'                as window_from_utc,
       now()                                        as window_to_utc,
       (now() at time zone 'Asia/Kolkata')::date    as ist_date_today;


-- ---------------------------------------------------------------------
-- STEP 2 — the four numbers on the Dashboard, recomputed from scratch
-- ---------------------------------------------------------------------

with w as (
  select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as f,
         now() as t
),
sales_today as (
  -- Matches getSalesStats: voided sales excluded, filtered on sale_date.
  select coalesce(sum(grand_total), 0) as amt, count(*) as n
  from public.sales, w
  where voided_at is null and sale_date >= w.f and sale_date <= w.t
),
service_today as (
  -- Matches getServiceStats: COMPLETED only, filtered on completed_at.
  select coalesce(sum(grand_total), 0) as amt, count(*) as n
  from public.service_jobs, w
  where status = 'COMPLETED' and completed_at >= w.f and completed_at <= w.t
),
online_today as (
  -- Matches getOnlineRevenue: DISPATCHED only, filtered on dispatched_at.
  select coalesce(sum(total_amount), 0) as amt, count(*) as n
  from public.online_orders, w
  where status = 'DISPATCHED' and dispatched_at >= w.f and dispatched_at <= w.t
),
cogs_today as (
  -- Matches getCostOfGoodsSold exactly, including the inner join to the
  -- batch: a movement with no batch contributes nothing.
  select coalesce(sum(-sm.delta * pe.unit_price), 0) as amt, count(*) as n
  from public.stock_movements sm
  join public.purchase_entries pe on pe.id = sm.purchase_entry_id, w
  where sm.reason in ('SALE', 'SERVICE_USAGE', 'ONLINE_ORDER_DISPATCH')
    and sm.created_at >= w.f and sm.created_at <= w.t
)
select 'Sales Amount (Today)'   as figure, (select amt from sales_today)   as value, (select n from sales_today)::text   as count
union all select 'Service Amount (Today)',  (select amt from service_today), (select n from service_today)::text
union all select 'Online Amount (Today)',   (select amt from online_today),  (select n from online_today)::text
union all select 'Cost of Goods Sold',      (select amt from cogs_today),    (select n from cogs_today)::text || ' movements'
union all select '= PROFIT (Today)',
       (select amt from sales_today) + (select amt from service_today)
         + (select amt from online_today) - (select amt from cogs_today), ''
union all select 'Purchases (Today) — NOT in profit',
       (select coalesce(sum(pe.total_amount), 0) from public.purchase_entries pe, w
         where pe.purchase_date >= w.f and pe.purchase_date <= w.t), '';
-- Compare row by row against the Dashboard. Whichever row disagrees with the
-- card is where to look; if they all agree, the arithmetic is right and the
-- question is which cost is wrong — STEP 3 and STEP 4.


-- ---------------------------------------------------------------------
-- STEP 3 — every movement that made up today's Cost of Goods Sold
-- ---------------------------------------------------------------------
-- The column that matters is cost_vs_selling. Anything at or above 100%
-- means that unit cost what it sold for, or more — it earned nothing. That
-- is almost always a batch recorded with the selling price in the cost
-- field, and it is the single most common cause of a profit near zero.

with w as (
  select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as f, now() as t
)
select sm.created_at at time zone 'Asia/Kolkata' as at_ist,
       sm.reason,
       i.sku_code,
       i.product_name,
       sm.delta,
       pe.batch_number,
       pe.unit_price                    as batch_cost_each,
       i.selling_price                  as sells_for_each,
       (-sm.delta * pe.unit_price)      as cost_counted,
       case when i.selling_price > 0
            then round(100.0 * pe.unit_price / i.selling_price, 1)
       end                              as cost_vs_selling_pct,
       pe.purchase_date::date           as batch_dated,
       sm.note
from public.stock_movements sm
join public.purchase_entries pe on pe.id = sm.purchase_entry_id
join public.inventory_items i on i.id = sm.inventory_item_id, w
where sm.reason in ('SALE', 'SERVICE_USAGE', 'ONLINE_ORDER_DISPATCH')
  and sm.created_at >= w.f and sm.created_at <= w.t
order by (-sm.delta * pe.unit_price) desc;


-- ---------------------------------------------------------------------
-- STEP 4 — the same cost, summarised per item, against what it earned
-- ---------------------------------------------------------------------
-- A positive delta on a SALE or SERVICE_USAGE row is stock coming BACK (a
-- void, an undo, or an edit that reduced the parts list). Those subtract
-- from the cost. If units_out and units_back don't cancel the way you'd
-- expect, an edit or a void restored stock at one cost and re-deducted it at
-- another, and the difference is sitting in today's cost figure.

with w as (
  select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as f, now() as t
)
select i.sku_code,
       i.product_name,
       sum(case when sm.delta < 0 then -sm.delta else 0 end) as units_out,
       sum(case when sm.delta > 0 then  sm.delta else 0 end) as units_back,
       round(sum(-sm.delta * pe.unit_price), 2)              as net_cost_counted,
       min(pe.unit_price)                                    as cheapest_batch_used,
       max(pe.unit_price)                                    as dearest_batch_used,
       i.selling_price
from public.stock_movements sm
join public.purchase_entries pe on pe.id = sm.purchase_entry_id
join public.inventory_items i on i.id = sm.inventory_item_id, w
where sm.reason in ('SALE', 'SERVICE_USAGE', 'ONLINE_ORDER_DISPATCH')
  and sm.created_at >= w.f and sm.created_at <= w.t
group by i.id, i.sku_code, i.product_name, i.selling_price
order by net_cost_counted desc;


-- ---------------------------------------------------------------------
-- STEP 5 — service cost: stock going out vs stock coming back
-- ---------------------------------------------------------------------
-- A stock movement records WHICH ITEM moved, not which job moved it —
-- stock_movements has no service_job_id column. So this cannot be broken
-- down per job, and any query that tries to (by joining on the item) fans
-- one movement out across every job that ever used that part and reports
-- nonsense. It is broken down by direction and note instead, which is what
-- actually identifies the problem case.
--
-- Completing a job writes a deduction with NO note. Editing or undoing a
-- completed job writes a restore WITH a note naming the invoice. That
-- matters because the two use different costs: the deduction is taken at
-- FIFO cost (oldest batch first), while the restore comes back at the
-- item's MOST RECENT cost. If those differ, an edited job leaves the
-- difference behind in today's cost figure.
--
-- Read it as: does cost_effect for the restores roughly cancel the
-- deductions for the same units? If units cancel but the money doesn't,
-- that gap is in today's Profit.

with w as (
  select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as f, now() as t
)
select case when sm.delta < 0 then '1. deducted (job completed)'
            else                   '2. restored (edit or undo)' end as direction,
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
-- STEP 5b — service revenue billed today vs service cost counted today
-- ---------------------------------------------------------------------
-- The one genuine timing split worth ruling out: a job completed yesterday
-- and edited today puts fresh cost in today with no matching revenue. If
-- service_cost_today is large while service_revenue_today is small, that is
-- what happened — and it is a timing effect, not a bug.

with w as (
  select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as f, now() as t
)
select (select coalesce(sum(grand_total), 0) from public.service_jobs, w
         where status = 'COMPLETED' and completed_at >= w.f and completed_at <= w.t)
         as service_revenue_today,
       (select count(*) from public.service_jobs, w
         where status = 'COMPLETED' and completed_at >= w.f and completed_at <= w.t)
         as jobs_billed_today,
       (select coalesce(round(sum(-sm.delta * pe.unit_price), 2), 0)
          from public.stock_movements sm
          join public.purchase_entries pe on pe.id = sm.purchase_entry_id, w
         where sm.reason = 'SERVICE_USAGE'
           and sm.created_at >= w.f and sm.created_at <= w.t)
         as service_cost_today;


-- ---------------------------------------------------------------------
-- STEP 6 — batches whose cost is at or above their selling price
-- ---------------------------------------------------------------------
-- Not limited to today. These are the batches that will read as zero or
-- negative profit whenever they sell, whether that is today or next month.
-- Usually the selling price was typed into the cost field when the stock was
-- recorded. Fix them with Edit Purchase.

select pe.batch_number,
       i.sku_code,
       i.product_name,
       pe.unit_price      as cost_each,
       i.selling_price    as sells_for_each,
       pe.quantity,
       pe.remaining_quantity,
       pe.purchase_date::date as dated,
       pe.supplier_name
from public.purchase_entries pe
join public.inventory_items i on i.id = pe.inventory_item_id
where i.selling_price > 0
  and pe.unit_price >= i.selling_price
order by (pe.unit_price - i.selling_price) desc, pe.purchase_date desc;


-- ---------------------------------------------------------------------
-- STEP 7 — was any stock counted twice?
-- ---------------------------------------------------------------------
-- Everything above assumes each unit that left is counted once. This checks
-- that assumption directly: units billed on today's sale lines against units
-- actually moved off the shelf by those sales.
--
-- They should match. If units_moved is roughly DOUBLE units_billed, the cost
-- is being counted twice and the problem is not pricing at all — send me this
-- table. A small difference is normal when a sale was edited or voided today
-- (the restore shows as stock coming back in STEP 4).

with w as (
  select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as f, now() as t
),
billed as (
  select si.inventory_item_id, sum(si.quantity) as units_billed
  from public.sale_items si
  join public.sales s on s.id = si.sale_id, w
  where s.voided_at is null and s.sale_date >= w.f and s.sale_date <= w.t
    and si.inventory_item_id is not null
  group by si.inventory_item_id
),
moved as (
  select sm.inventory_item_id, sum(-sm.delta) as units_moved
  from public.stock_movements sm, w
  where sm.reason = 'SALE' and sm.created_at >= w.f and sm.created_at <= w.t
  group by sm.inventory_item_id
)
select i.sku_code, i.product_name,
       coalesce(b.units_billed, 0) as units_billed,
       coalesce(m.units_moved, 0)  as units_moved,
       coalesce(m.units_moved, 0) - coalesce(b.units_billed, 0) as difference
from moved m
full join billed b on b.inventory_item_id = m.inventory_item_id
join public.inventory_items i on i.id = coalesce(m.inventory_item_id, b.inventory_item_id)
where coalesce(m.units_moved, 0) <> coalesce(b.units_billed, 0)
order by abs(coalesce(m.units_moved, 0) - coalesce(b.units_billed, 0)) desc;
-- Want: no rows. Every row is a unit whose cost is counted without a matching
-- billed unit, or the other way round.
