/**
 * Unified Sale picker (sales rework plan §4.A).
 *
 * The Sales twin of `services/service/picker.ts`, and deliberately a separate
 * index rather than a shared one: a sale can contain products and
 * installation charges, while a job contains packages, specific services,
 * parts and combos. Forcing one index to serve both would mean a `kind` union
 * where half the values are invalid on each screen — the sort of type that
 * looks tidy and reads badly. The *component* is shared; the vocabulary isn't.
 *
 * Combo Offers are deliberately NOT offered here (confirmed decision,
 * 2026-08-15) — Sale Items only ever shows products and Tyre Fitting.
 * Combos remain a real, editable line type on a sale that already has one
 * (see `draftLinesFrom` in new-sale-page-client.tsx, which reconstructs an
 * existing COMBO line straight from the recorded sale) — this file only
 * controls what can be newly *added*, not what can still be shown.
 *
 * Pure and dependency-free, so it's unit-testable and safe in a client
 * component. Only `import type` crosses into server-only modules.
 */

import type { InventoryItemRow } from "@/services/inventory";

export type SalePickerKind = "ITEM" | "FITTING";

export interface SalePickerEntry {
  key: string;
  kind: SalePickerKind;
  /** Empty for the synthetic FITTING entry — it references no catalog row. */
  id: string;
  name: string;
  /** Unit price. For FITTING this is the per-wheel rate. */
  rate: number | null;
  /** Items only — advisory stock display; never blocks selection. */
  availableQuantity: number | null;
  /** Items only — searchable, so a code can be typed or scanned. */
  skuCode: string | null;
  /** Times sold, from history — ranks results and fills the quick chips. */
  usageCount: number;
}

export type SaleUsageCounts = Readonly<Record<string, number>>;

/** Confirmed business rule: fitting is ₹300 per wheel, Sales invoices only. */
export const TYRE_FITTING_RATE = 300;

/** The synthetic entry that lets "fitting" be typed into the same box as
 * everything else, instead of hiding behind a second Add button. */
export const FITTING_KEY = "FITTING:tyre";

export function salePickerKey(kind: SalePickerKind, id: string): string {
  return `${kind}:${id}`;
}

export function buildSalePickerIndex({
  items,
  usageCounts = {},
}: {
  items: InventoryItemRow[];
  usageCounts?: SaleUsageCounts;
}): SalePickerEntry[] {
  const entries: SalePickerEntry[] = [];

  for (const item of items) {
    if (!item.isActive) continue;
    const key = salePickerKey("ITEM", item.id);
    entries.push({
      key,
      kind: "ITEM",
      id: item.id,
      name: item.productName,
      rate: item.sellingPrice,
      availableQuantity: item.availableQuantity,
      skuCode: item.skuCode,
      usageCount: usageCounts[key] ?? 0,
    });
  }

  entries.push({
    key: FITTING_KEY,
    kind: "FITTING",
    id: "",
    name: "Tyre Fitting",
    rate: TYRE_FITTING_RATE,
    availableQuantity: null,
    skuCode: null,
    usageCount: 0,
  });

  return entries;
}

export const MIN_SEARCH_LENGTH = 2;
export const DEFAULT_SEARCH_LIMIT = 8;

function matchScore(entry: SalePickerEntry, term: string): number | null {
  const name = entry.name.toLowerCase();
  if (name.startsWith(term)) return 0;
  if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(name)) return 1;
  if (name.includes(term)) return 2;
  if (entry.skuCode && entry.skuCode.toLowerCase().includes(term)) return 3;
  return null;
}

export function searchSaleCatalog(
  entries: SalePickerEntry[],
  term: string,
  { limit = DEFAULT_SEARCH_LIMIT }: { limit?: number } = {}
): SalePickerEntry[] {
  const needle = term.trim().toLowerCase();
  if (needle.length < MIN_SEARCH_LENGTH) return [];

  const scored: { entry: SalePickerEntry; score: number }[] = [];
  for (const entry of entries) {
    const score = matchScore(entry, needle);
    if (score !== null) scored.push({ entry, score });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.entry.usageCount !== b.entry.usageCount) return b.entry.usageCount - a.entry.usageCount;
    return a.entry.name.localeCompare(b.entry.name);
  });

  return scored.slice(0, limit).map((s) => s.entry);
}

/**
 * The one-tap chips above the box: the shop's fastest-moving stock.
 *
 * Unlike Service — where a part is chosen because *this* bike needed it, so
 * habit-based shortcuts would invite mis-billing — a counter sale really is
 * the same few tyres over and over, so items are exactly what belongs here.
 */
export function saleQuickPickEntries(entries: SalePickerEntry[], { limit = 6 }: { limit?: number } = {}): SalePickerEntry[] {
  const byUsageThenName = (a: SalePickerEntry, b: SalePickerEntry) => {
    if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
    return a.name.localeCompare(b.name);
  };

  // Only stock that has actually sold — an untouched catalog of 200 items
  // would otherwise fill the chip row alphabetically with noise.
  const soldItems = entries.filter((entry) => entry.kind === "ITEM" && entry.usageCount > 0).sort(byUsageThenName);

  return soldItems.slice(0, limit);
}

/** A product line, in the string-typed shape the form holds. */
export interface SaleProductSeed {
  inventoryItemId: string;
  quantity: string;
}

/** A tyre-fitting line. `wheelCount` is pre-filled by the caller from the
 * tyres already on the sale. */
export interface SaleFittingSeed {
  installationSubtype: "TYRE_FITTING";
  wheelCount: string;
}

/** A one-off charge for something with no catalog entry. */
export interface SaleCustomChargeSeed {
  installationSubtype: "CUSTOM";
  description: string;
}

export type SalePickerResolution =
  | { ok: true; target: "PRODUCT"; product: SaleProductSeed }
  | { ok: true; target: "FITTING"; fitting: SaleFittingSeed }
  | { ok: true; target: "CUSTOM_CHARGE"; charge: SaleCustomChargeSeed }
  | { ok: false; reason: string };

/**
 * Same rule as the Service picker: a product with nothing on the shelf can't
 * be sold. Checked here so the keyboard path (highlight + Enter, or typing an
 * exact product name) is blocked identically to clicking the row.
 */
export function isSaleEntryOutOfStock(entry: SalePickerEntry): boolean {
  return entry.kind === "ITEM" && (entry.availableQuantity ?? 0) <= 0;
}

export function resolveSaleSelection(entry: SalePickerEntry, { suggestedWheelCount = 0 }: { suggestedWheelCount?: number } = {}): SalePickerResolution {
  if (entry.kind === "FITTING") {
    return {
      ok: true,
      target: "FITTING",
      // Pre-filled from the tyres already on the sale, so the usual case
      // needs no typing at all.
      fitting: { installationSubtype: "TYRE_FITTING", wheelCount: suggestedWheelCount > 0 ? String(suggestedWheelCount) : "" },
    };
  }

  if (isSaleEntryOutOfStock(entry)) {
    return { ok: false, reason: `${entry.name} is out of stock — record the purchase first.` };
  }

  return { ok: true, target: "PRODUCT", product: { inventoryItemId: entry.id, quantity: "1" } };
}

/** Free-typed work with no catalog entry behind it. */
export function toSaleCustomCharge(term: string): SalePickerResolution {
  const description = term.trim();
  if (!description) return { ok: false, reason: "Type what you're charging for first." };
  return { ok: true, target: "CUSTOM_CHARGE", charge: { installationSubtype: "CUSTOM", description } };
}

/** What pressing Enter does — an exact catalog name always beats creating a
 * one-off charge, so typing a product in full can't silently produce an
 * off-catalog line that reports can't group. */
export function resolveSaleTypedTerm(
  entries: SalePickerEntry[],
  term: string,
  options: { suggestedWheelCount?: number } = {}
): SalePickerResolution {
  const needle = term.trim().toLowerCase();
  if (!needle) return { ok: false, reason: "Type what you're charging for first." };

  const exact = entries.find((entry) => entry.name.toLowerCase() === needle);
  if (exact) return resolveSaleSelection(exact, options);

  return toSaleCustomCharge(term);
}
