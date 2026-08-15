/**
 * Which correction actions a Sales row offers (doc/sales-edit-void-scope.md §3/§4).
 *
 * Sales has no status ladder — a sale is recorded and that's it — so unlike
 * Service's getRowActions() this answers a simpler question: can this sale
 * still be corrected, and if not, why not. The "why not" matters: an Edit
 * button that silently does nothing is worse than one that explains it's
 * blocked by a return.
 *
 * Pure — no React, no Supabase, no `Date.now()`. Safe to import from client
 * components and unit-testable without a DOM.
 */

export type SaleCorrectionBlockReason = "VOIDED" | "HAS_RETURN";

export interface SaleRowActionSet {
  /** Null when the sale can't be corrected, or the viewer isn't allowed. */
  edit: { label: string } | null;
  void: { label: string; title: string; confirmLabel: string } | null;
  /** Set when the actions are hidden because of the sale's own state rather
   * than the viewer's role — surfaced as a tooltip so the absence is
   * explained instead of just felt. */
  blockedReason: SaleCorrectionBlockReason | null;
  blockedMessage: string | null;
}

export interface SaleRowActionSale {
  /** Set once voided (0029). */
  voidedAt: string | null;
  /** True when any line on this sale has a Sale Return against it. */
  hasReturn: boolean;
}

export interface SaleRowActionViewer {
  /** Administrator or Sales Person. Mechanic can record a sale but not rewrite
   * or erase one — see can_correct_sales() in migration 0029. */
  canCorrect: boolean;
}

const VOID_ACTION = {
  label: "Void sale",
  title: "Void this sale?",
  confirmLabel: "Void sale",
};

const BLOCKED_MESSAGES: Record<SaleCorrectionBlockReason, string> = {
  VOIDED: "This sale is voided — it can't be edited or voided again.",
  HAS_RETURN: "This sale has a return recorded against it. Undo the return first, then edit or void it.",
};

export function getSaleRowActions(sale: SaleRowActionSale, viewer: SaleRowActionViewer): SaleRowActionSet {
  const blockedReason: SaleCorrectionBlockReason | null = sale.voidedAt ? "VOIDED" : sale.hasReturn ? "HAS_RETURN" : null;

  if (blockedReason || !viewer.canCorrect) {
    return {
      edit: null,
      void: null,
      // Only explain a block that comes from the sale itself. A Mechanic seeing
      // no Edit button doesn't need a tooltip telling them they're a Mechanic.
      blockedReason: blockedReason,
      blockedMessage: blockedReason ? BLOCKED_MESSAGES[blockedReason] : null,
    };
  }

  return {
    edit: { label: "Edit sale" },
    void: VOID_ACTION,
    blockedReason: null,
    blockedMessage: null,
  };
}

/** True when any line on the sale carries a return — the shape `SaleRow`
 * already exposes, kept here so callers don't re-derive it three ways. */
export function saleHasReturn(sale: { lineItems: { returnedQuantity?: number | null }[] }): boolean {
  return sale.lineItems.some((line) => (line.returnedQuantity ?? 0) > 0);
}
