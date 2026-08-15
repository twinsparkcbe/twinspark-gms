import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { roundPaise } from "@/services/shared/payment";
import type { Database } from "@/types/database.types";

export type GstBillType = "SALE" | "SERVICE";

export interface GstReportRow {
  id: string;
  type: GstBillType;
  /** ISO timestamp — `sale_date` for a Sale, `completed_at` for a Service Job. */
  date: string;
  invoiceNumber: string | null;
  customerName: string;
  /** subtotal + installation/parts total — the GST base, before tax. */
  taxableValue: number;
  gstAmount: number;
  /** Derived, not stored — see derivedGstRate below. `null` when there's no
   * taxable value to divide by (shouldn't happen for a GST-applicable bill,
   * but guards the divide-by-zero rather than showing "Infinity%"). */
  gstRate: number | null;
  grandTotal: number;
}

export interface GstReport {
  taxableValue: number;
  gstAmount: number;
  totalInvoiceValue: number;
  /** Count of GST-applicable bills in range (Sales + completed Service Jobs
   * combined) — NOT the shop's total bill count for the period; a "N of M"
   * framing would need two more queries for a number the owner doesn't
   * actually need to file GST (doc/reports-scope.md addendum). */
  billCount: number;
  /** Sales + completed Service Jobs, combined into one flat list and sorted
   * newest-first — not paginated, matching getCollectionsReport's precedent
   * (a GST filing period needs the whole range at once, not a capped
   * preview page). */
  rows: GstReportRow[];
}

type CustomerJoin = { name: string } | { name: string }[] | null;

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * `gst_percent` is never persisted — only the computed `gst_amount` is
 * (Sales/Service forms default to 18% but let it be edited per bill). This
 * re-derives the rate from what IS stored, the same formula the Sales/
 * Service edit forms already use to re-populate their own GST-rate field
 * from a saved bill (`derivedGstPercent` in `new-sale-page-client.tsx` /
 * `service-job-form-client.tsx`) — kept in sync by hand since neither of
 * those helpers is exported for cross-module reuse.
 */
function derivedGstRate(gstAmount: number, taxableValue: number): number | null {
  if (gstAmount <= 0 || taxableValue <= 0) return null;
  return Math.round((gstAmount / taxableValue) * 10000) / 100;
}

type SaleGstRow = {
  id: string;
  sale_date: string;
  invoice_number: string | null;
  subtotal: number;
  installation_total: number;
  gst_amount: number;
  grand_total: number;
  customers: CustomerJoin;
};

type ServiceGstRow = {
  id: string;
  completed_at: string | null;
  invoice_number: string | null;
  subtotal: number;
  inventory_total: number;
  gst_amount: number;
  grand_total: number;
  payment_status: string | null;
  customers: CustomerJoin;
};

/**
 * GST Report (doc/reports-scope.md addendum) — every Sale + completed
 * Service Job with GST applied, over a date range, combined into one
 * date-sorted list for filing/reconciliation. Voided sales and FREE_SERVICE
 * jobs are excluded, matching the convention every other money figure in
 * this app already follows (they're corrections/non-revenue, not billed
 * GST activity).
 */
export async function getGstReport(
  supabase: SupabaseClient<Database>,
  range: { from: Date; to: Date }
): Promise<GstReport> {
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const [salesRes, serviceRes] = await Promise.all([
    supabase
      .from("sales")
      .select(
        "id, sale_date, invoice_number, subtotal, installation_total, gst_amount, grand_total, customers!inner(name)"
      )
      .is("voided_at", null)
      .eq("gst_applicable", true)
      .gte("sale_date", fromIso)
      .lte("sale_date", toIso),
    supabase
      .from("service_jobs")
      .select(
        "id, completed_at, invoice_number, subtotal, inventory_total, gst_amount, grand_total, payment_status, customers!inner(name)"
      )
      .eq("status", "COMPLETED")
      .eq("gst_applicable", true)
      .gte("completed_at", fromIso)
      .lte("completed_at", toIso),
  ]);

  if (salesRes.error) throw new Error(salesRes.error.message);
  if (serviceRes.error) throw new Error(serviceRes.error.message);

  const saleRows: GstReportRow[] = ((salesRes.data ?? []) as unknown as SaleGstRow[]).map((row) => {
    const taxableValue = roundPaise(Number(row.subtotal) + Number(row.installation_total));
    const gstAmount = Number(row.gst_amount);
    return {
      id: row.id,
      type: "SALE",
      date: row.sale_date,
      invoiceNumber: row.invoice_number,
      customerName: firstOrSelf(row.customers)?.name ?? "Unknown customer",
      taxableValue,
      gstAmount,
      gstRate: derivedGstRate(gstAmount, taxableValue),
      grandTotal: Number(row.grand_total),
    };
  });

  const serviceRows: GstReportRow[] = ((serviceRes.data ?? []) as unknown as ServiceGstRow[])
    // A free service is not revenue and was never really "billed with GST" —
    // excluded the same way getCollectionsReport excludes it from every
    // money bucket.
    .filter((row) => row.payment_status !== "FREE_SERVICE")
    .map((row) => {
      const taxableValue = roundPaise(Number(row.subtotal) + Number(row.inventory_total));
      const gstAmount = Number(row.gst_amount);
      return {
        id: row.id,
        type: "SERVICE" as const,
        date: row.completed_at ?? "",
        invoiceNumber: row.invoice_number,
        customerName: firstOrSelf(row.customers)?.name ?? "Unknown customer",
        taxableValue,
        gstAmount,
        gstRate: derivedGstRate(gstAmount, taxableValue),
        grandTotal: Number(row.grand_total),
      };
    });

  const rows = [...saleRows, ...serviceRows].sort((a, b) => b.date.localeCompare(a.date));

  const totals = rows.reduce(
    (acc, row) => ({
      taxableValue: roundPaise(acc.taxableValue + row.taxableValue),
      gstAmount: roundPaise(acc.gstAmount + row.gstAmount),
      totalInvoiceValue: roundPaise(acc.totalInvoiceValue + row.grandTotal),
    }),
    { taxableValue: 0, gstAmount: 0, totalInvoiceValue: 0 }
  );

  return { ...totals, billCount: rows.length, rows };
}
