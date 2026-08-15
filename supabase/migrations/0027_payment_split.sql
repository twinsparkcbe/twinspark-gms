-- Payment split — cash / UPI / both, on Sales and Service.
-- doc/payment-split-scope.md.
--
-- 0024 recorded *whether* a sale was paid; it recorded nothing about *how*.
-- A ₹2,000 bill settled as ₹1,000 UPI + ₹1,000 cash was indistinguishable
-- from ₹2,000 cash, so the cash box could never be reconciled against the
-- bank. This adds the tender breakdown to both modules and makes
-- `payment_status` a *derived* value rather than a separately-chosen one.
--
-- Design note — why `payment_status` is derived. Previously the form sent a
-- status and the amounts didn't exist, so nothing could contradict anything.
-- With amounts present, a stored status is a second source of truth that can
-- drift (PAID with ₹0 collected). Deriving it from cash+upi vs grand_total
-- makes that impossible, and as a side effect finally makes 'PARTIAL' —
-- present in 0024's check constraint but unreachable from any screen —
-- something the UI can actually produce.
--
-- Design note — why a wrapper instead of a fourth copy of record_sale().
-- record_sale()'s body has already been re-emitted verbatim three times
-- (0022 combos, 0024 payment status, 0026 role helpers); each copy is a
-- chance to silently drop a fix. record_sale_with_payment() calls the
-- existing function and applies the payment in the same transaction, so
-- behaviour stays atomic — if the payment step raises, the sale, its lines
-- and every stock deduction roll back together — without duplicating 300
-- lines of pricing logic that would then need maintaining in two places.
-- record_sale() itself is untouched and still callable.
--
-- Backfill: none, deliberately. Existing rows get payment_mode = null and
-- zero amounts, keeping whatever payment_status they already carry. A
-- historic PAID sale therefore reads as "paid, tender unrecorded" — which is
-- the truth; we do not know how those were settled, and defaulting them to
-- cash would invent data that then shows up as fact in the Collections
-- report. Those rows surface in that report's own `Unrecorded` bucket.
--
-- Idempotency note (see prior migration headers): safely re-runnable.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table public.sales
  add column if not exists payment_mode text,
  add column if not exists cash_amount numeric(14, 2) not null default 0,
  add column if not exists upi_amount numeric(14, 2) not null default 0;

alter table public.sales drop constraint if exists sales_payment_mode_check;
alter table public.sales
  add constraint sales_payment_mode_check
  check (payment_mode is null or payment_mode in ('CASH', 'UPI', 'SPLIT'));

alter table public.sales drop constraint if exists sales_cash_amount_check;
alter table public.sales add constraint sales_cash_amount_check check (cash_amount >= 0);

alter table public.sales drop constraint if exists sales_upi_amount_check;
alter table public.sales add constraint sales_upi_amount_check check (upi_amount >= 0);

alter table public.service_jobs
  add column if not exists payment_mode text,
  add column if not exists cash_amount numeric(14, 2) not null default 0,
  add column if not exists upi_amount numeric(14, 2) not null default 0;

alter table public.service_jobs drop constraint if exists service_jobs_payment_mode_check;
alter table public.service_jobs
  add constraint service_jobs_payment_mode_check
  check (payment_mode is null or payment_mode in ('CASH', 'UPI', 'SPLIT'));

alter table public.service_jobs drop constraint if exists service_jobs_cash_amount_check;
alter table public.service_jobs add constraint service_jobs_cash_amount_check check (cash_amount >= 0);

alter table public.service_jobs drop constraint if exists service_jobs_upi_amount_check;
alter table public.service_jobs add constraint service_jobs_upi_amount_check check (upi_amount >= 0);

-- Partial indexes: the Collections report scans by tender, and the
-- outstanding figure only ever looks at bills that aren't settled.
create index if not exists sales_payment_mode_idx on public.sales (payment_mode) where payment_mode is not null;
create index if not exists service_jobs_payment_mode_idx on public.service_jobs (payment_mode) where payment_mode is not null;

-- ---------------------------------------------------------------------------
-- 2. Shared derivation — the SQL mirror of services/shared/payment.ts.
--
--    A zero-value bill (fully discounted) is PAID, not PENDING: there is
--    nothing left to collect, so flagging it as a debt would be wrong.
--    Rounding both sides to paise before comparing keeps
--    333.33 + 666.67 >= 1000 true instead of failing on float residue.
-- ---------------------------------------------------------------------------

create or replace function public.derive_payment_status(
  p_cash_amount numeric,
  p_upi_amount numeric,
  p_grand_total numeric
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when round(coalesce(p_grand_total, 0), 2) <= 0 then 'PAID'
    when round(coalesce(p_cash_amount, 0) + coalesce(p_upi_amount, 0), 2) <= 0 then 'PENDING'
    when round(coalesce(p_cash_amount, 0) + coalesce(p_upi_amount, 0), 2)
         >= round(coalesce(p_grand_total, 0), 2) then 'PAID'
    else 'PARTIAL'
  end;
$$;

grant execute on function public.derive_payment_status(numeric, numeric, numeric) to authenticated;

-- Canonical mode for a pair of amounts. A SPLIT with one side zero is stored
-- as the single mode it actually is — the counter person shouldn't be
-- rejected over a technicality they can't see on screen.
create or replace function public.derive_payment_mode(
  p_cash_amount numeric,
  p_upi_amount numeric
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when round(coalesce(p_cash_amount, 0), 2) <= 0 and round(coalesce(p_upi_amount, 0), 2) <= 0 then null
    when round(coalesce(p_cash_amount, 0), 2) <= 0 then 'UPI'
    when round(coalesce(p_upi_amount, 0), 2) <= 0 then 'CASH'
    else 'SPLIT'
  end;
$$;

grant execute on function public.derive_payment_mode(numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. record_sale_with_payment() — the only path the app uses to record a sale.
--
--    Validation of cash+upi against the total *must* happen here rather than
--    in the client: the authoritative grand total only exists after
--    record_sale() has priced every line, expanded any combo and applied
--    GST/discount.
-- ---------------------------------------------------------------------------

create or replace function public.record_sale_with_payment(
  p_customer_name text,
  p_customer_mobile text,
  p_customer_address text,
  p_gst_applicable boolean,
  p_gst_amount numeric,
  p_discount_applicable boolean,
  p_discount_amount numeric,
  p_lines jsonb,
  p_payment_mode text,
  p_cash_amount numeric,
  p_upi_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id uuid;
  v_grand_total numeric;
  v_cash numeric := round(coalesce(p_cash_amount, 0), 2);
  v_upi numeric := round(coalesce(p_upi_amount, 0), 2);
  v_mode text;
  v_status text;
begin
  if p_payment_mode is not null and p_payment_mode not in ('CASH', 'UPI', 'SPLIT') then
    raise exception 'Unknown payment mode %', p_payment_mode using errcode = '22023';
  end if;
  if v_cash < 0 or v_upi < 0 then
    raise exception 'Payment amounts cannot be negative' using errcode = '22023';
  end if;

  -- A caller-supplied mode narrows the amounts before they're trusted, so a
  -- tampered payload can't record "cash" while quietly banking UPI.
  if p_payment_mode = 'CASH' then
    v_upi := 0;
  elsif p_payment_mode = 'UPI' then
    v_cash := 0;
  elsif p_payment_mode is null then
    v_cash := 0;
    v_upi := 0;
  end if;

  -- 'PENDING' rather than 'PAID' as the interim value: if anything below
  -- were ever to fail open, an uncollected bill is a chase, a wrongly-settled
  -- one is lost money.
  v_sale_id := public.record_sale(
    p_customer_name,
    p_customer_mobile,
    p_customer_address,
    p_gst_applicable,
    p_gst_amount,
    p_discount_applicable,
    p_discount_amount,
    p_lines,
    'PENDING'
  );

  select grand_total into v_grand_total from public.sales where id = v_sale_id;

  if round(v_cash + v_upi, 2) > round(coalesce(v_grand_total, 0), 2) then
    raise exception 'Cash + UPI (%) is more than the bill total (%)',
      round(v_cash + v_upi, 2), round(coalesce(v_grand_total, 0), 2) using errcode = '22023';
  end if;

  v_mode := public.derive_payment_mode(v_cash, v_upi);
  v_status := public.derive_payment_status(v_cash, v_upi, v_grand_total);

  update public.sales
    set payment_mode = v_mode,
        cash_amount = v_cash,
        upi_amount = v_upi,
        payment_status = v_status
    where id = v_sale_id;

  return v_sale_id;
end;
$$;

grant execute on function public.record_sale_with_payment(
  text, text, text, boolean, numeric, boolean, numeric, jsonb, text, numeric, numeric
) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. update_sales_payment_status() — settling a bill after the fact.
--
--    The old (uuid, text) signature is dropped rather than left alongside:
--    keeping both would let a caller set a status directly and reintroduce
--    exactly the status/amount disagreement this migration exists to remove.
--    It had no UI wired to it, so nothing in the app breaks.
-- ---------------------------------------------------------------------------

drop function if exists public.update_sales_payment_status(uuid, text);

create or replace function public.update_sales_payment_status(
  p_sale_id uuid,
  p_payment_mode text,
  p_cash_amount numeric,
  p_upi_amount numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grand_total numeric;
  v_cash numeric := round(coalesce(p_cash_amount, 0), 2);
  v_upi numeric := round(coalesce(p_upi_amount, 0), 2);
  v_mode text;
begin
  if not public.has_sales_access() then
    raise exception 'Not authorized to update a sale' using errcode = '42501';
  end if;
  if p_payment_mode is not null and p_payment_mode not in ('CASH', 'UPI', 'SPLIT') then
    raise exception 'Unknown payment mode %', p_payment_mode using errcode = '22023';
  end if;
  if v_cash < 0 or v_upi < 0 then
    raise exception 'Payment amounts cannot be negative' using errcode = '22023';
  end if;

  if p_payment_mode = 'CASH' then
    v_upi := 0;
  elsif p_payment_mode = 'UPI' then
    v_cash := 0;
  elsif p_payment_mode is null then
    v_cash := 0;
    v_upi := 0;
  end if;

  select grand_total into v_grand_total from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale % not found', p_sale_id using errcode = 'P0002';
  end if;

  if round(v_cash + v_upi, 2) > round(coalesce(v_grand_total, 0), 2) then
    raise exception 'Cash + UPI (%) is more than the bill total (%)',
      round(v_cash + v_upi, 2), round(coalesce(v_grand_total, 0), 2) using errcode = '22023';
  end if;

  v_mode := public.derive_payment_mode(v_cash, v_upi);

  update public.sales
    set payment_mode = v_mode,
        cash_amount = v_cash,
        upi_amount = v_upi,
        payment_status = public.derive_payment_status(v_cash, v_upi, v_grand_total)
    where id = p_sale_id;
end;
$$;

grant execute on function public.update_sales_payment_status(uuid, text, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. update_service_payment_status() — same treatment, plus FREE_SERVICE.
--
--    FREE_SERVICE stays an explicit flag and is never derived: ₹0 collected
--    on a warranty job is a different business fact from ₹0 collected on an
--    unpaid one, and only the person completing the job knows which it is.
--
--    Guard, COMPLETED-only rule and the audit event are carried over from
--    0016/0026 unchanged — Mechanics still cannot touch payment.
-- ---------------------------------------------------------------------------

drop function if exists public.update_service_payment_status(uuid, text);

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
  if not public.is_admin() then
    raise exception 'Only Administrators can update payment status' using errcode = '42501';
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

  insert into public.service_job_events (service_job_id, event_type, detail, created_by)
  values (p_service_job_id, 'PAYMENT_STATUS_CHANGED', v_payment_status, auth.uid());
end;
$$;

grant execute on function public.update_service_payment_status(uuid, text, numeric, numeric, boolean) to authenticated;
