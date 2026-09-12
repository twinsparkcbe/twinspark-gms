-- =====================================================================
-- Twinspark GMS — remove the phantom purchase batches edits/voids created
-- =====================================================================
--
-- Run migration 0042 FIRST. That stops new ones being made. This clears the
-- 61 already in the books, worth Rs 97,544 of purchases that never happened.
--
-- WHAT A PHANTOM BATCH IS
--
-- Every time a sale was edited or voided, or a service completion undone, the
-- restore invented a purchase_entries row instead of returning the units to
-- the batch they came from. Those rows have no supplier and a note naming the
-- invoice. They inflate Purchases, and the real batch they should have
-- credited is short by the same units.
--
-- WHAT THIS DOES
--
-- For each phantom batch it finds the real batch of that item with units
-- outstanding, moves the phantom's units into it, re-points the phantom's
-- stock movements at it, and deletes the phantom row.
--
-- Movements are RE-POINTED, never deleted. That matters: those rows are what
-- Cost of Goods Sold is computed from, and deleting them would swing Profit.
-- Re-pointing keeps every movement, just attached to the batch that really
-- supplied it — so COGS moves only to the extent the phantom's invented cost
-- differed from the true one, which is the correction you want.
--
-- STOCK DOES NOT MOVE. available_quantity is never written. The units are
-- already counted; this only changes which batch is recorded as holding them.
-- The transaction aborts if the shelf shifts by one unit.
--
-- Anything it cannot place safely is SKIPPED and listed, not forced. STEP 0
-- reports the phantoms and a likely home for each; STEP 1 does the real
-- allocation one at a time and prints anything it had to skip.
--
-- ---------------------------------------------------------------------
-- STEP 0 — what will be cleaned, and what will be skipped (read-only)
-- ---------------------------------------------------------------------
-- will_be_cleaned here is an UPPER BOUND. It asks, for each phantom on its
-- own, "is there a batch with room?" — it does not account for two phantoms
-- wanting the same room. STEP 1 allocates them one at a time and prints the
-- true skipped list, so treat this as a rough size, not a promise.

with phantom as (
  select pe.id, pe.batch_number, pe.inventory_item_id, pe.quantity,
         pe.remaining_quantity, pe.unit_price, pe.total_amount, pe.note
  from public.purchase_entries pe
  where pe.supplier_name is null
    and (pe.note ilike 'Correction to invoice%' or pe.note ilike 'Void of invoice%')
),
target as (
  select p.id as phantom_id,
         (select b.id from public.purchase_entries b
           where b.inventory_item_id = p.inventory_item_id
             and b.id <> p.id
             and b.quantity > b.remaining_quantity
             and b.quantity - b.remaining_quantity >= p.remaining_quantity
           order by b.purchase_date desc, b.created_at desc
           limit 1) as absorbing_batch
  from phantom p
)
select p.batch_number as phantom_batch, i.sku_code, i.product_name,
       p.quantity, p.remaining_quantity, p.unit_price,
       p.total_amount as fake_purchase_value,
       coalesce(b.batch_number, '(none big enough)') as will_move_into,
       case when t.absorbing_batch is null then 'SKIP — no real batch can absorb it'
            else 'clean' end as action
from phantom p
join target t on t.phantom_id = p.id
join public.inventory_items i on i.id = p.inventory_item_id
left join public.purchase_entries b on b.id = t.absorbing_batch
order by action desc, i.sku_code;

-- The totals.
with phantom as (
  select pe.id, pe.inventory_item_id, pe.remaining_quantity, pe.total_amount
  from public.purchase_entries pe
  where pe.supplier_name is null
    and (pe.note ilike 'Correction to invoice%' or pe.note ilike 'Void of invoice%')
),
target as (
  select p.id as phantom_id,
         (select b.id from public.purchase_entries b
           where b.inventory_item_id = p.inventory_item_id and b.id <> p.id
             and b.quantity - b.remaining_quantity >= p.remaining_quantity
           order by b.purchase_date desc, b.created_at desc limit 1) as absorbing_batch
  from phantom p
)
select count(*) filter (where t.absorbing_batch is not null)                 as will_be_cleaned,
       coalesce(sum(p.total_amount) filter (where t.absorbing_batch is not null), 0) as purchases_removed,
       count(*) filter (where t.absorbing_batch is null)                     as will_be_skipped,
       coalesce(sum(p.total_amount) filter (where t.absorbing_batch is null), 0)     as left_in_books
from phantom p join target t on t.phantom_id = p.id;


-- ---------------------------------------------------------------------
-- STEP 1 — the cleanup. One transaction: all of it, or none of it.
-- ---------------------------------------------------------------------
-- Allocated ONE PHANTOM AT A TIME, in a loop, rather than planned up front
-- and applied in one summed UPDATE. The first version of this script did the
-- latter and hit
--
--   new row for relation "purchase_entries" violates check constraint
--   "purchase_entries_remaining_lte_quantity_check"
--
-- because two phantoms independently chose the same absorbing batch: each
-- checked that the batch had room for ONE unit, then both credits were summed
-- and TWO went in. Crediting inside the loop means every phantom reads the
-- capacity left after the ones before it, so the arithmetic cannot run ahead
-- of the constraint.

begin;

-- Prints which version of this script is actually running. If you do not see
-- this line in the output, your SQL editor is still holding the older copy —
-- re-paste the file. The first version credited batches in one summed UPDATE
-- and could violate purchase_entries_remaining_lte_quantity_check.
do $$ begin raise notice 'cleanup_phantom_batches.sql — v2 (per-phantom allocation, guarded)'; end $$;

create temporary table _stock_before on commit drop as
  select id, available_quantity from public.inventory_items;

-- Per item, what the batches currently add up to. Must be identical after.
create temporary table _sum_before on commit drop as
  select inventory_item_id, sum(remaining_quantity) as total_remaining
  from public.purchase_entries group by inventory_item_id;

create temporary table _skipped (
  batch_number text,
  sku_code text,
  product_name text,
  units integer,
  value numeric,
  reason text
) on commit drop;

do $$
declare
  p         record;
  v_target  uuid;
  v_cleaned integer := 0;
  v_value   numeric := 0;
begin
  for p in
    select pe.id, pe.inventory_item_id, pe.batch_number,
           pe.remaining_quantity as units, pe.total_amount
    from public.purchase_entries pe
    where pe.supplier_name is null
      and (pe.note ilike 'Correction to invoice%' or pe.note ilike 'Void of invoice%')
    order by pe.purchase_date, pe.batch_number
  loop
    -- A REAL batch of this item with room for these units. Two conditions
    -- matter and the first version missed one of them:
    --   * not another phantom — a row that is itself about to be deleted
    --     must never be handed units;
    --   * capacity read FRESH, so credits already made in this loop count.
    select b.id into v_target
    from public.purchase_entries b
    where b.inventory_item_id = p.inventory_item_id
      and b.id <> p.id
      and not (
        b.supplier_name is null
        and (b.note ilike 'Correction to invoice%' or b.note ilike 'Void of invoice%')
      )
      and b.quantity - b.remaining_quantity >= p.units
    order by b.purchase_date desc, b.created_at desc
    limit 1
    for update;

    if v_target is null then
      insert into _skipped
      select p.batch_number, i.sku_code, i.product_name, p.units, p.total_amount,
             'no real batch of this item has room for ' || p.units || ' unit(s)'
      from public.inventory_items i where i.id = p.inventory_item_id;
      continue;
    end if;

    -- 1. The real batch takes back the units the phantom was holding.
    --    Guarded a second time even though the SELECT above already checked
    --    the capacity. The check constraint is the thing that actually
    --    refuses, and a script that trips it aborts the WHOLE transaction and
    --    cleans nothing. Re-testing it here means the worst case is one
    --    phantom skipped and reported, not the whole run lost.
    update public.purchase_entries
       set remaining_quantity = remaining_quantity + p.units
     where id = v_target
       and remaining_quantity + p.units <= quantity;

    if not found then
      insert into _skipped
      select p.batch_number, i.sku_code, i.product_name, p.units, p.total_amount,
             'the batch chosen to absorb it filled up first — re-run to place it elsewhere'
      from public.inventory_items i where i.id = p.inventory_item_id;
      continue;
    end if;

    -- 2. Re-point the phantom's movements. NOT deleted — these are what Cost
    --    of Goods Sold reads, and deleting them would swing Profit.
    update public.stock_movements
       set purchase_entry_id = v_target
     where purchase_entry_id = p.id;

    -- 3. The phantom row goes. Its FK is ON DELETE RESTRICT, so this only
    --    succeeds once nothing points at it — which step 2 guarantees.
    delete from public.purchase_entries where id = p.id;

    v_cleaned := v_cleaned + 1;
    v_value := v_value + p.total_amount;
  end loop;

  -- Deliberately NOT an exception when nothing could be placed. Raising here
  -- aborts the transaction, and an aborted transaction swallows the skipped
  -- list printed below — which is the one thing worth having when a run
  -- places nothing. A run that cleans zero phantoms has changed zero rows
  -- anyway, so committing it is the same as rolling it back, minus losing
  -- the diagnosis.
  if v_cleaned = 0 then
    raise notice 'No phantom batch could be placed. Nothing changed — read the skipped list below and send it to me.';
  else
    raise notice 'Cleaned % phantom batch(es), removing % of purchases that never happened', v_cleaned, v_value;
  end if;
end $$;

do $$
declare v_bad integer; v_moved integer; v_sum integer;
begin
  select count(*) into v_bad from public.purchase_entries
   where remaining_quantity > quantity or remaining_quantity < 0;
  if v_bad > 0 then
    raise exception 'Left % batch(es) with an impossible remaining quantity — rolling back', v_bad;
  end if;

  select count(*) into v_moved
  from public.inventory_items i join _stock_before b on b.id = i.id
  where i.available_quantity is distinct from b.available_quantity;
  if v_moved > 0 then
    raise exception 'Stock moved on % item(s) — rolling back, nothing was changed', v_moved;
  end if;

  -- The batches must still add up to exactly what they did before: units were
  -- moved between batches, not created or destroyed.
  select count(*) into v_sum
  from _sum_before b
  left join (
    select inventory_item_id, sum(remaining_quantity) as total_remaining
    from public.purchase_entries group by inventory_item_id
  ) a on a.inventory_item_id = b.inventory_item_id
  where coalesce(a.total_remaining, 0) is distinct from b.total_remaining;
  if v_sum > 0 then
    raise exception 'Batch totals changed on % item(s) — rolling back', v_sum;
  end if;
end $$;

-- Anything that could not be placed. Read this before the commit lands — it
-- is the list to send me.
select * from _skipped order by sku_code, batch_number;

commit;


-- ---------------------------------------------------------------------
-- STEP 2 — confirm. Run on its own.
-- ---------------------------------------------------------------------

select 'phantom batches left' as check, count(*)::text as value
from public.purchase_entries
where supplier_name is null and (note ilike 'Correction to invoice%' or note ilike 'Void of invoice%')
union all
select 'fake purchases left', coalesce(sum(total_amount), 0)::text
from public.purchase_entries
where supplier_name is null and (note ilike 'Correction to invoice%' or note ilike 'Void of invoice%')
union all
select 'batches with impossible remaining', count(*)::text
from public.purchase_entries where remaining_quantity > quantity or remaining_quantity < 0
union all
select 'total purchases now', coalesce(sum(total_amount), 0)::text from public.purchase_entries;
-- Want: rows 1 and 3 at 0. Anything left in row 1 is what STEP 0 flagged as
-- SKIP — send me that list and I will handle those separately.
