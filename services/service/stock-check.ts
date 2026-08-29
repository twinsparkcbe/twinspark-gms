/**
 * Can the parts on this job actually come off the shelf?
 *
 * Pure and client-safe (import from this path, not the services/service
 * barrel, which re-exports server-only modules) so the Service Job form can
 * refuse to bill a job whose parts aren't there — before anything is sent.
 *
 * Why the check has to exist on the client at all, when the database already
 * refuses: completing a NEW job is four separate calls (create the job, move
 * it to In Progress, complete it, stamp the payment). The job is created and
 * committed by call one. When call three fails on stock, the job is already
 * saved — so the counter sees an error, presses the button again, and gets a
 * SECOND job. Every retry adds another. That is where the duplicate job
 * numbers came from. Refusing here means call one never happens.
 *
 * This does NOT replace the database check (deduct_service_job_stock). Stock
 * read into a form goes stale the moment another counter bills the same part,
 * so the server stays the authority; this only stops the everyday case where
 * the shortfall is visible on screen the whole time.
 */

export interface StockShortfall {
  inventoryItemId: string;
  productName: string;
  /** Total across every row on the job that uses this item. */
  required: number;
  /** What the shelf can actually give this job. */
  available: number;
}

export interface StockCheckPart {
  inventoryItemId: string | null;
  quantityUsed: number;
}

export interface StockCheckItem {
  id: string;
  productName: string;
  availableQuantity: number;
}

/**
 * @param alreadyDeducted quantities this job has ALREADY taken off the shelf.
 * Only set when correcting a completed job: edit_completed_service_job()
 * restores the original parts before re-deducting the corrected list, so a
 * job that already holds 5 of an item can keep all 5 even when Inventory
 * currently reads 0. Without this the correction screen would refuse every
 * edit that left its parts alone.
 */
export function findStockShortfalls(input: {
  parts: StockCheckPart[];
  items: StockCheckItem[];
  alreadyDeducted?: StockCheckPart[];
}): StockShortfall[] {
  const required = new Map<string, number>();

  // Grouped by item, not checked row by row: the same part can sit on two
  // rows of one job, and 2 + 2 against a stock of 3 is short even though
  // neither row is short on its own. Parts carried by a Combo count too —
  // they bill at ₹0 but the stock still moves.
  for (const part of input.parts) {
    if (!part.inventoryItemId) continue;
    const qty = Math.trunc(part.quantityUsed);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    required.set(part.inventoryItemId, (required.get(part.inventoryItemId) ?? 0) + qty);
  }

  const credited = new Map<string, number>();
  for (const part of input.alreadyDeducted ?? []) {
    if (!part.inventoryItemId) continue;
    const qty = Math.trunc(part.quantityUsed);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    credited.set(part.inventoryItemId, (credited.get(part.inventoryItemId) ?? 0) + qty);
  }

  const shortfalls: StockShortfall[] = [];

  for (const [inventoryItemId, need] of required) {
    const item = input.items.find((i) => i.id === inventoryItemId);
    // An item the picker can't resolve is a different problem, and the form's
    // own "Select an item" error already covers it. Guessing a shortfall here
    // would block billing over a stale picker list.
    if (!item) continue;

    const available = item.availableQuantity + (credited.get(inventoryItemId) ?? 0);
    if (need > available) {
      shortfalls.push({ inventoryItemId, productName: item.productName, required: need, available });
    }
  }

  // Same order the database uses when it reports the same problem, so the two
  // messages read alike when a race means the server is the one to refuse.
  return shortfalls.sort((a, b) => a.productName.localeCompare(b.productName));
}

/**
 * The wording deliberately matches deduct_service_job_stock()'s
 * "Not enough stock: NAME (need N, have M)" prefix, then adds what the
 * counter is supposed to do about it — the database can only report, it
 * can't tell anyone where the fix lives.
 */
export function stockShortfallMessage(shortfalls: StockShortfall[]): string {
  if (shortfalls.length === 0) return "";

  const detail = shortfalls
    .map((s) => `${s.productName} (need ${s.required}, have ${s.available})`)
    .join("; ");

  return `Not enough stock: ${detail}. Remove ${
    shortfalls.length === 1 ? "the part" : "those parts"
  } from this job, or add stock in Inventory, before billing.`;
}
