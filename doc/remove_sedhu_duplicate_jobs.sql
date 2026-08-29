-- =====================================================================
-- Twinspark GMS — SEDHU's duplicate service jobs: keep SJ-000019 only
-- =====================================================================
--
-- The customer is not matched by name. "SEDHU" could be spelled two ways,
-- or exist as two customer rows, and a name match would then delete the
-- wrong set or miss half of it. Instead the script reads the customer_id
-- off SJ-000019 and deletes every OTHER service job belonging to that same
-- customer. SJ-000019 defines who the customer is, so the job you want to
-- keep and the jobs that go can never disagree.
--
-- If STEP 0 shows a SECOND customer row also named SEDHU (duplicate
-- customer records, e.g. same mobile entered twice), its jobs are NOT
-- touched by this script — tell me and I'll extend it.
--
-- STOCK IS NOT PUT BACK. Any of these jobs that reached COMPLETED already
-- took its parts off the shelf, and nothing here returns them. Same rule
-- every cleanup in this project has followed: the stock figure you are
-- looking at now is the one you keep. The transaction aborts if stock moves
-- by even one unit. If a deleted job consumed parts that are actually still
-- on the shelf, correct that afterwards with Adjust Stock.
--
-- The customer, the vehicle, and SJ-000019 all survive.
--
-- ---------------------------------------------------------------------
-- STEP 0 — who, and what goes (safe, read-only)
-- ---------------------------------------------------------------------

-- 0a. The job being kept, and the customer it identifies.
select j.job_number, j.invoice_number, c.name as customer, c.mobile_number,
       v.vehicle_number, v.vehicle_model,
       j.status, j.payment_status, j.grand_total, j.created_at::date as created
from public.service_jobs j
join public.customers c on c.id = j.customer_id
join public.vehicles  v on v.id = j.vehicle_id
where j.job_number = 'SJ-000019';
-- Want: exactly one row, and the customer must be SEDHU. If this is empty
-- or names someone else, STOP — do not run STEP 1.

-- 0b. Every job for that customer. Everything except SJ-000019 will go.
select j.job_number,
       case when j.job_number = 'SJ-000019' then 'KEEP' else 'delete' end as action,
       j.invoice_number, v.vehicle_number,
       j.status, j.payment_status, j.grand_total,
       j.created_at::date as created,
       (select count(*) from public.service_job_lines       x where x.service_job_id = j.id) as service_lines,
       (select count(*) from public.service_inventory_usage x where x.service_job_id = j.id) as parts_used,
       (select count(*) from public.service_job_images      x where x.service_job_id = j.id) as photos
from public.service_jobs j
join public.vehicles v on v.id = j.vehicle_id
where j.customer_id = (select customer_id from public.service_jobs where job_number = 'SJ-000019')
order by j.job_number;

-- 0c. Is there more than one customer row called SEDHU? If this returns
--     two or more rows, the duplicates are spread across customer records
--     and this script only cleans the one SJ-000019 belongs to.
select c.id, c.name, c.mobile_number, c.created_at::date as added_on,
       (select count(*) from public.service_jobs x where x.customer_id = c.id) as service_jobs,
       (select count(*) from public.sales        x where x.customer_id = c.id) as sales
from public.customers c
where c.name ilike '%sedhu%'
   or c.mobile_number = (select cu.mobile_number from public.customers cu
                  join public.service_jobs j on j.customer_id = cu.id
                  where j.job_number = 'SJ-000019')
order by c.created_at;

-- 0d. Parts consumed by the jobs being deleted. If a job's status is
--     COMPLETED this stock has already gone and stays gone.
select j.job_number, j.status, i.sku_code, i.product_name,
       u.quantity_used, u.unit_price_snapshot, u.stock_deducted
from public.service_inventory_usage u
join public.service_jobs j on j.id = u.service_job_id
join public.inventory_items i on i.id = u.inventory_item_id
where j.customer_id = (select customer_id from public.service_jobs where job_number = 'SJ-000019')
  and j.job_number <> 'SJ-000019'
order by j.job_number, i.sku_code;

-- 0e. What the Service figures will drop by.
select count(*) as jobs_deleted,
       count(*) filter (where status = 'COMPLETED')                    as completed_deleted,
       coalesce(sum(grand_total) filter (where status = 'COMPLETED'), 0) as billed_revenue_removed
from public.service_jobs
where customer_id = (select customer_id from public.service_jobs where job_number = 'SJ-000019')
  and job_number <> 'SJ-000019';


-- ---------------------------------------------------------------------
-- STEP 1 — the delete. One transaction: all of them, or none.
-- ---------------------------------------------------------------------

begin;

-- The customer, resolved once from the job being kept. Every statement
-- below reads from this, so the guards and the deletes cannot disagree
-- about whose jobs these are.
create temporary table _keep on commit drop as
  select id, customer_id
  from public.service_jobs
  where job_number = 'SJ-000019';

create temporary table _jobs on commit drop as
  select j.id, j.job_number, j.status, j.grand_total
  from public.service_jobs j
  where j.customer_id = (select customer_id from _keep)
    and j.id <> (select id from _keep);

-- Stock is the thing most easily broken here, so it is measured before and
-- compared after rather than reasoned about.
create temporary table _stock_before on commit drop as
  select id, available_quantity from public.inventory_items;

do $$
declare
  v_keep    integer;
  v_jobs    integer;
  v_stray   integer;
  v_name    text;
begin
  select count(*) into v_keep from _keep;
  if v_keep <> 1 then
    raise exception
      'SJ-000019 matched % row(s), expected exactly 1 — nothing was deleted', v_keep;
  end if;

  select c.name into v_name
  from public.customers c join _keep k on k.customer_id = c.id;

  -- SJ-000019 is what defines the customer, so if it belongs to someone
  -- other than SEDHU this script would quietly wipe the wrong person's
  -- history. Checked rather than assumed.
  if v_name is null or v_name not ilike '%sedhu%' then
    raise exception
      'SJ-000019 belongs to "%", not SEDHU. Check STEP 0a — nothing was deleted.',
      coalesce(v_name, '(no customer)');
  end if;

  -- Belt and braces: by construction _jobs can only hold this customer's
  -- jobs, but a wrong row here costs someone else their service history.
  select count(*) into v_stray
  from _jobs j
  join public.service_jobs s on s.id = j.id
  where s.customer_id <> (select customer_id from _keep);
  if v_stray > 0 then
    raise exception 'Selection reached % job(s) belonging to another customer — nothing was deleted', v_stray;
  end if;

  select count(*) into v_jobs from _jobs;
  if v_jobs = 0 then
    raise exception 'SEDHU has no other service jobs — nothing to delete';
  end if;

  raise notice 'Keeping SJ-000019. Deleting % job(s) for %, % of billed work',
    v_jobs, v_name, (select coalesce(sum(grand_total), 0) from _jobs where status = 'COMPLETED');
end $$;

-- Children first — every foreign key here is ON DELETE RESTRICT.
delete from public.service_inventory_usage where service_job_id in (select id from _jobs);
delete from public.service_job_events       where service_job_id in (select id from _jobs);
delete from public.service_job_images       where service_job_id in (select id from _jobs);
delete from public.service_job_lines        where service_job_id in (select id from _jobs);
delete from public.service_jobs             where id             in (select id from _jobs);

-- SJ-000019 must have survived all of that.
do $$
declare v_still integer;
begin
  select count(*) into v_still from public.service_jobs where job_number = 'SJ-000019';
  if v_still <> 1 then
    raise exception 'SJ-000019 is gone — rolling back, nothing was deleted';
  end if;
end $$;

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
-- STEP 2 — confirm. Run on its own: the SQL editor only shows the last
-- statement's result, so one combined check beats four separate ones.
-- ---------------------------------------------------------------------

select 'SJ-000019 still there' as check, count(*)::text as value
from public.service_jobs where job_number = 'SJ-000019'
union all
select 'SEDHU jobs remaining', count(*)::text
from public.service_jobs
where customer_id = (select customer_id from public.service_jobs where job_number = 'SJ-000019')
union all
select 'service jobs total', count(*)::text from public.service_jobs
union all
select 'completed job revenue', coalesce(sum(grand_total), 0)::text
from public.service_jobs where status = 'COMPLETED';
-- Want: first row 1, second row 1.
