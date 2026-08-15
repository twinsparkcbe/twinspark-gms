import { balanceDueFor as sharedBalanceDueFor, type PaymentMode, type PaymentStatus } from "@/services/shared/payment";
import { formatINR } from "@/lib/format";

/**
 * The Paid column's chip (doc/payment-split-scope.md §7). Pure logic in a
 * .ts file rather than inline JSX so it can be unit tested — Vitest runs in a
 * `node` environment with no React testing library (same reason
 * components/service/service-filter-state.ts exists).
 *
 * Tender and settlement are shown in one chip on purpose: the owner scanning
 * the list wants "did I get the money, and how" as a single glance, and two
 * adjacent chips per row would crowd a table that already carries six
 * columns.
 */
/** Matches the Badge component's variants. Per style guide §12 the
 * payment-channel colours are fixed: success = cash, info = UPI, purple =
 * the mixed case. */
export type PaymentChipVariant = "success" | "warning" | "danger" | "info" | "channel" | "neutral";

export interface PaymentChip {
  label: string;
  variant: PaymentChipVariant;
  /** Hover text — carries the balance owing, which has nowhere else to go in
   * a one-word chip. */
  title?: string;
}

export function paymentChipFor(input: {
  paymentStatus: PaymentStatus | null;
  paymentMode: PaymentMode | null;
  balanceDue: number;
}): PaymentChip {
  if (input.paymentStatus === "FREE_SERVICE") {
    return { label: "Free", variant: "neutral", title: "Free service — nothing to collect" };
  }

  if (input.paymentStatus === "PENDING") {
    return { label: "Pending", variant: "danger", title: `${formatINR(input.balanceDue)} outstanding` };
  }

  if (input.paymentStatus === "PARTIAL") {
    return { label: "Partial", variant: "warning", title: `${formatINR(input.balanceDue)} still due` };
  }

  // PAID from here on.
  switch (input.paymentMode) {
    case "CASH":
      return { label: "Cash", variant: "success" };
    case "UPI":
      return { label: "UPI", variant: "info" };
    case "SPLIT":
      return { label: "Split", variant: "channel", title: "Part cash, part UPI" };
    default:
      // Settled before 0027 existed, so the tender genuinely isn't known.
      // An em dash rather than a guess at "Cash" — the Collections report
      // makes the same distinction.
      return { label: "—", variant: "neutral", title: "Paid — tender not recorded" };
  }
}

/**
 * Thin adapter so the Sales table can pass a `SaleRow` straight through.
 * The rule itself lives in services/shared/payment.ts — it has to match what
 * the invoice prints.
 */
export function balanceDueFor(bill: {
  paymentMode: PaymentMode | null;
  cashAmount: number;
  upiAmount: number;
  grandTotal: number;
  paymentStatus?: PaymentStatus | null;
}): number {
  return sharedBalanceDueFor({
    paymentStatus: bill.paymentStatus ?? null,
    mode: bill.paymentMode,
    cashAmount: bill.cashAmount,
    upiAmount: bill.upiAmount,
    grandTotal: bill.grandTotal,
  });
}
