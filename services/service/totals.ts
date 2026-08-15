/**
 * Running totals for a Service Job, computed from the draft rows the form
 * holds in state (doc/service-ux-rework-plan.md §C).
 *
 * Extracted verbatim from `service-job-form-client.tsx` so the arithmetic is
 * unit-testable and so exactly one implementation feeds the on-screen
 * "Estimated Total" — a second copy would be free to drift from the invoice
 * the server computes. Deliberately dependency-free (no React, no Supabase):
 * plain numbers in, plain numbers out.
 *
 * Rounding matches the server's: every money value is rounded to 2 decimals
 * at the same points the SQL does, so the screen and the printed invoice can
 * never disagree by a paisa.
 */

/** Money rounding — 2 decimals, half-up, matching the numeric(12,2) columns. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface TotalsLineInput {
  /** String-typed because these come straight from form inputs. */
  quantity: string | number;
  rate: string | number;
}

export interface TotalsPartInput {
  inventoryItemId: string | null;
  quantityUsed: string | number;
  /** Combo Offers — a part covered by a combo price bills at ₹0 here, while
   * still counting as stock that will move at completion. */
  includedInCombo?: boolean;
}

export interface TotalsPriceLookup {
  /** Selling price only — a service total must never expose purchase price. */
  sellingPriceOf: (inventoryItemId: string) => number | undefined;
}

export interface ServiceJobTotalsInput {
  lines: TotalsLineInput[];
  parts: TotalsPartInput[];
  prices: TotalsPriceLookup;
  gstApplicable: boolean;
  /** Percentage, e.g. 18 for 18%. */
  gstPercent: string | number;
  discountApplicable: boolean;
  discountAmount: string | number;
}

export interface ServiceJobTotals {
  subtotal: number;
  partsTotal: number;
  taxableTotal: number;
  gstAmount: number;
  discountAmount: number;
  grandTotal: number;
}

/** Blank/garbage form input reads as 0 rather than NaN — an unfinished row
 * shouldn't poison the whole total while the admin is still typing. */
function toNumber(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function toWholeNumber(value: string | number): number {
  return Math.trunc(toNumber(value));
}

/** Amount of a single service line — the client-side mirror of
 * `service_job_lines.amount` (a generated `quantity * rate` column). */
export function serviceLineAmount(line: TotalsLineInput): number {
  return roundMoney(toWholeNumber(line.quantity) * toNumber(line.rate));
}

export function computeServiceJobTotals(input: ServiceJobTotalsInput): ServiceJobTotals {
  const subtotal = roundMoney(input.lines.reduce((sum, line) => sum + serviceLineAmount(line), 0));

  const partsTotal = roundMoney(
    input.parts.reduce((sum, part) => {
      if (part.includedInCombo) return sum; // already paid for by the combo price
      if (!part.inventoryItemId) return sum; // row added but no item picked yet
      const price = input.prices.sellingPriceOf(part.inventoryItemId);
      if (price === undefined) return sum; // item no longer in the loaded list
      return sum + price * toWholeNumber(part.quantityUsed);
    }, 0)
  );

  const taxableTotal = roundMoney(subtotal + partsTotal);

  const gstPercent = toNumber(input.gstPercent);
  const gstAmount = input.gstApplicable ? roundMoney((taxableTotal * gstPercent) / 100) : 0;

  const discountAmount = input.discountApplicable ? roundMoney(toNumber(input.discountAmount)) : 0;

  // Floors at zero: an over-generous discount reduces the bill to nothing, it
  // never turns into money owed back to the customer.
  const grandTotal = Math.max(0, roundMoney(taxableTotal + gstAmount - discountAmount));

  return { subtotal, partsTotal, taxableTotal, gstAmount, discountAmount, grandTotal };
}
