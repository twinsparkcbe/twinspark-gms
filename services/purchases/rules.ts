/**
 * Pure business-rule helpers with no Supabase dependency — mirrors
 * services/inventory/rules.ts.
 *
 * Since FIFO batch tracking (0010_purchase_batch_fifo.sql), a purchase
 * entry's "remaining quantity" is a real, live DB column
 * (purchase_entries.remaining_quantity) — it already accounts for anything
 * sold out of the batch via FIFO AND any prior returns against it, so it's
 * fetched directly rather than computed from two separate numbers here.
 * This helper just validates a requested return against that number; the
 * DB's record_purchase_return() function is the actual source of truth —
 * it re-checks it race-safely under a row lock at write time.
 */
export function canReturnQuantity(requestedQuantity: number, remainingQuantity: number): boolean {
  if (requestedQuantity <= 0) return false;
  return requestedQuantity <= remainingQuantity;
}
