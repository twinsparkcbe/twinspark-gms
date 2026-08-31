-- =====================================================================
-- Twinspark GMS — what actually created the duplicate service jobs
-- =====================================================================
--
-- Read-only.
--
-- The gap between a duplicate and the job before it is the tell:
--
--   under ~3 seconds  the button was pressed twice before the first save
--                     finished, or before the next page had loaded. That is
--                     the double-submit bug, now fixed in the form.
--
--   seconds to minutes  the first attempt failed and was retried — the old
--                     stock-shortfall or payment-permission failure, where
--                     the job was already created before the error appeared.
--
--   many minutes      genuinely entered twice by hand. Nothing to fix in code.
--
-- Run each query on its own; the Supabase editor shows one result at a time.
--
-- ---------------------------------------------------------------------
-- Q1 — jobs created back-to-back for the same customer and vehicle
-- ---------------------------------------------------------------------

with j as (
  select s.id, s.job_number, s.status, s.grand_total, s.created_at,
         c.name as customer, v.vehicle_number,
         lag(s.job_number)  over (partition by s.customer_id, s.vehicle_id order by s.created_at) as prev_job,
         lag(s.created_at)  over (partition by s.customer_id, s.vehicle_id order by s.created_at) as prev_at,
         lag(s.grand_total) over (partition by s.customer_id, s.vehicle_id order by s.created_at) as prev_total
  from public.service_jobs s
  join public.customers c on c.id = s.customer_id
  join public.vehicles  v on v.id = s.vehicle_id
)
select job_number,
       prev_job,
       customer,
       vehicle_number,
       status,
       grand_total,
       prev_total,
       round(extract(epoch from (created_at - prev_at))::numeric, 1) as seconds_after_previous,
       case
         when extract(epoch from (created_at - prev_at)) < 3   then 'double submit'
         when extract(epoch from (created_at - prev_at)) < 300 then 'retry after a failure'
         else 'entered again by hand'
       end as looks_like,
       created_at at time zone 'Asia/Kolkata' as created_ist
from j
where prev_at is not null
  and created_at - prev_at < interval '30 minutes'
order by created_at desc;


-- ---------------------------------------------------------------------
-- Q2 — the same thing counted, so the answer is one number
-- ---------------------------------------------------------------------

with j as (
  select s.created_at,
         lag(s.created_at) over (partition by s.customer_id, s.vehicle_id order by s.created_at) as prev_at
  from public.service_jobs s
)
select case
         when extract(epoch from (created_at - prev_at)) < 3   then '1. double submit (under 3s)'
         when extract(epoch from (created_at - prev_at)) < 300 then '2. retry after a failure (under 5 min)'
         else '3. entered again by hand'
       end as cause,
       count(*) as jobs
from j
where prev_at is not null and created_at - prev_at < interval '30 minutes'
group by 1
order by 1;


-- ---------------------------------------------------------------------
-- Q3 — the life of one job, from its own event log
-- ---------------------------------------------------------------------
-- Put the job numbers you care about in the list. This shows what was done
-- to each and by whom — a job that was created and then cancelled minutes
-- later with nothing in between is an abandoned duplicate.

select j.job_number,
       e.event_type,
       e.detail,
       coalesce(p.full_name, '(unknown)') as by_whom,
       e.created_at at time zone 'Asia/Kolkata' as at_ist
from public.service_job_events e
join public.service_jobs j on j.id = e.service_job_id
left join public.profiles p on p.id = e.created_by
where j.job_number in ('SJ-000036','SJ-000037','SJ-000038','SJ-000039','SJ-000040','SJ-000041','SJ-000042','SJ-000043')
order by j.job_number, e.created_at;
