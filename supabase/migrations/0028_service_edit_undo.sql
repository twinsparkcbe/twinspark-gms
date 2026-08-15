-- Service — Edit a Completed Job & Undo Completion.
-- doc/service-edit-undo-scope.md.
--
-- Until now COMPLETED was a dead end. complete_service_job() deducts stock and
-- stamps an invoice number, and update_service_job() refuses anything past
-- IN_PROGRESS, so a wrong quantity, rate or GST figure discovered after billing
-- could only be "fixed" by raising a second job — which double-counts both
-- stock and revenue. Two recoveries, deliberately different:
--
--   edit_completed_service_job()  corrects the job in place. Invoice number is
--                                 KEPT, stock is reconciled to the corrected
--                                 parts list, payment status is re-derived
--                                 against the new total.
--   undo_service_completion()     reverses the completion outright. Stock fully
--                                 restored, invoice number cleared, job back to
--                                 IN_PROGRESS. Re-completing draws a FRESH
--                                 invoice number — a gap in the TW-J- series is
--                                 accepted, since the voided number was never a
--                                 valid bill.
--
-- Design note — wrappers, not copies. Both functions drive the existing
-- update_service_job() / replace_service_job_lines() /
-- recompute_service_job_totals() / adjust_stock() rather than re-emitting their
-- bodies, following the record_sale_with_payment() precedent in 0027: every
-- verbatim re-emission of a large function is a chance to silently drop a fix.
-- edit_completed_service_job() reopens the job to IN_PROGRESS *inside its own
-- transaction* purely so update_service_job()'s status guard passes, then puts
-- it back — no caller ever observes the intermediate state.
--
-- Design note — why stock is reversed then re-deducted, rather than diffed.
-- replace_service_job_lines() deletes and reinserts every usage row, so there
-- is no stable row identity to diff against. Reversing the old deduction in
-- full and re-deducting the corrected list is simpler, uses the one audited
-- stock path, and leaves a truthful pair of movements in stock_movements. A
-- part whose quantity didn't change does produce two offsetting movements —
-- that is the honest record of a correction, not noise to be optimised away.
--
-- Idempotency note (see prior migration headers): safely re-runnable.

-- ---------------------------------------------------------------------------
-- 1. Two new audit event types.
-- ---------------------------------------------------------------------------

alter table public.service_job_events drop constraint if exists service_job_events_event_type_check;
alter table public.service_job_events
  add constraint service_job_events_event_type_check
  check (
    event_type in (
      'JOB_CREATED',
      'STATUS_CHANGED',
      'JOB_COMPLETED',
      'PAYMENT_STATUS_CHANGED',
      'DELIVERY_STATUS_CHANGED',
      'JOB_EDITED',
      'JOB_UNCOMPLETED'
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Internal stock helpers.
--
--    Deliberately NOT granted to authenticated: they carry no authorization
--    check of their own, because both callers below have already established
--    that the caller is an Administrator acting on a COMPLETED job. Exposing
--    restore_service_job_stock() directly would hand any Mechanic an
--    unaudited way to inflate stock (adjust_stock permits SERVICE_USAGE for
--    them). Inside a SECURITY DEFINER function the definer's rights apply, so
--    the callers below can still reach them.
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
    -- most recent cost, the same approach Sale Return uses (0026 §adjust_stock)
    -- rather than reconstructing which FIFO batches the original deduction
    -- drained.
    perform public.adjust_stock(v_usage.inventory_item_id, v_usage.quantity_used, 'SERVICE_USAGE', 'service', p_note);
    update public.service_inventory_usage set stock_deducted = false where id = v_usage.id;
  end loop;
end;
$$;

revoke execute on function public.restore_service_job_stock(uuid, text) from public;

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
begin
  for v_usage in
    select id, inventory_item_id, quantity_used
      from public.service_inventory_usage
      where service_job_id = p_service_job_id and not stock_deducted
      for update
  loop
    perform public.adjust_stock(v_usage.inventory_item_id, -v_usage.quantity_used, 'SERVICE_USAGE', 'service', null);
    update public.service_inventory_usage set stock_deducted = true where id = v_usage.id;
  end loop;
end;
$$;

revoke execute on function public.deduct_service_job_stock(uuid) from public;

-- ---------------------------------------------------------------------------
-- 3. undo_service_completion() — the ONLY way out of COMPLETED.
--
--    Administrator-only, and a reason is required, mirroring
--    undo_sale_return() in 0015. Allowed even when the job was paid or
--    delivered: the UI states both facts in the confirmation dialog, and
--    refusing here would leave a genuinely wrong bill permanently
--    uncorrectable, which is the problem this feature exists to solve.
-- ---------------------------------------------------------------------------

create or replace function public.undo_service_completion(
  p_service_job_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_invoice_number text;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_admin() then
    raise exception 'Only Administrators can undo a completed Service Job' using errcode = '42501';
  end if;
  if v_reason = '' then
    raise exception 'A reason is required to undo a completed Service Job' using errcode = '22023';
  end if;

  select status, invoice_number into v_status, v_invoice_number
    from public.service_jobs where id = p_service_job_id for update;
  if not found then
    raise exception 'Service Job % not found', p_service_job_id using errcode = 'P0002';
  end if;
  if v_status <> 'COMPLETED' then
    raise exception 'Only a Completed Service Job can be undone' using errcode = '22023';
  end if;

  perform public.restore_service_job_stock(
    p_service_job_id,
    'Undo completion of ' || coalesce(v_invoice_number, 'service job') || ' — ' || v_reason
  );

  -- payment_status/delivery_status go back to null rather than PENDING/WAITING:
  -- 0016's schema comment is explicit that both are null until COMPLETED, and
  -- an IN_PROGRESS job sitting at "payment pending" would show up on the
  -- outstanding-money list with no invoice behind it.
  update public.service_jobs
    set status = 'IN_PROGRESS',
        invoice_number = null,
        completed_at = null,
        delivered_at = null,
        payment_status = null,
        payment_mode = null,
        cash_amount = 0,
        upi_amount = 0,
        delivery_status = null
    where id = p_service_job_id;

  insert into public.service_job_events (service_job_id, event_type, detail, created_by)
  values (
    p_service_job_id,
    'JOB_UNCOMPLETED',
    'Invoice ' || coalesce(v_invoice_number, '(none)') || ' voided, stock restored — ' || v_reason,
    auth.uid()
  );
end;
$$;

grant execute on function public.undo_service_completion(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. edit_completed_service_job() — corrects a billed job in place.
--
--    Administrator-only. Keeps the invoice number, completed_at,
--    delivery_status and delivered_at; everything else on the form is
--    replaceable, including the parts used and the tender recorded.
--
--    Over-collection is rejected rather than silently clamped: if the
--    corrected total lands below what was already taken from the customer,
--    real money is owed back, and that is a refund decision for the owner —
--    not something this function should paper over by rewriting the amounts.
--    The edit screen carries the payment fields, so the admin corrects both in
--    the same submit.
-- ---------------------------------------------------------------------------

create or replace function public.edit_completed_service_job(
  p_service_job_id uuid,
  p_customer_name text,
  p_customer_mobile text,
  p_customer_address text,
  p_vehicle_number text,
  p_vehicle_model text,
  p_odometer_reading integer,
  p_complaint_notes text,
  p_mechanic_notes text,
  p_expected_delivery_at timestamptz,
  p_gst_applicable boolean,
  p_gst_amount numeric,
  p_discount_applicable boolean,
  p_discount_amount numeric,
  p_lines jsonb,
  p_usage jsonb,
  p_assigned_mechanic_id uuid default null,
  p_payment_mode text default null,
  p_cash_amount numeric default 0,
  p_upi_amount numeric default 0,
  p_free_service boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_invoice_number text;
  v_completed_at timestamptz;
  v_delivery_status text;
  v_old_total numeric;
  v_new_total numeric;
  v_line_count integer;
  v_cash numeric := round(coalesce(p_cash_amount, 0), 2);
  v_upi numeric := round(coalesce(p_upi_amount, 0), 2);
  v_mode text;
  v_payment_status text;
begin
  if not public.is_admin() then
    raise exception 'Only Administrators can edit a completed Service Job' using errcode = '42501';
  end if;
  if p_payment_mode is not null and p_payment_mode not in ('CASH', 'UPI', 'SPLIT') then
    raise exception 'Unknown payment mode %', p_payment_mode using errcode = '22023';
  end if;
  if v_cash < 0 or v_upi < 0 then
    raise exception 'Payment amounts cannot be negative' using errcode = '22023';
  end if;

  select status, invoice_number, completed_at, delivery_status, grand_total
    into v_status, v_invoice_number, v_completed_at, v_delivery_status, v_old_total
    from public.service_jobs where id = p_service_job_id for update;
  if not found then
    raise exception 'Service Job % not found', p_service_job_id using errcode = 'P0002';
  end if;
  if v_status <> 'COMPLETED' then
    raise exception 'This job is not Completed — edit it through the normal Edit screen' using errcode = '22023';
  end if;

  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'A completed Service Job must keep at least one service line' using errcode = '22023';
  end if;

  -- Step 1: pull back everything the original completion deducted. Must run
  -- before replace_service_job_lines(), which deletes the usage rows this
  -- reads.
  perform public.restore_service_job_stock(
    p_service_job_id,
    'Correction to ' || coalesce(v_invoice_number, 'service job')
  );

  -- Step 2: reopen just far enough for update_service_job()'s own
  -- DRAFT/IN_PROGRESS guard. Same transaction — never externally visible.
  update public.service_jobs set status = 'IN_PROGRESS' where id = p_service_job_id;

  perform public.update_service_job(
    p_service_job_id,
    p_customer_name,
    p_customer_mobile,
    p_customer_address,
    p_vehicle_number,
    p_vehicle_model,
    p_odometer_reading,
    p_complaint_notes,
    p_mechanic_notes,
    p_expected_delivery_at,
    p_gst_applicable,
    p_gst_amount,
    p_discount_applicable,
    p_discount_amount,
    p_lines,
    p_usage,
    p_assigned_mechanic_id
  );

  -- Step 3: deduct the corrected parts list. An insufficient-stock raise here
  -- aborts the whole function — the job, its lines and every stock movement
  -- above roll back together.
  perform public.deduct_service_job_stock(p_service_job_id);

  select grand_total into v_new_total from public.service_jobs where id = p_service_job_id;

  select count(*) into v_line_count from public.service_job_lines where service_job_id = p_service_job_id;
  if v_line_count = 0 then
    raise exception 'A completed Service Job must keep at least one service line' using errcode = '22023';
  end if;

  -- Step 4: re-derive payment against the corrected total. Mirrors
  -- update_service_payment_status() (0027) rather than calling it, because
  -- that function refuses a job that isn't COMPLETED and this one is mid-edit.
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

    if round(v_cash + v_upi, 2) > round(coalesce(v_new_total, 0), 2) then
      raise exception 'Recorded payment (%) is more than the corrected total (%) — reduce the payment on this job first',
        round(v_cash + v_upi, 2), round(coalesce(v_new_total, 0), 2) using errcode = '22023';
    end if;

    v_mode := public.derive_payment_mode(v_cash, v_upi);
    v_payment_status := public.derive_payment_status(v_cash, v_upi, v_new_total);
  end if;

  -- Step 5: restore the completed identity. delivered_at is deliberately left
  -- untouched — the bike was handed over, and correcting the paperwork doesn't
  -- un-hand it.
  update public.service_jobs
    set status = 'COMPLETED',
        invoice_number = v_invoice_number,
        completed_at = v_completed_at,
        delivery_status = v_delivery_status,
        payment_mode = v_mode,
        cash_amount = v_cash,
        upi_amount = v_upi,
        payment_status = v_payment_status
    where id = p_service_job_id;

  insert into public.service_job_events (service_job_id, event_type, detail, created_by)
  values (
    p_service_job_id,
    'JOB_EDITED',
    'Invoice ' || coalesce(v_invoice_number, '(none)') || ' corrected — total '
      || to_char(coalesce(v_old_total, 0), 'FM999999990.00') || ' to '
      || to_char(coalesce(v_new_total, 0), 'FM999999990.00'),
    auth.uid()
  );
end;
$$;

grant execute on function public.edit_completed_service_job(
  uuid, text, text, text, text, text, integer, text, text, timestamptz,
  boolean, numeric, boolean, numeric, jsonb, jsonb, uuid, text, numeric, numeric, boolean
) to authenticated;
