-- =====================================================================
-- Twinspark GMS — remove service jobs SJ-000054 and SJ-000055
-- =====================================================================
--
-- Matched on job_number only. Unlike remove_jobs_9_10.sql there are no
-- ids to cross-check against here, so STEP 0 is not optional: read what
-- it prints and confirm those are the two jobs you mean before running
-- STEP 1. The count guard below refuses to proceed unless exactly two
-- rows match, which catches a typo but cannot catch the wrong pair.
--
-- STOCK IS NOT PUT BACK. If either job was completed, the parts it used
-- already left the shelf, and nothing here returns them. That is the same
-- rule every cleanup in this project has followed: the stock figure you are
-- looking at now is the one you keep. If a job consumed parts that are
-- actually still on the shelf, correct that separately with Adjust Stock.
--
-- ---------------------------------------------------------------------
-- STEP 0 — what goes (safe, read-only)
-- ---------------------------------------------------------------------

select j.job_number, j.invoice_number, c.name as customer,
       v.vehicle_number, v.vehicle_model,
       j.status, j.payment_status, j.grand_total,
       j.created_at::date as created,
       (select count(*) from public.service_job_lines      x where x.service_job_id = j.id) as service_lines,
       (select count(*) from public.service_inventory_usage x where x.service_job_id = j.id) as parts_used,
       (select count(*) from public.service_job_images     x where x.service_job_id = j.id) as photos
from public.service_jobs j
join public.customers c on c.id = j.customer_id
join public.vehicles  v on v.id = j.vehicle_id
where j.job_number in ('SJ-000054', 'SJ-000055')
order by j.job_number;

-- Parts these jobs consumed. If status is COMPLETED, this stock has already
-- gone and stays gone.
select j.job_number, i.sku_code, i.product_name,
       u.quantity_used, u.unit_price_snapshot, u.stock_deducted
from public.service_inventory_usage u
join public.service_jobs j on j.id = u.service_job_id
join public.inventory_items i on i.id = u.inventory_item_id
where j.job_number in ('SJ-000054', 'SJ-000055')
order by j.job_number, i.sku_code;


-- ---------------------------------------------------------------------
-- STEP 1 — the delete. One transaction: both jobs, or neither.
-- ---------------------------------------------------------------------

begin;

create temporary table _jobs on commit drop as
  select id, job_number, status, grand_total
  from public.service_jobs
  where job_number in ('SJ-000054', 'SJ-000055');

-- Stock must not move: this script deletes records, it does not correct
-- inventory. Measured rather than assumed.
create temporary table _stock_before on commit drop as
  select id, available_quantity from public.inventory_items;

do $$
declare
  v_n integer;
begin
  select count(*) into v_n from _jobs;
  if v_n <> 2 then
    raise exception 'Expected 2 jobs (SJ-000054, SJ-000055), matched % — nothing was deleted', v_n;
  end if;

  raise notice 'Deleting % job(s), % of billed work', v_n, (select sum(grand_total) from _jobs);
end $$;

-- Children first — every foreign key here is ON DELETE RESTRICT.
delete from public.service_inventory_usage where service_job_id in (select id from _jobs);
delete from public.service_job_events       where service_job_id in (select id from _jobs);
delete from public.service_job_images       where service_job_id in (select id from _jobs);
delete from public.service_job_lines        where service_job_id in (select id from _jobs);
delete from public.service_jobs             where id             in (select id from _jobs);

do $$
declare v_changed integer;
begin
  select count(*) into v_changed
  from public.inventory_items i
  join _stock_before b on b.id = i.id
  where i.available_quantity is distinct from b.available_quantity;

  if v_changed > 0 then
    raise exception 'Stock moved on % item(s) — rolling back, nothing was deleted', v_changed;
  end if;
end $$;

commit;


-- ---------------------------------------------------------------------
-- STEP 2 — confirm. Run on its own.
-- ---------------------------------------------------------------------

select 'jobs still there' as check, count(*)::text as value
from public.service_jobs where job_number in ('SJ-000054', 'SJ-000055')
union all
select 'service jobs total', count(*)::text from public.service_jobs
union all
select 'completed job revenue', coalesce(sum(grand_total), 0)::text
from public.service_jobs where status = 'COMPLETED';
-- Want: first row 0.
