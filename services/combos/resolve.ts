/**
 * Turning a combo into the rows a Service Job or a Sale actually stores
 * (plan §3.C, test cases §E).
 *
 * Produces module-neutral *seeds*: Service maps them into service job lines
 * and usage rows, Sales maps them into sale items. The combo definition is
 * identical either side — only the host module's stock timing and invoice
 * numbering differ — so the translation lives here once rather than twice.
 *
 * The shape of the result encodes the three rules that make a combo a combo:
 *
 *   1. One charge line, at the combo price. Not one line per content.
 *   2. INCLUDED contents bill ₹0 but still move stock and still carry their
 *      purchase price, so the Profit report doesn't read the combo as pure
 *      margin.
 *   3. EXTRA contents bill normally, on their own line, on top.
 *
 * Prices are snapshotted here at insert time, never looked up live later —
 * same principle as `sale_items.unit_selling_price` and
 * `service_job_lines.rate` (doc §16).
 *
 * Pure — no React, no Supabase.
 */

import { comboUnavailableMessage, comboUnavailableReason, type ComboAvailability } from "./availability";
import type { ComboRow } from "./types";

/** A billable line. The combo itself, plus any EXTRA service content. */
export interface ComboChargeSeed {
  source: "COMBO" | "EXTRA_PACKAGE" | "EXTRA_SPECIFIC";
  comboId: string;
  generalServicePackageId: string | null;
  specificServiceId: string | null;
  description: string;
  quantity: number;
  rate: number;
}

/** A stock-moving row. `unitPrice` is 0 for included contents. */
export interface ComboPartSeed {
  comboId: string;
  inventoryItemId: string;
  quantity: number;
  unitPrice: number;
  /** Drives the "included in combo" tag and the ₹0 on the invoice. */
  includedInCombo: boolean;
}

/** One line of the unpriced breakdown printed under the combo. */
export interface ComboContentSeed {
  label: string;
  quantity: number;
}

export interface ComboResolution {
  comboId: string;
  comboName: string;
  charges: ComboChargeSeed[];
  parts: ComboPartSeed[];
  /** INCLUDED contents, for the printed breakdown and for reporting on what
   * a combo actually contained at the time it was sold. */
  contents: ComboContentSeed[];
}

export type ComboResolveResult = { ok: true; resolution: ComboResolution } | { ok: false; reason: string };

/**
 * @param quantity How many of this combo. Multiplies every content — two
 *   combos means two sets of tyres out of stock, not one.
 */
export function resolveCombo(combo: ComboRow, { quantity = 1, now }: { quantity?: number; now: Date }): ComboResolveResult {
  if (quantity <= 0) return { ok: false, reason: "Combo quantity must be at least 1." };

  const availability: ComboAvailability = { isActive: combo.isActive, validFrom: combo.validFrom, validTo: combo.validTo };
  const unavailable = comboUnavailableReason(availability, now);
  if (unavailable) return { ok: false, reason: comboUnavailableMessage(unavailable, combo.name) };

  if (combo.components.length === 0) {
    return { ok: false, reason: `${combo.name} has nothing in it — add its contents in Services & Prices first.` };
  }

  const charges: ComboChargeSeed[] = [
    {
      source: "COMBO",
      comboId: combo.id,
      generalServicePackageId: null,
      specificServiceId: null,
      description: combo.name,
      quantity,
      rate: combo.comboPrice,
    },
  ];
  const parts: ComboPartSeed[] = [];
  const contents: ComboContentSeed[] = [];

  for (const component of combo.components) {
    const totalQuantity = component.quantity * quantity;

    if (component.componentType === "ITEM") {
      if (!component.inventoryItemId) continue; // shape-guarded in the DB; defensive here
      parts.push({
        comboId: combo.id,
        inventoryItemId: component.inventoryItemId,
        quantity: totalQuantity,
        unitPrice: component.pricing === "INCLUDED" ? 0 : (component.unitPrice ?? 0),
        includedInCombo: component.pricing === "INCLUDED",
      });
      if (component.pricing === "INCLUDED") contents.push({ label: component.name, quantity: totalQuantity });
      continue;
    }

    // A package or specific service inside the combo. Included ones raise no
    // charge — their price is already inside combo_price — but are still
    // listed, so the customer sees what they got and the Service Report can
    // count how much water-washing the shop actually did.
    if (component.pricing === "INCLUDED") {
      contents.push({ label: component.name, quantity: totalQuantity });
      continue;
    }

    charges.push({
      source: component.componentType === "PACKAGE" ? "EXTRA_PACKAGE" : "EXTRA_SPECIFIC",
      comboId: combo.id,
      generalServicePackageId: component.generalServicePackageId,
      specificServiceId: component.specificServiceId,
      description: component.name,
      quantity: totalQuantity,
      rate: component.unitPrice ?? 0,
    });
  }

  return { ok: true, resolution: { comboId: combo.id, comboName: combo.name, charges, parts, contents } };
}

/**
 * Whether a combo brings its own tyre fitting — used to warn an admin who
 * adds a fitting line to a sale that already covers it (test case #76a).
 * Advisory only: a genuinely separate tyre sale on the same invoice is
 * legitimate, so this never blocks.
 */
export function comboCoversFitting(combo: ComboRow, isTyreItem: (inventoryItemId: string) => boolean): boolean {
  return combo.components.some(
    (component) => component.componentType === "ITEM" && component.inventoryItemId !== null && isTyreItem(component.inventoryItemId)
  );
}
