/**
 * Shared invoice generation — used by Sales and (once built) Service to
 * produce billing documents. Sales invoices may include Tyre Fitting
 * charges (₹300/wheel); Service invoices may include Labour charges. GST
 * and Discount are optional on both.
 *
 * This is presentation-only: every number here is read straight off the
 * already-computed SaleRow (services/sales/sales.ts) — nothing is
 * recalculated, so the invoice can never drift from the stored record.
 * See doc/billing-invoice-scope.md for the confirmed feature list.
 */
import type { SaleLineItemRow, SaleRow } from "@/services/sales/sales";
import type { ServiceJobRow } from "@/services/service/jobs";

import { formatDate, formatINR } from "@/lib/format";
import { balanceDueFor, formatPaidByLabel, normalizePayment } from "@/services/shared/payment";

/** Confirmed rate (doc/sales-module-scope.md §4) — used only to render the
 * "unit price" column text; the actual line amount always comes from the
 * stored, server-computed line_total, never recalculated here. */
const TYRE_FITTING_RATE = 300;

export interface BusinessInfo {
  name: string;
  addressLines: string[];
  /** Omitted entirely (no row rendered) until a real number is supplied. */
  phone?: string;
  /** Omitted entirely (no row rendered) until a real number is supplied. */
  gstin?: string;
}

export interface InvoiceLineView {
  slNo: number;
  description: string;
  /** Combo Offers — the bundle's contents, printed unpriced beneath the
   * line so the customer sees what one price covered (plan §3.D). */
  comboContents?: string[];
  /** Combo Offers — this part came free with a combo; shows a tag instead
   * of a price so the ₹0 doesn't read as a mistake. */
  includedInCombo?: boolean;
  /** SKU code for a product line, "Installed by <name>" for an
   * installation line with a staff name recorded — omitted otherwise. */
  detail?: string;
  quantityLabel: string;
  unitPriceLabel: string;
  amountLabel: string;
}

export interface InvoiceTotalsView {
  subtotalLabel: string;
  /** Null (row hidden) when there were no installation charges at all. */
  installationTotalLabel: string | null;
  /** Null (row hidden) when GST isn't applicable or the amount is zero. */
  gst: { ratePercentLabel: string; amountLabel: string } | null;
  /** Null (row hidden) when Discount isn't applicable or the amount is zero. */
  discount: { amountLabel: string } | null;
  grandTotalLabel: string;
  /** Combo Offers — what the customer saved against buying the bundle's
   * contents separately. Null when the sale carries no combo, or when the
   * combo saved nothing. */
  comboSavingsLabel: string | null;
  /** Shown on the invoice when the money wasn't collected (0024), so an
   * unpaid copy can't be mistaken for a settled one. */
  paymentPendingLabel: string | null;
  /** "Cash ₹1,000 · UPI ₹1,000" (0027). Null when no tender was recorded —
   * invoices raised before this feature existed print exactly as they did. */
  paidByLabel: string | null;
  /** Null unless money is still owed against this bill. */
  balanceDueLabel: string | null;
}

export interface SalesInvoiceView {
  invoiceNumber: string;
  invoiceDateLabel: string;
  business: BusinessInfo;
  customer: { name: string; mobile: string; addressLines: string[] };
  lines: InvoiceLineView[];
  totals: InvoiceTotalsView;
}

function formatPercentLabel(value: number): string {
  // Trim to at most 2 decimals without a trailing ".00" for whole rates
  // (18, not 18.00) — round(x*100)/100 kills float noise like 17.999999994.
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}%`;
}

function buildLineView(line: SaleLineItemRow, slNo: number): InvoiceLineView {
  if (line.lineType === "COMBO") {
    return {
      slNo,
      description: line.description ?? "Combo Offer",
      comboContents: line.comboContents.length > 0 ? line.comboContents : undefined,
      quantityLabel: line.quantity !== null ? String(line.quantity) : "1",
      unitPriceLabel: formatINR(line.lineTotal),
      amountLabel: formatINR(line.lineTotal),
    };
  }

  if (line.lineType === "PRODUCT") {
    return {
      slNo,
      description: line.itemName ?? "—",
      detail: line.itemSkuCode ?? undefined,
      includedInCombo: line.includedInCombo || undefined,
      quantityLabel: line.quantity !== null ? String(line.quantity) : "—",
      // A product covered by a combo prints "Included" rather than ₹0.00 —
      // a row of zeroes reads like a pricing bug to a customer.
      unitPriceLabel: line.includedInCombo ? "Included" : line.unitSellingPrice !== null ? formatINR(line.unitSellingPrice) : "—",
      amountLabel: line.includedInCombo ? "—" : formatINR(line.lineTotal),
    };
  }

  // INSTALLATION
  const installedByDetail = line.installedBy?.trim() ? `Installed by ${line.installedBy.trim()}` : undefined;

  if (line.installationSubtype === "TYRE_FITTING") {
    const wheels = line.wheelCount ?? 0;
    return {
      slNo,
      description: "Tyre Fitting",
      detail: installedByDetail,
      quantityLabel: `${wheels} wheel${wheels === 1 ? "" : "s"}`,
      unitPriceLabel: `${formatINR(TYRE_FITTING_RATE)}/wheel`,
      amountLabel: formatINR(line.lineTotal),
    };
  }

  // CUSTOM
  return {
    slNo,
    description: line.description?.trim() || "Installation Charge",
    detail: installedByDetail,
    quantityLabel: "—",
    unitPriceLabel: "—",
    amountLabel: formatINR(line.lineTotal),
  };
}

function buildTotalsView(sale: SaleRow): InvoiceTotalsView {
  const taxableTotal = sale.subtotal + sale.installationTotal;

  const gst =
    sale.gstApplicable && sale.gstAmount > 0
      ? {
          ratePercentLabel: taxableTotal > 0 ? formatPercentLabel((sale.gstAmount / taxableTotal) * 100) : "—",
          amountLabel: formatINR(sale.gstAmount),
        }
      : null;

  const discount =
    sale.discountApplicable && sale.discountAmount > 0 ? { amountLabel: formatINR(sale.discountAmount) } : null;

  const payment = normalizePayment(
    { mode: sale.paymentMode, cashAmount: sale.cashAmount, upiAmount: sale.upiAmount },
    sale.grandTotal
  );
  // Not payment.balanceDue: a sale settled before tender was tracked has zero
  // amounts but is not owed, and its stored status is what says so.
  const balanceDue = balanceDueFor({
    paymentStatus: sale.paymentStatus,
    mode: sale.paymentMode,
    cashAmount: sale.cashAmount,
    upiAmount: sale.upiAmount,
    grandTotal: sale.grandTotal,
  });

  // Derived from what the bundle was snapshotted as being worth at sale
  // time — never recomputed from today's catalog, which would rewrite an old
  // invoice's headline figure.
  const comboSavings = sale.lineItems
    .filter((line) => line.lineType === "COMBO")
    .reduce((sum, line) => sum + Math.max(0, (line.comboListValue ?? 0) - line.lineTotal), 0);

  return {
    subtotalLabel: formatINR(sale.subtotal),
    installationTotalLabel: sale.installationTotal > 0 ? formatINR(sale.installationTotal) : null,
    gst,
    discount,
    comboSavingsLabel: comboSavings > 0 ? formatINR(comboSavings) : null,
    paymentPendingLabel: sale.paymentStatus === "PAID" ? null : sale.paymentStatus === "PARTIAL" ? "Part payment received" : "Payment pending",
    paidByLabel: formatPaidByLabel(payment),
    balanceDueLabel: balanceDue > 0 ? formatINR(balanceDue) : null,
    // Always formatted straight from the stored grand_total — never
    // subtotal + installation + gst - discount recomputed here, so this
    // can't drift from the authoritative server-side figure.
    grandTotalLabel: formatINR(sale.grandTotal),
  };
}

/**
 * Builds everything the invoice page needs to render, in the exact order
 * lines were added to the sale (doc/sales-module-scope.md §4/§7 — products
 * and installation charges share one combined, position-ordered table;
 * "never blended" refers to the *financial* subtotal, not visual grouping).
 */
export function buildSalesInvoiceView(sale: SaleRow, business: BusinessInfo): SalesInvoiceView {
  return {
    invoiceNumber: sale.invoiceNumber,
    invoiceDateLabel: formatDate(sale.saleDate),
    business,
    customer: {
      name: sale.customerName,
      mobile: sale.customerMobile,
      addressLines: sale.customerAddress ? [sale.customerAddress] : [],
    },
    lines: sale.lineItems.map((line, index) => buildLineView(line, index + 1)),
    totals: buildTotalsView(sale),
  };
}

// ---------------------------------------------------------------------------
// Service Invoice (doc/service-module-scope.md §18, spec §4.10) — same
// shared engine, distinct layout: Service/Package/Specific/Custom charges
// (all service_job_lines, one combined section — same "position-ordered,
// mixed line kinds" principle Sales already uses for PRODUCT/INSTALLATION)
// plus a separate, never-blended Inventory Used section. Only ever built
// for a COMPLETED job (doc §18) — invoiceNumber/completedAt don't exist
// before that.
// ---------------------------------------------------------------------------

export class ServiceInvoiceNotAvailableError extends Error {
  constructor() {
    super("This Service Job hasn't been completed yet — its invoice isn't available until then.");
    this.name = "ServiceInvoiceNotAvailableError";
  }
}

export interface ServiceInvoiceTotalsView {
  subtotalLabel: string;
  /** Null (row hidden) when no parts/consumables were used at all. */
  inventoryTotalLabel: string | null;
  gst: { ratePercentLabel: string; amountLabel: string } | null;
  discount: { amountLabel: string } | null;
  grandTotalLabel: string;
  /** Combo Offers — what the customer saved against buying the bundle's
   * contents separately (plan §5, confirmed decision 4). Null when the job
   * carries no combo, or when the combo saved nothing. */
  comboSavingsLabel: string | null;
  /** "Cash ₹1,000 · UPI ₹1,000" (0027) — null for a free service, an unpaid
   * job, or a job completed before this feature existed. */
  paidByLabel: string | null;
  balanceDueLabel: string | null;
}

export interface ServiceInvoiceView {
  invoiceNumber: string;
  invoiceDateLabel: string;
  business: BusinessInfo;
  customer: { name: string; mobile: string; addressLines: string[] };
  vehicle: { number: string; model: string; odometerLabel: string };
  /** Service/Package/Specific/Custom lines, position order. */
  serviceLines: InvoiceLineView[];
  /** Parts/consumables used — itemized separately, never blended into
   * serviceLines' subtotal (doc §6/§18, non-negotiable). */
  inventoryLines: InvoiceLineView[];
  totals: ServiceInvoiceTotalsView;
}

function buildServiceTotalsView(job: ServiceJobRow): ServiceInvoiceTotalsView {
  const taxableTotal = job.subtotal + job.inventoryTotal;

  const gst =
    job.gstApplicable && job.gstAmount > 0
      ? {
          ratePercentLabel: taxableTotal > 0 ? formatPercentLabel((job.gstAmount / taxableTotal) * 100) : "—",
          amountLabel: formatINR(job.gstAmount),
        }
      : null;

  const discount = job.discountApplicable && job.discountAmount > 0 ? { amountLabel: formatINR(job.discountAmount) } : null;

  // A free service collected nothing by design — printing "Balance due" on a
  // warranty job would read as a demand for money the shop isn't owed.
  const payment =
    job.paymentStatus === "FREE_SERVICE"
      ? normalizePayment({ mode: null, cashAmount: 0, upiAmount: 0, freeService: true }, job.grandTotal)
      : normalizePayment({ mode: job.paymentMode, cashAmount: job.cashAmount, upiAmount: job.upiAmount }, job.grandTotal);
  const balanceDue = balanceDueFor({
    paymentStatus: job.paymentStatus,
    mode: job.paymentMode,
    cashAmount: job.cashAmount,
    upiAmount: job.upiAmount,
    grandTotal: job.grandTotal,
  });

  // The saving is derived from what the combo's contents were snapshotted as
  // being worth at the time — never recomputed from today's catalog, which
  // would rewrite an old invoice's headline figure.
  const comboSavings = job.lines
    .filter((line) => line.lineType === "COMBO")
    .reduce((sum, line) => sum + Math.max(0, (line.comboListValue ?? 0) - line.amount), 0);

  return {
    subtotalLabel: formatINR(job.subtotal),
    inventoryTotalLabel: job.inventoryTotal > 0 ? formatINR(job.inventoryTotal) : null,
    gst,
    discount,
    comboSavingsLabel: comboSavings > 0 ? formatINR(comboSavings) : null,
    paidByLabel: formatPaidByLabel(payment),
    balanceDueLabel: balanceDue > 0 ? formatINR(balanceDue) : null,
    // Always the stored, server-computed grand_total — never recomputed
    // here, same "can't drift from the authoritative figure" rule as Sales.
    grandTotalLabel: formatINR(job.grandTotal),
  };
}

/**
 * Only ever callable for a COMPLETED job (doc §18) — a job still Draft/In
 * Progress/Ready for Delivery has no invoice_number/completed_at yet.
 * Throws rather than silently rendering a blank/broken invoice.
 */
export function buildServiceInvoiceView(job: ServiceJobRow, business: BusinessInfo): ServiceInvoiceView {
  if (job.status !== "COMPLETED" || !job.invoiceNumber || !job.completedAt) {
    throw new ServiceInvoiceNotAvailableError();
  }

  return {
    invoiceNumber: job.invoiceNumber,
    invoiceDateLabel: formatDate(job.completedAt),
    business,
    customer: {
      name: job.customerName,
      mobile: job.customerMobile,
      addressLines: job.customerAddress ? [job.customerAddress] : [],
    },
    vehicle: {
      number: job.vehicleNumber,
      model: job.vehicleModel,
      odometerLabel: `${job.odometerReading.toLocaleString("en-IN")} km`,
    },
    serviceLines: job.lines.map((line, index) => ({
      slNo: index + 1,
      description: line.description,
      comboContents: line.lineType === "COMBO" && line.comboContents.length > 0 ? line.comboContents : undefined,
      quantityLabel: String(line.quantity),
      unitPriceLabel: formatINR(line.rate),
      amountLabel: formatINR(line.amount),
    })),
    inventoryLines: job.usage.map((line, index) => ({
      slNo: index + 1,
      description: line.itemName,
      includedInCombo: line.includedInCombo || undefined,
      quantityLabel: String(line.quantityUsed),
      // A part covered by a combo prints "Included" rather than ₹0.00 —
      // a row of zeroes reads like a pricing bug to a customer.
      unitPriceLabel: line.includedInCombo ? "Included" : formatINR(line.unitPrice),
      amountLabel: line.includedInCombo ? "—" : formatINR(line.lineTotal),
    })),
    totals: buildServiceTotalsView(job),
  };
}
