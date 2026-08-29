-- =====================================================================
-- Twinspark GMS — remove service jobs SJ-000009 and SJ-000010
-- =====================================================================
--
--   SJ-000009  8cc1d5cf-479b-417a-9840-eb5d79a0691d
--   SJ-000010  8b1e2bd9-0612-47ae-855e-13ae41958a73
--
-- Matched on job_number, with the ids checked against it — if the two ever
-- disagree the script stops rather than deleting a job you did not mean.
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
where j.job_number in ('SJ-000009', 'SJ-000010')
order by j.job_number;

-- Parts these jobs consumed. If status is COMPLETED, this stock has already
-- gone and stays gone.
select j.job_number, i.sku_code, i.product_name,
       u.quantity_used, u.unit_price_snapshot, u.stock_deducted
from public.service_inventory_usage u
join public.service_jobs j on j.id = u.service_job_id
join public.inventory_items i on i.id = u.inventory_item_id
where j.job_number in ('SJ-000009', 'SJ-000010')
order by j.job_number, i.sku_code;


-- ---------------------------------------------------------------------
-- STEP 1 — the delete. One transaction: both jobs, or neither.
-- ---------------------------------------------------------------------

begin;

create temporary table _jobs on commit drop as
  select id, job_number, status, grand_total
  from public.service_jobs
  where job_number in ('SJ-000009', 'SJ-000010');

-- Stock must not move: this script deletes records, it does not correct
-- inventory. Measured rather than assumed.
create temporary table _stock_before on commit drop as
  select id, available_quantity from public.inventory_items;

do $$
declare
  v_n integer;
  v_mismatch integer;
begin
  select count(*) into v_n from _jobs;
  if v_n <> 2 then
    raise exception 'Expected 2 jobs (SJ-000009, SJ-000010), matched % — nothing was deleted', v_n;
  end if;

  -- The job numbers and the ids from the links must describe the same two
  -- rows. A renumbered or re-created job would otherwise be deleted silently.
  select count(*) into v_mismatch
  from _jobs
  where id not in (
    '8cc1d5cf-479b-417a-9840-eb5d79a0691d'::uuid,
    '8b1e2bd9-0612-47ae-855e-13ae41958a73'::uuid
  );
  if v_mismatch > 0 then
    raise exception
      'Job number and id do not match on % row(s) — check STEP 0. Nothing was deleted.', v_mismatch;
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
from public.service_jobs where job_number in ('SJ-000009', 'SJ-000010')
union all
select 'service jobs total', count(*)::text from public.service_jobs
union all
select 'completed job revenue', coalesce(sum(grand_total), 0)::text
from public.service_jobs where status = 'COMPLETED';
-- Want: first row 0.
