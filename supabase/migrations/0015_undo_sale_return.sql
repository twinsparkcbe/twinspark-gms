-- Undo Sale Return (doc/sales-module-scope.md §6a).
--
-- undo_sale_return(): the ONLY way to reverse a Sale Return. Locks the
-- sale_returns row (FOR UPDATE) so it can't be undone twice concurrently,
-- reverses the earlier restock via adjust_stock (negative delta, same
-- SALE_RETURN reason — already admin-gated and note-required per
-- 0013_sales_schema.sql §4), then deletes the row. If the previously
-- -returned stock has since been sold/used elsewhere, adjust_stock's
-- existing insufficient-stock guard blocks the undo with its standard
-- error — no special-case handling needed here.
--
-- Confirmed design (not a soft-void column): deleting the row is enough —
-- the permanent audit trail lives in stock_movements regardless (the
-- original restock AND this reversal both land there as immutable,
-- reason-carrying rows), so nothing is actually lost by removing the
-- sale_returns row itself.

create or replace function public.undo_sale_return(
  p_sale_return_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_return record;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required to undo a sale return' using errcode = '22023';
  end if;

  select * into v_return from public.sale_returns where id = p_sale_return_id for update;
  if not found then
    raise exception 'Sale return % not found', p_sale_return_id using errcode = 'P0002';
  end if;

  -- adjust_stock() enforces SALE_RETURN admin authorization and the
  -- required-note rule, and is the sole path that mutates available_quantity.
  -- Negative delta — pulls the previously-restocked units back out via the
  -- standard FIFO consumption path, same as it would for a normal sale.
  perform public.adjust_stock(v_return.inventory_item_id, -v_return.quantity, 'SALE_RETURN', 'sales', p_reason);

  delete from public.sale_returns where id = p_sale_return_id;
end;
$$;

grant execute on function public.undo_sale_return to authenticated;
