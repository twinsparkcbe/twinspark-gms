-- Service payment status: anyone who works the Service module, not just the owner.
--
-- Recording the tender used to be Administrator-only (0027). The rule behind
-- it was cash reconciliation: a Mechanic could finish a job and hand the bike
-- over, but only the owner said it had been paid for.
--
-- In this shop the person billing the job at the counter is the person taking
-- the money, and they are not always the owner. Leaving the rule in place
-- meant every job they completed sat at PENDING until the owner cleared it,
-- and — worse — the completion screen offered them a Cash/UPI picker whose
-- value the database then refused, AFTER the invoice had been generated and
-- the stock deducted. The job was billed; the screen said "Only
-- Administrators can update payment status"; pressing the button again made
-- a second job.
--
-- The gate becomes has_service_access() — the same test that decides who may
-- open the Service module at all (Administrator and Mechanic; a Sales Person
-- has no Service access and still cannot reach this). It is NOT dropped:
-- every other guard in the function stays exactly as it was, including the
-- COMPLETED-only rule and the cash + UPI ≤ bill total rule.
--
-- Sales is deliberately untouched. update_sales_payment_status() keeps its
-- own rule; this migration is only about Service.
--
-- Identical signature, so CREATE OR REPLACE really replaces rather than
-- adding a second overload (the trap that needed repairing in 0035).

create or replace function public.update_service_payment_status(
  p_service_job_id uuid,
  p_payment_mode text,
  p_cash_amount numeric,
  p_upi_amount numeric,
  p_free_service boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_grand_total numeric;
  v_cash numeric := round(coalesce(p_cash_amount, 0), 2);
  v_upi numeric := round(coalesce(p_upi_amount, 0), 2);
  v_mode text;
  v_payment_status text;
begin
  -- The only line that changes. 42501 is kept: the app already maps that code
  -- to its authorisation message, and a Sales Person reaching this by any
  -- route must still be refused.
  if not public.has_service_access() then
    raise exception 'Not authorized to update payment status on a Service Job' using errcode = '42501';
  end if;
  if p_payment_mode is not null and p_payment_mode not in ('CASH', 'UPI', 'SPLIT') then
    raise exception 'Unknown payment mode %', p_payment_mode using errcode = '22023';
  end if;
  if v_cash < 0 or v_upi < 0 then
    raise exception 'Payment amounts cannot be negative' using errcode = '22023';
  end if;

  select status, grand_total into v_status, v_grand_total
    from public.service_jobs where id = p_service_job_id for update;
  if not found then
    raise exception 'Service Job % not found', p_service_job_id using errcode = 'P0002';
  end if;
  if v_status <> 'COMPLETED' then
    raise exception 'Payment status can only be set on a Completed Service Job' using errcode = '22023';
  end if;

  if coalesce(p_free_service, false) then
    v_cash := 0;
    v_upi := 0;
    v_mode := null;
    v_payment_status := 'FREE_SERVICE';
  else
    if p_payment_mode = 'CASH' then
      v_upi := 0;
    elsif p_payment_mode = 'UPI' then
      v_cash := 0;
    elsif p_payment_mode is null then
      v_cash := 0;
      v_upi := 0;
    end if;

    if round(v_cash + v_upi, 2) > round(coalesce(v_grand_total, 0), 2) then
      raise exception 'Cash + UPI (%) is more than the bill total (%)',
        round(v_cash + v_upi, 2), round(coalesce(v_grand_total, 0), 2) using errcode = '22023';
    end if;

    v_mode := public.derive_payment_mode(v_cash, v_upi);
    v_payment_status := public.derive_payment_status(v_cash, v_upi, v_grand_total);
  end if;

  update public.service_jobs
    set payment_mode = v_mode,
        cash_amount = v_cash,
        upi_amount = v_upi,
        payment_status = v_payment_status
    where id = p_service_job_id;

  -- created_by still records WHO marked it paid, so the owner can see at a
  -- glance which of their people cleared which invoice.
  insert into public.service_job_events (service_job_id, event_type, detail, created_by)
  values (p_service_job_id, 'PAYMENT_STATUS_CHANGED', v_payment_status, auth.uid());
end;
$$;

notify pgrst, 'reload schema';
