-- Payment status on a Sale (doc/sales-ux-rework-plan.md Gap 7).
--
-- Sales recorded nothing about whether the money was collected, so a settled
-- invoice and an unpaid one looked identical. Service already tracks this
-- (0016 §11); this brings Sales in line.
--
-- Deliberately narrower than Service's four-way status. Service has
-- FREE_SERVICE for warranty/goodwill work, which has no counter equivalent,
-- and the Sales screen only ever offers a single "Customer has paid" tick —
-- so the states that can actually be produced are PAID and PENDING. PARTIAL
-- is included in the constraint because part-payment on a large tyre sale is
-- plausible and a text+check column costs nothing to widen now versus an
-- ALTER later.
--
-- Backfill: every existing sale is marked PAID. These are historical
-- counter sales from before the concept existed, and the shop was cash on
-- collection throughout — marking them PENDING would invent a debt column
-- full of false entries. **Flagging this as an assumption**: if there are
-- genuinely unpaid past invoices, they'll need correcting by hand.
--
-- Idempotency note (see prior migration headers): safely re-runnable.

-- ---------------------------------------------------------------------------
-- 1. Column
-- ---------------------------------------------------------------------------

alter table public.sales
  add column if not exists payment_status text not null default 'PAID';

alter table public.sales drop constraint if exists sales_payment_status_check;
alter table public.sales
  add constraint sales_payment_status_check check (payment_status in ('PENDING', 'PARTIAL', 'PAID'));

-- Explicit backfill for rows that predate the column. The DEFAULT above
-- already covers them, but stating it makes the assumption auditable rather
-- than implicit in a default clause.
update public.sales set payment_status = 'PAID' where payment_status is null;

create index if not exists sales_payment_status_idx on public.sales (payment_status) where payment_status <> 'PAID';

-- ---------------------------------------------------------------------------
-- 2. record_sale() — accepts the payment status chosen on the form.
--
--    Only this one parameter is added; every other line of the function is
--    unchanged from 0022. Defaulting to 'PAID' matches the form's
--    pre-ticked "Customer has paid" box and keeps any existing caller that
--    doesn't pass it working exactly as before.
-- ---------------------------------------------------------------------------

create or replace function public.record_sale(
  p_customer_name text,
  p_customer_mobile text,
  p_customer_address text,
  p_gst_applicable boolean,
  p_gst_amount numeric,
  p_discount_applicable boolean,
  p_discount_amount numeric,
  p_lines jsonb,
  p_payment_status text default 'PAID'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_customer_id uuid;
  v_sale_id uuid;
  v_line jsonb;
  v_position integer := 0;
  v_product_count integer := 0;
  v_subtotal numeric := 0;
  v_installation_total numeric := 0;
  v_unit_price numeric;
  v_quantity integer;
  v_subtype text;
  v_wheel_count integer;
  v_amount numeric;
  v_description text;
  v_installed_by text;
  v_gst_amount numeric := coalesce(p_gst_amount, 0);
  v_discount_amount numeric := coalesce(p_discount_amount, 0);
  v_payment_status text := coalesce(nullif(btrim(p_payment_status), ''), 'PAID');
  v_combo_id uuid;
  v_combo record;
  v_component record;
  v_component_qty integer;
  v_component_price numeric;
  v_combo_contents text[];
  v_combo_list_value numeric;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if v_role is distinct from 'admin' and v_role is distinct from 'sales_person' then
    raise exception 'Not authorized to record sales' using errcode = '42501';
  end if;

  if p_customer_mobile is null or btrim(p_customer_mobile) = '' then
    raise exception 'Customer mobile number is required' using errcode = '22023';
  end if;
  if p_customer_name is null or btrim(p_customer_name) = '' then
    raise exception 'Customer name is required' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'A sale requires at least one line item' using errcode = '22023';
  end if;
  if v_gst_amount < 0 then
    raise exception 'GST amount cannot be negative' using errcode = '22023';
  end if;
  if v_discount_amount < 0 then
    raise exception 'Discount amount cannot be negative' using errcode = '22023';
  end if;
  if v_payment_status not in ('PENDING', 'PARTIAL', 'PAID') then
    raise exception 'Unknown payment status %', v_payment_status using errcode = '22023';
  end if;

  select id into v_customer_id from public.customers where mobile_number = btrim(p_customer_mobile);
  if v_customer_id is null then
    insert into public.customers (name, mobile_number, address)
    values (btrim(p_customer_name), btrim(p_customer_mobile), nullif(btrim(p_customer_address), ''))
    returning id into v_customer_id;
  end if;

  insert into public.sales
    (customer_id, gst_applicable, gst_amount, discount_applicable, discount_amount,
     subtotal, installation_total, grand_total, invoice_number, payment_status, created_by)
  values
    (v_customer_id, coalesce(p_gst_applicable, false), v_gst_amount,
     coalesce(p_discount_applicable, false), v_discount_amount,
     0, 0, 0, public.next_sales_invoice_number(), v_payment_status, auth.uid())
  returning id into v_sale_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_position := v_position + 1;

    if (v_line ->> 'line_type') = 'PRODUCT' then
      v_product_count := v_product_count + 1;
      v_quantity := (v_line ->> 'quantity')::integer;

      if v_quantity is null or v_quantity <= 0 then
        raise exception 'Quantity must be greater than zero' using errcode = '22023';
      end if;

      select selling_price into v_unit_price
        from public.inventory_items
        where id = (v_line ->> 'inventory_item_id')::uuid and is_active;

      if v_unit_price is null then
        raise exception 'Inventory item % not found or inactive', v_line ->> 'inventory_item_id' using errcode = 'P0002';
      end if;

      insert into public.sale_items
        (sale_id, position, line_type, inventory_item_id, quantity, unit_selling_price)
      values
        (v_sale_id, v_position, 'PRODUCT', (v_line ->> 'inventory_item_id')::uuid, v_quantity, v_unit_price);

      v_subtotal := v_subtotal + (v_unit_price * v_quantity);

      perform public.adjust_stock((v_line ->> 'inventory_item_id')::uuid, -v_quantity, 'SALE', 'sales', null);

    elsif (v_line ->> 'line_type') = 'COMBO' then
      v_combo_id := (v_line ->> 'combo_id')::uuid;
      v_quantity := coalesce((v_line ->> 'quantity')::integer, 1);

      if v_quantity <= 0 then
        raise exception 'Combo quantity must be greater than zero' using errcode = '22023';
      end if;

      select * into v_combo from public.combos where id = v_combo_id;
      if not found then
        raise exception 'Combo % not found', v_combo_id using errcode = 'P0002';
      end if;
      if not v_combo.is_active then
        raise exception 'Combo "%" is switched off and cannot be sold', v_combo.name using errcode = '22023';
      end if;
      if v_combo.valid_from is not null and (now() at time zone 'Asia/Kolkata')::date < v_combo.valid_from then
        raise exception 'Combo "%" has not started yet', v_combo.name using errcode = '22023';
      end if;
      if v_combo.valid_to is not null and (now() at time zone 'Asia/Kolkata')::date > v_combo.valid_to then
        raise exception 'Combo "%" has ended', v_combo.name using errcode = '22023';
      end if;

      select coalesce(array_agg(
               case when c.quantity * v_quantity > 1
                    then coalesce(p.name, s.name, i.product_name, 'Item') || ' x' || (c.quantity * v_quantity)
                    else coalesce(p.name, s.name, i.product_name, 'Item')
               end
               order by c.position
             ), '{}')
        into v_combo_contents
        from public.combo_components c
        left join public.general_service_packages p on p.id = c.general_service_package_id
        left join public.specific_services s on s.id = c.specific_service_id
        left join public.inventory_items i on i.id = c.inventory_item_id
       where c.combo_id = v_combo_id and c.pricing = 'INCLUDED';

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

      v_amount := coalesce((v_line ->> 'amount')::numeric, v_combo.combo_price * v_quantity);
      if v_amount < 0 then
        raise exception 'Combo amount cannot be negative' using errcode = '22023';
      end if;

      insert into public.sale_items
        (sale_id, position, line_type, combo_id, combo_contents, combo_list_value, description, amount, quantity)
      values
        (v_sale_id, v_position, 'COMBO', v_combo_id, v_combo_contents, v_combo_list_value, v_combo.name, v_amount, v_quantity);

      v_subtotal := v_subtotal + v_amount;

      for v_component in
        select c.inventory_item_id, c.quantity, c.pricing, i.selling_price, i.is_active, i.product_name
          from public.combo_components c
          join public.inventory_items i on i.id = c.inventory_item_id
         where c.combo_id = v_combo_id and c.component_type = 'ITEM'
         order by c.position
      loop
        if not v_component.is_active then
          raise exception 'Inventory item "%" in this combo is inactive', v_component.product_name using errcode = 'P0002';
        end if;

        v_position := v_position + 1;
        v_component_qty := v_component.quantity * v_quantity;
        v_component_price := case when v_component.pricing = 'INCLUDED' then 0 else v_component.selling_price end;

        insert into public.sale_items
          (sale_id, position, line_type, inventory_item_id, quantity, unit_selling_price, combo_id, included_in_combo)
        values
          (v_sale_id, v_position, 'PRODUCT', v_component.inventory_item_id, v_component_qty, v_component_price,
           v_combo_id, v_component.pricing = 'INCLUDED');

        v_subtotal := v_subtotal + (v_component_price * v_component_qty);
        v_product_count := v_product_count + 1;

        perform public.adjust_stock(v_component.inventory_item_id, -v_component_qty, 'SALE', 'sales', null);
      end loop;

    elsif (v_line ->> 'line_type') = 'INSTALLATION' then
      v_subtype := v_line ->> 'installation_subtype';
      v_wheel_count := (v_line ->> 'wheel_count')::integer;
      v_description := nullif(btrim(coalesce(v_line ->> 'description', '')), '');
      v_installed_by := nullif(btrim(coalesce(v_line ->> 'installed_by', '')), '');

      if v_subtype = 'TYRE_FITTING' then
        if v_wheel_count is null or v_wheel_count <= 0 then
          raise exception 'Wheel count is required for Tyre Fitting' using errcode = '22023';
        end if;
        v_amount := coalesce((v_line ->> 'amount')::numeric, v_wheel_count * 300);
      elsif v_subtype = 'CUSTOM' then
        if v_description is null then
          raise exception 'A description is required for a custom installation charge' using errcode = '22023';
        end if;
        v_amount := (v_line ->> 'amount')::numeric;
        if v_amount is null then
          raise exception 'An amount is required for a custom installation charge' using errcode = '22023';
        end if;
      else
        raise exception 'Unknown installation subtype %', v_subtype using errcode = '22023';
      end if;

      if v_amount < 0 then
        raise exception 'Installation amount cannot be negative' using errcode = '22023';
      end if;

      insert into public.sale_items
        (sale_id, position, line_type, installation_subtype, wheel_count, description, amount, installed_by)
      values
        (v_sale_id, v_position, 'INSTALLATION', v_subtype, v_wheel_count, v_description, v_amount, v_installed_by);

      v_installation_total := v_installation_total + v_amount;
    else
      raise exception 'Unknown line type %', v_line ->> 'line_type' using errcode = '22023';
    end if;
  end loop;

  if v_product_count = 0 then
    raise exception 'A sale requires at least one product line' using errcode = '22023';
  end if;

  update public.sales
    set subtotal = v_subtotal,
        installation_total = v_installation_total,
        grand_total = v_subtotal + v_installation_total + v_gst_amount - v_discount_amount
    where id = v_sale_id;

  return v_sale_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. update_sales_payment_status() — settling an invoice after the fact.
--
--    A sale is otherwise immutable (0013 §sales note); this is the one field
--    that legitimately changes later, when the customer comes back and pays.
--    Same shape as update_service_payment_status().
-- ---------------------------------------------------------------------------

create or replace function public.update_sales_payment_status(
  p_sale_id uuid,
  p_payment_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if v_role is distinct from 'admin' and v_role is distinct from 'sales_person' then
    raise exception 'Not authorized to update a sale' using errcode = '42501';
  end if;
  if p_payment_status not in ('PENDING', 'PARTIAL', 'PAID') then
    raise exception 'Unknown payment status %', p_payment_status using errcode = '22023';
  end if;

  update public.sales set payment_status = p_payment_status where id = p_sale_id;

  if not found then
    raise exception 'Sale % not found', p_sale_id using errcode = 'P0002';
  end if;
end;
$$;

grant execute on function public.update_sales_payment_status(uuid, text) to authenticated;
