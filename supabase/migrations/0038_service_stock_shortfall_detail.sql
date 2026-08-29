-- Service Jobs — say WHICH part is short, and by how much.
--
-- Completing a job failed with "Not enough stock available for one of the
-- parts used on this job." That is all the mechanic saw: no part name, no
-- numbers, no way to know what to restock. The message came from
-- adjust_stock(), which raises 'Insufficient stock, or item <uuid> not
-- found' — so the service layer replaced it wholesale rather than show a
-- customer a raw UUID. The information never existed at any layer.
--
-- Fixed here rather than in the app because the shortfall is only knowable
-- inside the transaction that locks the rows, and because two different
-- functions deduct service stock. Both now go through one helper.
--
-- ---------------------------------------------------------------------------
-- 1. deduct_service_job_stock() — pre-flight check that names every part
-- ---------------------------------------------------------------------------

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
  v_short text;
begin
  -- Checked up front, across the whole parts list, so the message can name
  -- every shortfall at once. Reporting them one at a time would mean
  -- restocking, retrying, and discovering the next one — which is exactly
  -- the loop this replaces.
  --
  -- Grouped by item, not per usage row: the same part can appear on two
  -- lines of one job, and 2 + 2 against a stock of 3 is short even though
  -- neither line is short on its own.
  select string_agg(x.msg, '; ' order by x.product_name) into v_short
  from (
    select i.product_name,
           format(
             '%s (need %s, have %s)',
             i.product_name,
             sum(u.quantity_used),
             i.available_quantity
           ) as msg
    from public.service_inventory_usage u
    join public.inventory_items i on i.id = u.inventory_item_id
    where u.service_job_id = p_service_job_id
      and not u.stock_deducted
    group by i.id, i.product_name, i.available_quantity
    having sum(u.quantity_used) > i.available_quantity
  ) x;

  if v_short is not null then
    -- P0001 kept deliberately: the app already maps that code to its
    -- insufficient-stock error, and this only changes the wording.
    raise exception 'Not enough stock: %', v_short using errcode = 'P0001';
  end if;

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
-- 2. complete_service_job() — same signature (so CREATE OR REPLACE really
--    replaces, no second overload), with its duplicated deduction loop
--    replaced by a call to the helper above. Identical behaviour otherwise.
-- ---------------------------------------------------------------------------

create or replace function public.complete_service_job(p_service_job_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_line_count integer;
  v_invoice_number text;
  v_subtotal numeric;
  v_inventory_total numeric;
  v_gst numeric;
  v_discount numeric;
begin
  if not public.has_service_access() then
    raise exception 'Not authorized to complete a Service Job' using errcode = '42501';
  end if;

  select status into v_status from public.service_jobs where id = p_service_job_id for update;
  if not found then
    raise exception 'Service Job % not found', p_service_job_id using errcode = 'P0002';
  end if;
  if v_status not in ('IN_PROGRESS', 'READY_FOR_DELIVERY') then
    raise exception 'A Service Job can only be completed from In Progress or Ready for Delivery' using errcode = '22023';
  end if;

  select count(*) into v_line_count from public.service_job_lines where service_job_id = p_service_job_id;
  if v_line_count = 0 then
    raise exception 'A Service Job needs at least one service line before it can be completed' using errcode = '22023';
  end if;

  -- One shared deduction path with edit_completed_service_job (0028). The
  -- loop used to be copied out here, which is how the two drifted: only one
  -- of them would have gained the named-shortfall message. Any raise inside
  -- aborts this whole function, so the job stays exactly as it was.
  perform public.deduct_service_job_stock(p_service_job_id);

  select coalesce(sum(amount), 0) into v_subtotal from public.service_job_lines where service_job_id = p_service_job_id;
  select coalesce(sum(line_total), 0) into v_inventory_total from public.service_inventory_usage where service_job_id = p_service_job_id;
  select gst_amount, discount_amount into v_gst, v_discount from public.service_jobs where id = p_service_job_id;

  v_invoice_number := public.next_service_invoice_number();

  update public.service_jobs
    set status = 'COMPLETED',
        invoice_number = v_invoice_number,
        completed_at = now(),
        payment_status = 'PENDING',
        delivery_status = 'WAITING',
        subtotal = v_subtotal,
        inventory_total = v_inventory_total,
        grand_total = v_subtotal + v_inventory_total + coalesce(v_gst, 0) - coalesce(v_discount, 0)
    where id = p_service_job_id;

  insert into public.service_job_events (service_job_id, event_type, detail, created_by)
  values (p_service_job_id, 'JOB_COMPLETED', 'Invoice ' || v_invoice_number || ' generated', auth.uid());

  return v_invoice_number;
end;
$$;

notify pgrst, 'reload schema';
