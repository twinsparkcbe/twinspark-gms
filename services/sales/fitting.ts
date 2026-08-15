/**
 * The tyre-fitting nudge (sales rework plan §3.C / §4.C).
 *
 * Nothing in the old form connected "there are tyres on this sale" to "there
 * should be a fitting charge". Fitting is step nine of a twelve-step flow, on
 * the busiest transaction the shop does, and an invoice missing it looks
 * completely normal — so ₹300 a wheel leaves silently and nobody finds out.
 *
 * This computes the nudge. It is advisory by confirmed decision: a customer
 * collecting tyres to fit elsewhere is a real case, and blocking the sale
 * would be worse than the leak.
 *
 * The inverse matters just as much — a combo's price already covers fitting,
 * so adding a separate charge double-bills. Both directions come out of the
 * same function, because they're the same question asked from two sides.
 *
 * Pure — no React, no Supabase.
 */

import { TYRE_FITTING_RATE } from "./picker";

/** Item types that need fitting. Track and Brand New tyres both do; nothing
 * else in the catalog does. */
const TYRE_ITEM_TYPES = new Set(["TRACK_TYRE", "BRAND_NEW_TYRE"]);

export interface FittingCheckLine {
  lineType: "PRODUCT" | "INSTALLATION" | "COMBO";
  /** PRODUCT only. */
  inventoryItemId?: string | null;
  quantity?: number;
  /** True when this product row came in as part of a combo. */
  includedInCombo?: boolean;
  /** INSTALLATION only. */
  installationSubtype?: "TYRE_FITTING" | "CUSTOM" | null;
  /** COMBO only — whether that combo contains tyres. */
  comboCoversFitting?: boolean;
}

export interface FittingLookup {
  /** True when the item is a tyre of any kind. */
  isTyre: (inventoryItemId: string) => boolean;
}

export type FittingNudge =
  | { kind: "SUGGEST_FITTING"; wheelCount: number; amount: number }
  | { kind: "ALREADY_IN_COMBO" }
  | null;

/** Tyres on the sale that a customer is paying for — combo tyres excluded,
 * since the combo price already covers their fitting. */
export function countLooseTyres(lines: FittingCheckLine[], lookup: FittingLookup): number {
  return lines.reduce((count, line) => {
    if (line.lineType !== "PRODUCT") return count;
    if (line.includedInCombo) return count;
    if (!line.inventoryItemId || !lookup.isTyre(line.inventoryItemId)) return count;
    return count + (line.quantity ?? 0);
  }, 0);
}

export function hasFittingLine(lines: FittingCheckLine[]): boolean {
  return lines.some((line) => line.lineType === "INSTALLATION" && line.installationSubtype === "TYRE_FITTING");
}

export function hasComboCoveringFitting(lines: FittingCheckLine[]): boolean {
  return lines.some((line) => line.lineType === "COMBO" && line.comboCoversFitting === true);
}

/**
 * @param dismissed The admin said "not needed" for this sale. Respected for
 *   the rest of that sale only — it isn't remembered against the customer or
 *   the item, because the next sale is a different decision.
 */
export function getFittingNudge(
  lines: FittingCheckLine[],
  lookup: FittingLookup,
  { dismissed = false }: { dismissed?: boolean } = {}
): FittingNudge {
  const comboCovers = hasComboCoveringFitting(lines);
  const fittingCharged = hasFittingLine(lines);

  // Double-charge warning wins: it's about money already on the invoice,
  // where the other nudge is about money that might be missing. This one
  // shows even when dismissed — dismissing means "no fitting needed", which
  // is not a reason to stay quiet about being billed for it twice.
  if (comboCovers && fittingCharged) return { kind: "ALREADY_IN_COMBO" };

  if (dismissed || fittingCharged || comboCovers) return null;

  const wheelCount = countLooseTyres(lines, lookup);
  if (wheelCount <= 0) return null;

  return { kind: "SUGGEST_FITTING", wheelCount, amount: wheelCount * TYRE_FITTING_RATE };
}

/** Builds the lookup from the loaded inventory list — one place that knows
 * which item types are tyres. */
export function createTyreLookup(items: { id: string; itemType: string }[]): FittingLookup {
  const tyreIds = new Set(items.filter((item) => TYRE_ITEM_TYPES.has(item.itemType)).map((item) => item.id));
  return { isTyre: (id: string) => tyreIds.has(id) };
}
