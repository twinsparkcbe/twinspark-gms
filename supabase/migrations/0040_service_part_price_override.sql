-- Editable part price on a Service Job — the counter can price a part used on
-- a job for THIS JOB ONLY, exactly the way Sales has worked since 0034.
--
-- Confirmed with the developer 2026-09-02:
--   * Anyone who can work a Service Job may change a part's price. Unlike
--     Sales (0034), there is NO Administrator-only floor at the item's cost
--     price here — a below-cost price is allowed and only warned about on
--     screen. Service work is quoted as a job, and haggling on the part
--     inside it is the same conversation as haggling on the labour, which
--     was always freely editable.
--   * The change applies to this job only. inventory_items.selling_price is
--     untouched and still comes from the newest purchase batch (0011/0012).
--   * A part carried in by a Combo Offer still bills at ₹0 and ignores any
--     price sent for it — the combo price already covers it (0022).
--
-- WHY list_price IS STORED RATHER THAN INFERRED: the same reason as 0034. A
-- part billed at ₹450 is otherwise indistinguishable from one whose catalogue
-- price was always ₹450, and the catalogue price moves on its own every time
-- a new purchase batch lands. Recording both halves at the moment of billing
-- is the only way "what did we give away on this job" stays answerable later.
--
-- Nothing changes in the reports. Revenue flows from service_jobs.grand_total
-- (built from these rows' line_total) and COGS from the real FIFO batch cost
-- in stock_movements × purchase_entries.unit_price, so an overridden price
-- already flows through correctly.

-- ---------------------------------------------------------------------------
-- 1. What the catalogue said, alongside what was charged
-- ---------------------------------------------------------------------------

alter table public.service_inventory_usage
  add column if not exists list_price numeric(12, 2);

alter table public.service_inventory_usage
  drop constraint if exists service_inventory_usage_list_price_positive;

alter table public.service_inventory_usage
  add constraint service_inventory_usage_list_price_positive
    check (list_price is null or list_price >= 0);

-- Existing rows predate the column and stay null: nobody knows what the
-- catalogue said on the day they were billed, and back-filling today's price
-- would invent discounts that never happened.

-- ---------------------------------------------------------------------------
-- 2. replace_service_job_lines() — the single place every job line and usage
--    row is written. create_service_job(), update_service_job() and
--    edit_completed_service_job() all delegate here, so teaching this one
--    function about an override covers creating, editing and correcting.
--
--    Byte-identical to 0022 except for the usage loop at the end.
-- ---------------------------------------------------------------------------

create or replace function public.replace_service_job_lines(
  p_job_id uuid,
  p_lines jsonb,
  p_usage jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_usage jsonb;
  v_position integer := 0;
  v_line_type text;
  v_description text;
  v_quantity integer;
  v_rate numeric;
  v_package_id uuid;
  v_specific_id uuid;
  v_combo_id uuid;
  v_combo_contents text[];
  v_combo_list_value numeric;
  v_item_id uuid;
  v_item_name text;
  v_item_price numeric;
  v_qty_used integer;
  v_usage_combo_id uuid;
  v_included boolean;
  v_explicit_price numeric;
  v_list_price numeric;
begin
  delete from public.service_job_lines where service_job_id = p_job_id;
  delete from public.service_inventory_usage where service_job_id = p_job_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_position := v_position + 1;
    v_line_type := v_line ->> 'line_type';
    v_quantity := coalesce((v_line ->> 'quantity')::integer, 1);
    v_package_id := null;
    v_specific_id := null;
    v_combo_id := null;
    v_combo_contents := null;
    v_combo_list_value := null;

    if v_line_type = 'PACKAGE' then
      v_package_id := (v_line ->> 'general_service_package_id')::uuid;
      select name, service_charge into v_description, v_rate
        from public.general_service_packages where id = v_package_id;
      if v_description is null then
        raise exception 'General Service Package % not found', v_package_id using errcode = 'P0002';
      end if;
      v_rate := coalesce((v_line ->> 'rate')::numeric, v_rate);

    elsif v_line_type = 'SPECIFIC' then
      v_specific_id := (v_line ->> 'specific_service_id')::uuid;
      select name, default_charge into v_description, v_rate
        from public.specific_services where id = v_specific_id;
      if v_description is null then
        raise exception 'Specific Service % not found', v_specific_id using errcode = 'P0002';
      end if;
      v_rate := coalesce((v_line ->> 'rate')::numeric, v_rate, 0);

    elsif v_line_type = 'CUSTOM' then
      v_description := nullif(btrim(coalesce(v_line ->> 'description', '')), '');
      if v_description is null then
        raise exception 'A description is required for a custom service line' using errcode = '22023';
      end if;
      v_rate := (v_line ->> 'rate')::numeric;
      if v_rate is null then
        raise exception 'A rate is required for a custom service line' using errcode = '22023';
      end if;

    elsif v_line_type = 'COMBO' then
      v_combo_id := (v_line ->> 'combo_id')::uuid;
      select name, combo_price into v_description, v_rate
        from public.combos where id = v_combo_id;
      if v_description is null then
        raise exception 'Combo % not found', v_combo_id using errcode = 'P0002';
      end if;
      -- Snapshotted, like every other price here: the offer may be retired or
      -- repriced tomorrow, and this job must keep showing what was charged.
      v_rate := coalesce((v_line ->> 'rate')::numeric, v_rate);
      v_combo_contents := coalesce(
        (select array_agg(value::text order by ordinality)
           from jsonb_array_elements_text(coalesce(v_line -> 'combo_contents', '[]'::jsonb)) with ordinality),
        '{}'
      );
      -- Computed here rather than trusted from the client, so the printed
      -- saving can't be inflated by a tampered request.
      select coalesce(sum(
               case
                 when c.component_type = 'PACKAGE' then coalesce(p.service_charge, 0)
                 when c.component_type = 'SPECIFIC' then coalesce(s.default_charge, 0)
                 else coalesce(i.selling_price, 0)
               end * c.quantity
             ), 0) * v_quantity
        into v_combo_list_value
        from public.combo_components c
        left join public.general_service_packages p on p.id = c.general_service_package_id
        left join public.specific_services s on s.id = c.specific_service_id
        left join public.inventory_items i on i.id = c.inventory_item_id
       where c.combo_id = v_combo_id and c.pricing = 'INCLUDED';

    else
      raise exception 'Unknown service line type %', v_line_type using errcode = '22023';
    end if;

    if v_quantity <= 0 then
      raise exception 'Quantity must be greater than zero' using errcode = '22023';
    end if;
    if v_rate < 0 then
      raise exception 'Rate cannot be negative' using errcode = '22023';
    end if;

    insert into public.service_job_lines
      (service_job_id, position, line_type, general_service_package_id, specific_service_id, combo_id, combo_contents, combo_list_value,
       description, quantity, rate)
    values
      (p_job_id, v_position, v_line_type, v_package_id, v_specific_id, v_combo_id, v_combo_contents, v_combo_list_value,
       v_description, v_quantity, v_rate);
  end loop;

  for v_usage in select * from jsonb_array_elements(coalesce(p_usage, '[]'::jsonb))
  loop
    v_item_id := (v_usage ->> 'inventory_item_id')::uuid;
    v_qty_used := (v_usage ->> 'quantity_used')::integer;
    v_usage_combo_id := nullif(v_usage ->> 'combo_id', '')::uuid;
    v_included := coalesce((v_usage ->> 'included_in_combo')::boolean, false);
    v_explicit_price := (v_usage ->> 'unit_price')::numeric;

    if v_qty_used is null or v_qty_used <= 0 then
      raise exception 'Quantity used must be greater than zero' using errcode = '22023';
    end if;

    select product_name, selling_price into v_item_name, v_item_price
      from public.inventory_items where id = v_item_id and is_active;
    if v_item_name is null then
      raise exception 'Inventory item % not found or inactive', v_item_id using errcode = 'P0002';
    end if;

    -- What the catalogue says right now, kept whatever gets charged below, so
    -- a negotiated price stays distinguishable from a part that was cheap.
    v_list_price := v_item_price;

    -- Price precedence: a part included in a combo is already paid for by the
    -- combo price and bills at zero regardless of what the client sent; then
    -- whatever was negotiated for this job; then the catalogue price.
    if v_included then
      v_item_price := 0;
    elsif v_explicit_price is not null then
      if v_explicit_price <= 0 then
        raise exception 'A part price must be greater than zero' using errcode = '22023';
      end if;
      -- Deliberately no below-cost guard here (see this migration's header):
      -- unlike a Sale, any user who can work the job may price a part freely.
      v_item_price := v_explicit_price;
    end if;

    if v_item_price < 0 then
      raise exception 'Unit price cannot be negative' using errcode = '22023';
    end if;

    insert into public.service_inventory_usage
      (service_job_id, inventory_item_id, item_name_snapshot, quantity_used, unit_price_snapshot, list_price, combo_id, included_in_combo)
    values
      (p_job_id, v_item_id, v_item_name, v_qty_used, v_item_price, v_list_price, v_usage_combo_id, v_included);
  end loop;
end;
$$;
