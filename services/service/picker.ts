/**
 * Unified Service picker (rework plan Change 1, test cases §A).
 *
 * One search box replaces the old "choose a line type → add an empty row →
 * open a flat dropdown" sequence. Packages, Specific Services and Inventory
 * Items are folded into a single searchable index; whatever the admin picks,
 * this module decides what it becomes — a service line or a part row — so
 * the admin never classifies anything by hand. Text that matches nothing
 * becomes a Custom line.
 *
 * Pure and dependency-free (no React, no Supabase) so it's unit-testable and
 * safe to import from a client component. Only `import type` crosses into
 * catalog.ts / items.ts, which are server-only at runtime.
 */

import type { ComboRow } from "@/services/combos/types";
import type { InventoryItemRow } from "@/services/inventory";

import type { CatalogDefaultItemRow, GeneralServicePackageRow, SpecificServiceRow } from "./catalog";

export type PickerEntryKind = "PACKAGE" | "SPECIFIC" | "ITEM" | "COMBO";

export interface PickerEntry {
  /** Unique across kinds — a package and an item could share a uuid space. */
  key: string;
  kind: PickerEntryKind;
  id: string;
  name: string;
  /** Pre-fill price. `null` means "no suggested price" — staff types it
   * (a Specific Service with no default charge, doc §9). */
  rate: number | null;
  /** Catalog entries only — auto-populates Parts Used when picked (doc §3). */
  defaultItems: CatalogDefaultItemRow[];
  /** Items only. Zero or less blocks selection — see isOutOfStock(). */
  availableQuantity: number | null;
  /** Items only — also searchable, so a SKU can be typed or scanned. */
  skuCode: string | null;
  /** Times billed on completed jobs — drives ranking and the quick chips. */
  usageCount: number;
  /** COMBO entries only — the full definition, so the caller can expand it
   * into charge lines and parts without a second lookup. */
  combo?: ComboRow;
}

/** Usage counts keyed by `PickerEntry.key`, from `getFrequentServices`. */
export type UsageCounts = Readonly<Record<string, number>>;

export function pickerKey(kind: PickerEntryKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Folds the three loaded catalogs into one searchable list.
 *
 * Deactivated catalog entries are dropped (doc §16 — never deleted, but they
 * must not be sellable again). Out-of-stock items are still listed, so staff
 * can see the part exists and why it can't be added — but they can't be
 * selected (see isOutOfStock / resolveSelection).
 */
export function buildPickerIndex({
  packages,
  specificServices,
  items,
  combos = [],
  usageCounts = {},
}: {
  packages: GeneralServicePackageRow[];
  specificServices: SpecificServiceRow[];
  items: InventoryItemRow[];
  /** Combo Offers, already filtered to what's sellable — see
   * `listSellableCombos`. This module does no clock reads of its own: it runs
   * inside a client render, and a time-dependent render would differ between
   * the server pass and hydration. */
  combos?: ComboRow[];
  usageCounts?: UsageCounts;
}): PickerEntry[] {
  const entries: PickerEntry[] = [];

  // Combos first: they're the headline offer, so when a search matches both a
  // combo and its own contents, the bundle should be the obvious choice.
  for (const combo of combos) {
    const key = pickerKey("COMBO", combo.id);
    entries.push({
      key,
      kind: "COMBO",
      id: combo.id,
      name: combo.name,
      rate: combo.comboPrice,
      defaultItems: [],
      availableQuantity: null,
      skuCode: null,
      usageCount: usageCounts[key] ?? 0,
      combo,
    });
  }

  for (const pkg of packages) {
    if (!pkg.isActive) continue;
    const key = pickerKey("PACKAGE", pkg.id);
    entries.push({
      key,
      kind: "PACKAGE",
      id: pkg.id,
      name: pkg.name,
      rate: pkg.serviceCharge,
      defaultItems: pkg.defaultItems,
      availableQuantity: null,
      skuCode: null,
      usageCount: usageCounts[key] ?? 0,
    });
  }

  for (const svc of specificServices) {
    if (!svc.isActive) continue;
    const key = pickerKey("SPECIFIC", svc.id);
    entries.push({
      key,
      kind: "SPECIFIC",
      id: svc.id,
      name: svc.name,
      rate: svc.defaultCharge,
      defaultItems: svc.defaultItems,
      availableQuantity: null,
      skuCode: null,
      usageCount: usageCounts[key] ?? 0,
    });
  }

  for (const item of items) {
    if (!item.isActive) continue;
    const key = pickerKey("ITEM", item.id);
    entries.push({
      key,
      kind: "ITEM",
      id: item.id,
      name: item.productName,
      rate: item.sellingPrice,
      defaultItems: [],
      availableQuantity: item.availableQuantity,
      skuCode: item.skuCode,
      usageCount: usageCounts[key] ?? 0,
    });
  }

  return entries;
}

/** Below this, a search would just dump the whole catalog on screen. */
export const MIN_SEARCH_LENGTH = 2;
export const DEFAULT_SEARCH_LIMIT = 8;

/** Lower is better. Keeps "Chain Cleaning" above "Rear Chain Kit" for "chain". */
function matchScore(entry: PickerEntry, term: string): number | null {
  const name = entry.name.toLowerCase();
  if (name.startsWith(term)) return 0;
  // Start of any word inside the name — "brake" hits "Front Brake Service".
  if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(name)) return 1;
  if (name.includes(term)) return 2;
  if (entry.skuCode && entry.skuCode.toLowerCase().includes(term)) return 3;
  return null;
}

/**
 * Ranked search across all three kinds at once. Ordering: match quality,
 * then how often the entry is actually billed, then alphabetical so the list
 * never reshuffles between identical searches.
 */
export function searchCatalog(
  entries: PickerEntry[],
  term: string,
  { limit = DEFAULT_SEARCH_LIMIT }: { limit?: number } = {}
): PickerEntry[] {
  const needle = term.trim().toLowerCase();
  if (needle.length < MIN_SEARCH_LENGTH) return [];

  const scored: { entry: PickerEntry; score: number }[] = [];
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
 * The one-tap chips shown above the search box — the handful of services this
 * shop actually bills all day (doc §22).
 *
 * Services only: a part is picked because *this* bike needed it, so a
 * "frequent parts" shortcut would invite mis-billing. Before any history
 * exists the chips fall back to alphabetical order, so the row is useful on
 * day one instead of empty.
 */
export function quickPickEntries(entries: PickerEntry[], { limit = 6 }: { limit?: number } = {}): PickerEntry[] {
  const byUsageThenName = (a: PickerEntry, b: PickerEntry) => {
    if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
    return a.name.localeCompare(b.name);
  };

  // Combos are always pinned, whatever their usage. They're the shop's
  // headline offer, there are only ever a handful, and — the reason this is
  // a special case — a new combo has never been billed, so usage-ranking
  // alone would hide it until it had been sold, which it can't be until it's
  // visible. Chicken and egg; pinning breaks it.
  const combos = entries.filter((entry) => entry.kind === "COMBO").sort(byUsageThenName);

  const services = entries.filter((entry) => entry.kind === "SPECIFIC" || entry.kind === "PACKAGE");
  const everUsed = services.filter((entry) => entry.usageCount > 0);
  const pool = everUsed.length > 0 ? everUsed : services;

  // Parts are never chips: one is picked because *this* bike needed it, so a
  // habit-based shortcut would invite mis-billing.
  return [...combos, ...pool.sort(byUsageThenName)].slice(0, limit);
}

/** A service line, in the string-typed shape the form holds in state. */
export interface ServiceLineSeed {
  lineType: "PACKAGE" | "SPECIFIC" | "CUSTOM" | "COMBO";
  generalServicePackageId: string | null;
  specificServiceId: string | null;
  comboId: string | null;
  comboContents: string[];
  description: string;
  quantity: string;
  rate: string;
}

/** A Parts Used row, in the same string-typed form shape. */
export interface PartSeed {
  inventoryItemId: string;
  quantityUsed: string;
}

export type PickerResolution =
  | { ok: true; target: "LINE"; line: ServiceLineSeed; defaultItems: CatalogDefaultItemRow[] }
  | { ok: true; target: "PART"; part: PartSeed }
  /** A combo expands into a priced line plus its own stock rows — the caller
   * runs `resolveCombo` rather than this module duplicating that logic. */
  | { ok: true; target: "COMBO"; combo: ComboRow }
  | { ok: false; reason: string };

/**
 * Turns a picked entry into whatever it should become. The one place that
 * knows a package becomes a service line and an item becomes a part row —
 * which is precisely the decision the admin used to have to make up front.
 *
 * The single-package rule (doc §4) is enforced here rather than by disabling
 * a button, because with one merged search box there's no per-type button
 * left to disable.
 */
/**
 * A part with nothing on the shelf can't go on a job. Enforced here rather
 * than only greying out the row, so the keyboard path (highlight + Enter,
 * and typing an exact item name) is blocked by the same rule as the mouse.
 * Stock is still only *deducted* at completion — this is about not promising
 * a part the garage doesn't have.
 */
export function isOutOfStock(entry: PickerEntry): boolean {
  return entry.kind === "ITEM" && (entry.availableQuantity ?? 0) <= 0;
}

export function resolveSelection(entry: PickerEntry, { hasPackageLine }: { hasPackageLine: boolean }): PickerResolution {
  if (entry.kind === "COMBO") {
    if (!entry.combo) return { ok: false, reason: `${entry.name} couldn't be loaded — reopen the page and try again.` };
    // A combo may contain a General Service, but it isn't itself the job's
    // one package — the 0-or-1 rule (doc §4) doesn't apply to it.
    return { ok: true, target: "COMBO", combo: entry.combo };
  }

  if (entry.kind === "PACKAGE") {
    if (hasPackageLine) {
      return { ok: false, reason: "Only one General Service Package per job — remove the existing one first." };
    }
    return {
      ok: true,
      target: "LINE",
      line: {
        lineType: "PACKAGE",
        generalServicePackageId: entry.id,
        specificServiceId: null,
        comboId: null,
        comboContents: [],
        description: entry.name,
        quantity: "1",
        rate: entry.rate === null ? "" : String(entry.rate),
      },
      defaultItems: entry.defaultItems,
    };
  }

  if (entry.kind === "SPECIFIC") {
    return {
      ok: true,
      target: "LINE",
      line: {
        lineType: "SPECIFIC",
        generalServicePackageId: null,
        specificServiceId: entry.id,
        comboId: null,
        comboContents: [],
        description: entry.name,
        // Left blank, not zeroed, when the catalog has no suggested price —
        // "free" and "not decided yet" must not look identical.
        quantity: "1",
        rate: entry.rate === null ? "" : String(entry.rate),
      },
      defaultItems: entry.defaultItems,
    };
  }

  if (isOutOfStock(entry)) {
    return { ok: false, reason: `${entry.name} is out of stock — record the purchase first.` };
  }

  return { ok: true, target: "PART", part: { inventoryItemId: entry.id, quantityUsed: "1" } };
}

/** Free-typed work with no catalog entry behind it (doc §8). */
export function toCustomLine(term: string): PickerResolution {
  const description = term.trim();
  if (!description) return { ok: false, reason: "Type what was done first." };

  return {
    ok: true,
    target: "LINE",
    line: {
      lineType: "CUSTOM",
      generalServicePackageId: null,
      specificServiceId: null,
      comboId: null,
      comboContents: [],
      description,
      quantity: "1",
      rate: "",
    },
    defaultItems: [],
  };
}

/**
 * What pressing Enter does. An exact catalog name always wins over creating a
 * custom line — otherwise typing "Water Wash" in full would silently produce
 * an off-catalog duplicate that reports can't group.
 */
export function resolveTypedTerm(
  entries: PickerEntry[],
  term: string,
  { hasPackageLine }: { hasPackageLine: boolean }
): PickerResolution {
  const needle = term.trim().toLowerCase();
  if (!needle) return { ok: false, reason: "Type what was done first." };

  const exact = entries.find((entry) => entry.name.toLowerCase() === needle);
  if (exact) return resolveSelection(exact, { hasPackageLine });

  return toCustomLine(term);
}
