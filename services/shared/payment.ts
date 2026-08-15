/**
 * Payment capture — how a bill was settled (cash, UPI, or a split of both),
 * shared by Sales and Service. See doc/payment-split-scope.md for the
 * confirmed feature list.
 *
 * Two halves live here on purpose:
 *
 * 1. The *record* logic (`normalizePayment`, `derivePaymentStatus`,
 *    `validatePayment`) — what gets written to the database. `payment_status`
 *    is derived from the amounts rather than chosen separately, so status and
 *    amounts can never disagree; the same derivation is mirrored in SQL
 *    (0027_payment_split.sql) because the authoritative grand total is only
 *    known server-side once lines are priced.
 *
 * 2. The *draft* logic (`selectPaymentOption`, `editPaymentField`,
 *    `recalcForTotal`, …) — the form's keystroke-by-keystroke behaviour,
 *    kept as pure functions over a plain object rather than inside the
 *    component, because Vitest runs in a `node` environment with no React
 *    testing library (same reason components/service/service-filter-state.ts
 *    exists).
 *
 * No "server-only" import: the New Sale form runs this in the browser.
 */
import { formatINR } from "@/lib/format";
import type { PaymentMode } from "@/types/database.types";

/** Runtime list for zod enums and the option row. `satisfies` keeps it
 * locked to the database union — adding a mode in one place and not the
 * other stops compiling. */
export const PAYMENT_MODES = ["CASH", "UPI", "SPLIT"] as const satisfies readonly PaymentMode[];
export type { PaymentMode };

/** What the form offers. `FREE_SERVICE` is Service-only (warranty/goodwill
 * work), gated behind PaymentCapture's `allowFreeService` prop. */
export const PAYMENT_OPTIONS = ["CASH", "UPI", "SPLIT", "UNPAID", "FREE_SERVICE"] as const;
export type PaymentOption = (typeof PAYMENT_OPTIONS)[number];

export type PaymentStatus = "PENDING" | "PARTIAL" | "PAID" | "FREE_SERVICE";

export interface PaymentInput {
  mode: PaymentMode | null;
  cashAmount: number;
  upiAmount: number;
  /** Service only — an explicit override, never derived from the amounts:
   * ₹0 collected on a warranty job is not the same fact as ₹0 collected on
   * an unpaid one. */
  freeService?: boolean;
}

export interface ResolvedPayment {
  mode: PaymentMode | null;
  cashAmount: number;
  upiAmount: number;
  status: PaymentStatus;
  /** Grand total minus what was collected, floored at zero. */
  balanceDue: number;
}

export interface PaymentErrors {
  cash?: string;
  upi?: string;
  form?: string;
}

/** Money is stored to the paise. Rounding both operands before comparing
 * keeps `333.33 + 666.67 >= 1000` true instead of failing on binary float
 * residue. */
export function roundPaise(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The single source of truth for payment status. A zero-value bill (fully
 * discounted) counts as PAID rather than PENDING — there is nothing left to
 * collect, so flagging it as a debt would be wrong.
 */
export function derivePaymentStatus(cashAmount: number, upiAmount: number, grandTotal: number): PaymentStatus {
  const total = roundPaise(grandTotal);
  const paid = roundPaise(cashAmount + upiAmount);

  if (total <= 0) return "PAID";
  if (paid <= 0) return "PENDING";
  if (paid >= total) return "PAID";
  return "PARTIAL";
}

/**
 * Coerces a payment into its canonical stored shape. Mode is re-derived from
 * the amounts rather than trusted, so a SPLIT with one side zero is stored as
 * the single mode it actually is — the counter person shouldn't get a
 * validation error over a technicality they can't see.
 */
export function normalizePayment(input: PaymentInput, grandTotal: number): ResolvedPayment {
  if (input.freeService) {
    return { mode: null, cashAmount: 0, upiAmount: 0, status: "FREE_SERVICE", balanceDue: 0 };
  }

  let cashAmount = roundPaise(Math.max(0, Number.isFinite(input.cashAmount) ? input.cashAmount : 0));
  let upiAmount = roundPaise(Math.max(0, Number.isFinite(input.upiAmount) ? input.upiAmount : 0));

  if (input.mode === null) {
    cashAmount = 0;
    upiAmount = 0;
  } else if (input.mode === "CASH") {
    upiAmount = 0;
  } else if (input.mode === "UPI") {
    cashAmount = 0;
  }

  let mode: PaymentMode | null;
  if (cashAmount === 0 && upiAmount === 0) mode = null;
  else if (cashAmount === 0) mode = "UPI";
  else if (upiAmount === 0) mode = "CASH";
  else mode = "SPLIT";

  const status = derivePaymentStatus(cashAmount, upiAmount, grandTotal);

  return {
    mode,
    cashAmount,
    upiAmount,
    status,
    balanceDue: Math.max(0, roundPaise(grandTotal - cashAmount - upiAmount)),
  };
}

/**
 * Client-side mirror of the RPC's checks. Returns an empty object when the
 * payment is fine — callers treat `Object.keys(errors).length === 0` as pass,
 * matching how the other forms in this app handle validation state.
 */
export function validatePayment(input: PaymentInput, grandTotal: number): PaymentErrors {
  const errors: PaymentErrors = {};
  if (input.freeService) return errors;

  if (!Number.isFinite(input.cashAmount)) errors.cash = "Enter a valid amount";
  else if (input.cashAmount < 0) errors.cash = "Amount can't be negative";

  if (!Number.isFinite(input.upiAmount)) errors.upi = "Enter a valid amount";
  else if (input.upiAmount < 0) errors.upi = "Amount can't be negative";

  if (errors.cash || errors.upi) return errors;

  const paid = roundPaise(input.cashAmount + input.upiAmount);
  const total = roundPaise(grandTotal);
  if (paid > total) {
    errors.form = `Cash + UPI (${formatINR(paid)}) is more than the bill total (${formatINR(total)}).`;
  }

  if (input.mode !== null && !PAYMENT_MODES.includes(input.mode)) {
    errors.form = "Pick how the customer paid.";
  }

  return errors;
}

/**
 * What's still owed on a bill.
 *
 * Deliberately keyed off the *stored* status, not the amounts alone. Because
 * this feature backfilled nothing, every invoice settled before it existed
 * carries `payment_status = 'PAID'` with zero cash/upi — deriving purely from
 * amounts would print "Balance due ₹3,600" on the entire sales history.
 * A free service is likewise never a debt.
 */
export function balanceDueFor(bill: {
  paymentStatus: PaymentStatus | null;
  mode: PaymentMode | null;
  cashAmount: number;
  upiAmount: number;
  grandTotal: number;
}): number {
  if (bill.paymentStatus === "PAID" || bill.paymentStatus === "FREE_SERVICE") return 0;
  return normalizePayment(
    { mode: bill.mode, cashAmount: bill.cashAmount, upiAmount: bill.upiAmount },
    bill.grandTotal
  ).balanceDue;
}

/** "Cash ₹1,000 · UPI ₹1,000" — null when no mode was recorded, so historic
 * invoices print exactly as they did before this feature existed. */
export function formatPaidByLabel(payment: Pick<ResolvedPayment, "mode" | "cashAmount" | "upiAmount">): string | null {
  if (payment.mode === "CASH") return `Cash ${formatINR(payment.cashAmount)}`;
  if (payment.mode === "UPI") return `UPI ${formatINR(payment.upiAmount)}`;
  if (payment.mode === "SPLIT") return `Cash ${formatINR(payment.cashAmount)} · UPI ${formatINR(payment.upiAmount)}`;
  return null;
}

// ---------------------------------------------------------------------------
// Draft state — the form's behaviour
// ---------------------------------------------------------------------------

export type PaymentField = "cash" | "upi";

export interface PaymentDraft {
  option: PaymentOption;
  /**
   * Raw input text, not numbers — and the emptiness of that text is load
   * bearing. The whole auto-fill rule reads:
   *
   *   **empty means "work it out for me"; a number (including 0) means
   *   "I mean this".**
   *
   * So typing one side fills the other when it's blank, and only trims it
   * when the two would otherwise overshoot the bill. Clearing a field —
   * or typing 0 into it — is how the counter person says "nothing came in
   * this way", which is what leaves a balance owing.
   *
   * This replaced an earlier "touched" flag per field, which looked
   * equivalent but wasn't: once you had typed in a field it stopped
   * auto-filling *forever*, so clearing cash and then entering UPI left cash
   * stubbornly blank. Emptiness is both simpler and re-armable.
   */
  cash: string;
  upi: string;
}

export function parseAmount(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : Number.NaN;
}

function amountText(value: number): string {
  return String(roundPaise(value));
}

/** Fresh draft for a new bill. Defaults to Cash, matching the old pre-ticked
 * "Customer has paid" box — a counter sale is settled on the spot far more
 * often than not. */
export function initialPaymentDraft(grandTotal: number, option: PaymentOption = "CASH"): PaymentDraft {
  return selectPaymentOption({ option, cash: "", upi: "" }, option, grandTotal);
}

export function selectPaymentOption(draft: PaymentDraft, option: PaymentOption, grandTotal: number): PaymentDraft {
  const total = Math.max(0, roundPaise(grandTotal));
  const base = { ...draft, option };

  switch (option) {
    case "CASH":
      return { ...base, cash: amountText(total), upi: "" };
    case "UPI":
      return { ...base, cash: "", upi: amountText(total) };
    case "SPLIT":
      // Opens with both blank rather than pre-loading the full amount into
      // cash: blank is what arms the auto-fill, so the first figure typed
      // — either side — immediately works out the other.
      return { ...base, cash: "", upi: "" };
    default:
      return { ...base, cash: "", upi: "" };
  }
}

/**
 * Symmetric auto-fill: whichever side you type, the other one keeps up.
 *
 * - Other side blank → fill it with the remainder. ("₹3,000 on UPI" →
 *   cash becomes ₹2,000 on a ₹5,000 bill.)
 * - Other side already has a number, and the two would overshoot the bill →
 *   trim it to the remainder, so the pair can never exceed the total.
 * - Other side has a number and the two fit → leave it alone. This is the
 *   case that lets a bill be part paid: cash 0 + UPI 3,000 on a ₹5,000 bill
 *   stays exactly that, with ₹2,000 owing.
 */
export function editPaymentField(draft: PaymentDraft, field: PaymentField, raw: string, grandTotal: number): PaymentDraft {
  if (draft.option !== "SPLIT") return draft;

  const total = Math.max(0, roundPaise(grandTotal));
  const next: PaymentDraft = { ...draft, [field]: raw } as PaymentDraft;

  const value = parseAmount(raw);
  if (!Number.isFinite(value)) return next;

  const other: PaymentField = field === "cash" ? "upi" : "cash";
  const otherRaw = draft[other].trim();
  const otherValue = parseAmount(draft[other]);
  const remainder = amountText(clamp(total - value, 0, total));

  if (otherRaw === "") {
    next[other] = remainder;
  } else if (Number.isFinite(otherValue) && roundPaise(value + otherValue) > total) {
    next[other] = remainder;
  }

  return next;
}

/** The "Fill balance" affordance — sets a field to whatever is still owing
 * and marks it manual, so a later edit to the other side won't undo it. */
export function fillBalance(draft: PaymentDraft, field: PaymentField, grandTotal: number): PaymentDraft {
  const total = Math.max(0, roundPaise(grandTotal));
  const other: PaymentField = field === "cash" ? "upi" : "cash";
  const otherValue = parseAmount(draft[other]);
  const remainder = Number.isFinite(otherValue) ? clamp(total - otherValue, 0, total) : total;

  return { ...draft, [field]: amountText(remainder) } as PaymentDraft;
}

/**
 * Re-derives amounts when the bill total moves (a line added, GST toggled).
 * Without this, editing the sale after choosing payment leaves ₹2,000
 * recorded against a ₹2,500 bill.
 *
 * When both Split fields are manual and the new total can't hold them, UPI
 * wins and cash absorbs the shortfall — deterministic, and UPI is the figure
 * the counter person actually read off a phone screen, so it's the one worth
 * preserving.
 */
export function recalcForTotal(draft: PaymentDraft, grandTotal: number): PaymentDraft {
  const total = Math.max(0, roundPaise(grandTotal));

  switch (draft.option) {
    case "CASH":
      return { ...draft, cash: amountText(total), upi: "" };
    case "UPI":
      return { ...draft, cash: "", upi: amountText(total) };
    case "SPLIT": {
      // Blank stays blank — it means "not entered", and inventing a figure
      // for it just because the bill grew would put money in the drawer that
      // nobody counted. Entered amounts are trimmed so the pair can still
      // never exceed the new total; UPI is trimmed first and cash absorbs
      // the rest, since UPI is the figure read off a phone screen and the
      // one worth preserving.
      const cashValue = parseAmount(draft.cash);
      const upiValue = parseAmount(draft.upi);
      const safeCash = Number.isFinite(cashValue) ? cashValue : 0;
      const safeUpi = Number.isFinite(upiValue) ? upiValue : 0;

      const upi = draft.upi.trim() === "" ? "" : amountText(clamp(safeUpi, 0, total));
      const upiNum = upi === "" ? 0 : Number(upi);
      const cash = draft.cash.trim() === "" ? "" : amountText(clamp(safeCash, 0, total - upiNum));

      return { ...draft, cash, upi };
    }
    default:
      return { ...draft, cash: "", upi: "" };
  }
}

export function draftToPaymentInput(draft: PaymentDraft): PaymentInput {
  if (draft.option === "FREE_SERVICE") {
    return { mode: null, cashAmount: 0, upiAmount: 0, freeService: true };
  }
  if (draft.option === "UNPAID") {
    return { mode: null, cashAmount: 0, upiAmount: 0 };
  }
  return {
    mode: draft.option,
    cashAmount: parseAmount(draft.cash),
    upiAmount: parseAmount(draft.upi),
  };
}

/** Convenience for the form: draft → what would be stored, in one call. */
export function resolveDraft(draft: PaymentDraft, grandTotal: number): ResolvedPayment {
  return normalizePayment(draftToPaymentInput(draft), grandTotal);
}

/** Rebuilds a draft from an already-stored payment — the Record Payment
 * dialog opens pre-filled with what has been collected so far. */
export function draftFromPayment(payment: PaymentInput, grandTotal: number): PaymentDraft {
  if (payment.freeService) return initialPaymentDraft(grandTotal, "FREE_SERVICE");

  const resolved = normalizePayment(payment, grandTotal);
  if (resolved.mode === null) return initialPaymentDraft(grandTotal, "UNPAID");

  // A single-mode payment that doesn't cover the bill reopens as Split with
  // both sides manual — otherwise "Full — Cash" would silently round a
  // ₹500-on-₹2,000 part payment back up to the full total on save.
  if (resolved.mode === "SPLIT" || resolved.balanceDue > 0) {
    return { option: "SPLIT", cash: amountText(resolved.cashAmount), upi: amountText(resolved.upiAmount) };
  }
  return initialPaymentDraft(grandTotal, resolved.mode);
}
