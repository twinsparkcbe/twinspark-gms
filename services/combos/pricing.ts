/**
 * Combo pricing maths (plan §3.B, test cases §D).
 *
 * Answers four questions the combo builder needs to show live, and the
 * invoice needs at print time:
 *
 *   List value   what the INCLUDED contents would cost bought separately
 *   Savings      list value − combo price ("You saved ₹1,741")
 *   Cost         purchase price of the goods being given away
 *   Margin       combo price − cost
 *
 * The last two exist to stop a combo being priced under cost by accident.
 * That mistake is invisible on the Sales figure and only shows up in the
 * Profit report weeks later, by which time the offer has been running.
 *
 * Purchase price appears in `cost`/`margin` only — both are admin-facing
 * builder figures and never reach a customer document. Enforced by the view
 * models, same as `mechanic_notes` (doc §14).
 *
 * Pure — no React, no Supabase.
 */

import { roundMoney } from "@/services/service/totals";

export type ComboPricingComponentType = "PACKAGE" | "SPECIFIC" | "ITEM";
export type ComboPricingComponentPricing = "INCLUDED" | "EXTRA";

export interface ComboPricingComponent {
  componentType: ComboPricingComponentType;
  quantity: number;
  pricing: ComboPricingComponentPricing;
  /** Catalog price of one unit: package service charge, specific service
   * default charge, or item selling price. `null` for a specific service
   * with no suggested price — contributes nothing rather than NaN. */
  unitPrice: number | null;
  /** Items only. Cost basis for margin; never shown to a customer. */
  unitPurchasePrice?: number | null;
}

export interface ComboPricing {
  /** What the INCLUDED contents would cost if bought separately. */
  listValue: number;
  comboPrice: number;
  /** Clamped at zero — see `isPricedAboveList` for the inverse case. */
  savings: number;
  savingsPercent: number;
  /** Purchase-price total of the INCLUDED goods. Admin-facing only. */
  cost: number;
  /** comboPrice − cost. Can legitimately be negative; that's the warning. */
  margin: number;
  /** Combo costs more than buying the parts separately — almost always a
   * data-entry slip, so the builder should say so rather than print a
   * negative "saving". */
  isPricedAboveList: boolean;
  /** Combo sells for less than the goods cost. The blocking warning. */
  isBelowCost: boolean;
}

function lineValue(component: ComboPricingComponent): number {
  return (component.unitPrice ?? 0) * component.quantity;
}

export function computeComboPricing(components: ComboPricingComponent[], comboPrice: number): ComboPricing {
  // EXTRA components bill on top at their own price, so they're outside the
  // comparison entirely — including them would overstate the saving.
  const included = components.filter((c) => c.pricing === "INCLUDED");

  const listValue = roundMoney(included.reduce((sum, c) => sum + lineValue(c), 0));
  const cost = roundMoney(
    included.filter((c) => c.componentType === "ITEM").reduce((sum, c) => sum + (c.unitPurchasePrice ?? 0) * c.quantity, 0)
  );

  const rawSavings = roundMoney(listValue - comboPrice);
  const savings = Math.max(0, rawSavings);
  const savingsPercent = listValue > 0 ? Math.round((savings / listValue) * 100) : 0;

  return {
    listValue,
    comboPrice: roundMoney(comboPrice),
    savings,
    savingsPercent,
    cost,
    margin: roundMoney(comboPrice - cost),
    isPricedAboveList: rawSavings < 0,
    isBelowCost: comboPrice < cost,
  };
}
