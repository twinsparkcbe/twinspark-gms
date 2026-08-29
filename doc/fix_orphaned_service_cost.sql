-- =====================================================================
-- Twinspark GMS — take deleted jobs' cost out of Profit
-- =====================================================================
--
-- THE PROBLEM
--
-- Today the Dashboard reads:
--
--   SALES    ₹61,784.98 revenue − ₹33,909 cost  = +₹27,876   (55% cost — healthy)
--   SERVICE  ₹11,750.98 revenue − ₹39,482 cost  = −₹27,731   (336% cost)
--                                                  ─────────
--                                                    +₹145
--
-- Sales is fine. Every rupee of the collapse is service parts.
--
-- The cause is the cleanup scripts, and it is my fault. When they deleted
-- the test service jobs they removed each job, its lines and its parts list
-- — but they could NOT remove the matching stock_movements rows, because
-- stock_movements has no service_job_id column to match on. So the jobs'
-- revenue went and their cost stayed. Cost of Goods Sold is still charging
-- Profit for parts consumed by jobs that no longer exist.
--
-- THE FIX
--
-- Those movements are re-labelled from SERVICE_USAGE to MANUAL_CORRECTION.
-- Nothing is deleted and no stock moves:
--
--   * available_quantity is untouched — the transaction aborts if it shifts
--     by even one unit.
--   * The ledger still explains the current stock figure. The units really
--     did leave the shelf during testing; they just did not leave for money.
--   * Cost of Goods Sold counts SALE, SERVICE_USAGE and
--     ONLINE_ORDER_DISPATCH only, so a MANUAL_CORRECTION row stops being
--     charged to Profit — which is correct, because there is no revenue
--     anywhere to match it against.
--   * Each row gets a note saying what happened, so the trail survives.
--
-- HOW A ROW IS IDENTIFIED AS ORPHANED
--
-- A service job's stock leaves the shelf inside the same transaction that
-- stamps its completed_at, so the movement's created_at and the job's
-- completed_at are the same instant to the microsecond. A SERVICE_USAGE
-- movement whose instant matches no surviving job belonged to a job that
-- has been deleted.
--
-- That row-by-row rule is then CROSS-CHECKED against a completely separate
-- count — total units moved by service work versus total units still
-- recorded against surviving jobs. If the two disagree the script aborts and
-- changes nothing, because a disagreement means something is going on that
-- this script does not understand.
--
-- ---------------------------------------------------------------------
-- STEP 0 — what will be re-labelled (safe, read-only)
-- ---------------------------------------------------------------------

select sm.created_at at time zone 'Asia/Kolkata' as at_ist,
       i.sku_code,
       i.product_name,
       sm.delta,
       pe.batch_number,
       pe.unit_price,
       (-sm.delta * pe.unit_price) as cost_it_is_adding,
       sm.note
from public.stock_movements sm
join public.inventory_items i on i.id = sm.inventory_item_id
left join public.purchase_entries pe on pe.id = sm.purchase_entry_id
where sm.reason = 'SERVICE_USAGE'
  and not exists (
    select 1 from public.service_jobs j where j.completed_at = sm.created_at
  )
order by sm.created_at;

-- The totals, and the cross-check. orphaned_by_timestamp and
-- orphaned_by_count must agree, or STEP 1 will refuse to run.
select
  (select coalesce(sum(-sm.delta), 0)
     from public.stock_movements sm
    where sm.reason = 'SERVICE_USAGE'
      and not exists (select 1 from public.service_jobs j where j.completed_at = sm.created_at)
  ) as orphaned_by_timestamp,
  (select coalesce(sum(-x.delta), 0) from public.stock_movements x where x.reason = 'SERVICE_USAGE')
  - (select coalesce(sum(u.quantity_used), 0) from public.service_inventory_usage u where u.stock_deducted)
  as orphaned_by_count,
  (select coalesce(round(sum(-sm.delta * pe.unit_price), 2), 0)
     from public.stock_movements sm
     join public.purchase_entries pe on pe.id = sm.purchase_entry_id
    where sm.reason = 'SERVICE_USAGE'
      and not exists (select 1 from public.service_jobs j where j.completed_at = sm.created_at)
  ) as cost_coming_out_of_profit;


-- ---------------------------------------------------------------------
-- STEP 1 — the re-label. One transaction: all of it, or none of it.
-- ---------------------------------------------------------------------

begin;

create temporary table _orphans on commit drop as
  select sm.id, sm.inventory_item_id, sm.delta
  from public.stock_movements sm
  where sm.reason = 'SERVICE_USAGE'
    and not exists (
      select 1 from public.service_jobs j where j.completed_at = sm.created_at
    );

-- Stock is the thing most easily broken here, so it is measured before and
-- compared after rather than reasoned about.
create temporary table _stock_before on commit drop as
  select id, available_quantity from public.inventory_items;

do $$
declare
  v_rows        integer;
  v_by_stamp    integer;
  v_by_count    integer;
begin
  select count(*), coalesce(sum(-delta), 0) into v_rows, v_by_stamp from _orphans;

  if v_rows = 0 then
    raise exception 'No orphaned service movements found — nothing to do';
  end if;

  -- The independent count. Two different questions asked of two different
  -- tables; if they disagree, this script has misread the data and must not
  -- write to it.
  select (select coalesce(sum(-delta), 0) from public.stock_movements where reason = 'SERVICE_USAGE')
       - (select coalesce(sum(quantity_used), 0) from public.service_inventory_usage where stock_deducted)
    into v_by_count;

  if v_by_stamp <> v_by_count then
    raise exception
      'Cross-check failed: % unit(s) by timestamp, % by count. Nothing was changed — send me STEP 0 and I will look.',
      v_by_stamp, v_by_count;
  end if;

  raise notice 'Re-labelling % movement(s), % unit(s), as MANUAL_CORRECTION', v_rows, v_by_stamp;
end $$;

update public.stock_movements sm
   set reason = 'MANUAL_CORRECTION',
       note = coalesce(nullif(btrim(sm.note), '') || ' · ', '')
              || 'Service job deleted in cleanup — stock stays as-is, cost no longer counted in Profit'
  from _orphans o
 where o.id = sm.id;

do $$
declare
  v_changed integer;
  v_left    integer;
begin
  select count(*) into v_changed
  from public.inventory_items i
  join _stock_before b on b.id = i.id
  where i.available_quantity is distinct from b.available_quantity;

  if v_changed > 0 then
    raise exception 'Stock moved on % item(s) — rolling back, nothing was changed', v_changed;
  end if;

  -- Every SERVICE_USAGE row that remains must now belong to a job that
  -- exists. If any are left, the update missed something.
  select count(*) into v_left
  from public.stock_movements sm
  where sm.reason = 'SERVICE_USAGE'
    and not exists (select 1 from public.service_jobs j where j.completed_at = sm.created_at);

  if v_left > 0 then
    raise exception '% orphaned movement(s) still there — rolling back', v_left;
  end if;
end $$;

commit;


-- ---------------------------------------------------------------------
-- STEP 2 — confirm. Run on its own.
-- ---------------------------------------------------------------------

with w as (
  select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as f, now() as t
),
sales_today as (
  select coalesce(sum(grand_total), 0) as amt from public.sales, w
  where voided_at is null and sale_date >= w.f and sale_date <= w.t
),
service_today as (
  select coalesce(sum(grand_total), 0) as amt from public.service_jobs, w
  where status = 'COMPLETED' and completed_at >= w.f and completed_at <= w.t
),
online_today as (
  select coalesce(sum(total_amount), 0) as amt from public.online_orders, w
  where status = 'DISPATCHED' and dispatched_at >= w.f and dispatched_at <= w.t
),
cogs_today as (
  select coalesce(sum(-sm.delta * pe.unit_price), 0) as amt
  from public.stock_movements sm
  join public.purchase_entries pe on pe.id = sm.purchase_entry_id, w
  where sm.reason in ('SALE', 'SERVICE_USAGE', 'ONLINE_ORDER_DISPATCH')
    and sm.created_at >= w.f and sm.created_at <= w.t
)
select 'Sales Amount (Today)'  as figure, (select amt from sales_today)   as value
union all select 'Service Amount (Today)', (select amt from service_today)
union all select 'Online Amount (Today)',  (select amt from online_today)
union all select 'Cost of Goods Sold',     (select amt from cogs_today)
union all select '= PROFIT (Today)',
       (select amt from sales_today) + (select amt from service_today)
         + (select amt from online_today) - (select amt from cogs_today)
union all select 'orphaned movements left', (select count(*) from public.stock_movements sm
  where sm.reason = 'SERVICE_USAGE'
    and not exists (select 1 from public.service_jobs j where j.completed_at = sm.created_at));
-- Want: the last row 0, and Profit back to something sane. Refresh the
-- Dashboard afterwards — the figures are read live, nothing is cached.
