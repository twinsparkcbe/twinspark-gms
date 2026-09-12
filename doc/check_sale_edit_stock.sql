-- =====================================================================
-- Twinspark GMS — did editing this invoice deduct its stock twice?
-- =====================================================================
--
-- Read-only. Put the invoice you edited in the two places marked below.
--
-- WHAT AN EDIT SHOULD LOOK LIKE. edit_sale() restores everything the sale
-- deducted, then re-deducts the corrected lines. So a sale of 1 that was
-- edited once should show THREE movements for that item:
--
--     SALE  -1   (no note)                         the original sale
--     SALE  +1   note "Correction to invoice ..."  the restore
--     SALE  -1   (no note)                         the re-deduction
--
-- If the middle row is MISSING, the edit deducted without restoring — that
-- is the double-deduction, and it is a real bug in whatever version of the
-- function your database is running.
--
-- ---------------------------------------------------------------------
-- Q1 — every stock movement this sale and its edits produced
-- ---------------------------------------------------------------------

select sm.created_at at time zone 'Asia/Kolkata' as at_ist,
       i.sku_code,
       i.product_name,
       sm.delta,
       case when sm.delta > 0 then 'restore' else 'deduct' end as direction,
       pe.batch_number,
       pe.unit_price,
       sm.note
from public.stock_movements sm
join public.inventory_items i on i.id = sm.inventory_item_id
left join public.purchase_entries pe on pe.id = sm.purchase_entry_id
where sm.reason = 'SALE'
  and sm.inventory_item_id in (
    select si.inventory_item_id
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    where s.invoice_number = 'TW-S-000182'      -- <<< your invoice
      and si.inventory_item_id is not null
  )
  and sm.created_at >= (select created_at from public.sales where invoice_number = 'TW-S-000182')  -- <<< same invoice
order by sm.created_at, sm.delta;


-- ---------------------------------------------------------------------
-- Q2 — the verdict, as one number per item
-- ---------------------------------------------------------------------
-- units_deducted should equal units_restored PLUS whatever the sale
-- currently bills. If units_deducted is higher than that, stock has been
-- taken more than once.

with s as (
  select id, created_at from public.sales where invoice_number = 'TW-S-000182'   -- <<< your invoice
),
billed as (
  select si.inventory_item_id, sum(si.quantity) as billed_now
  from public.sale_items si, s
  where si.sale_id = s.id and si.inventory_item_id is not null
  group by si.inventory_item_id
),
moved as (
  select sm.inventory_item_id,
         sum(case when sm.delta < 0 then -sm.delta else 0 end) as units_deducted,
         sum(case when sm.delta > 0 then  sm.delta else 0 end) as units_restored
  from public.stock_movements sm, s
  where sm.reason = 'SALE' and sm.created_at >= s.created_at
    and sm.inventory_item_id in (select inventory_item_id from billed)
  group by sm.inventory_item_id
)
select i.sku_code, i.product_name,
       b.billed_now,
       m.units_deducted,
       m.units_restored,
       m.units_deducted - m.units_restored as net_taken_off_shelf,
       case when m.units_deducted - m.units_restored = b.billed_now
            then 'OK — shelf matches the invoice'
            else 'MISMATCH — ' || ((m.units_deducted - m.units_restored) - b.billed_now)::text || ' unit(s) too many'
       end as verdict,
       i.available_quantity as stock_now
from moved m
join billed b on b.inventory_item_id = m.inventory_item_id
join public.inventory_items i on i.id = m.inventory_item_id
order by i.sku_code;


-- ---------------------------------------------------------------------
-- Q3 — the bug I DID confirm: phantom purchase batches from editing
-- ---------------------------------------------------------------------
-- Every edit's restore invents a brand-new purchase batch instead of putting
-- the units back where they came from. Each one is a purchase that never
-- happened. Any row here is money added to your Purchases figure by an edit.

select pe.batch_number, i.sku_code, i.product_name,
       pe.quantity, pe.remaining_quantity, pe.unit_price,
       pe.total_amount as added_to_purchases,
       pe.purchase_date::date as dated, pe.note
from public.purchase_entries pe
join public.inventory_items i on i.id = pe.inventory_item_id
where pe.supplier_name is null
  and (pe.note ilike 'Correction to invoice%' or pe.note ilike 'Void of invoice%')
order by pe.purchase_date desc;

-- And the total damage so far.
select count(*) as phantom_batches,
       coalesce(sum(total_amount), 0) as fake_purchases_in_your_books
from public.purchase_entries
where supplier_name is null
  and (note ilike 'Correction to invoice%' or note ilike 'Void of invoice%');
