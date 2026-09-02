import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { roundPaise } from "@/services/shared/payment";
import type { Database } from "@/types/database.types";

/**
 * Service Profit Report (doc/service-profit-report-scope.md) — what service
 * work actually earns, once the spares it consumed are paid for.
 *
 * The question the shop asks, and why the existing reports can't answer it:
 *
 *   * The Service Report shows labour and parts BILLED, never what the parts
 *     cost.
 *   * The Profit Report nets everything — Sales, Online and Service — into
 *     one figure against one shop-wide COGS number. It cannot say whether
 *     the service side is carrying the shop or being carried by it.
 *
 * The shape of the answer, and the reason this report exists at all: a
 * service job earns on two completely different footings.
 *
 *   * Labour and non-stock services — water wash, tyre fitting, general
 *     service, any Custom line — consume no inventory. Every rupee is
 *     margin.
 *   * Parts are goods. What they earn is what they were billed for minus
 *     what those exact units cost, which is now snapshotted per job at
 *     deduction time (`service_inventory_usage.cost_total`, 0041) rather
 *     than reconstructed from `stock_movements` afterwards.
 *
 * Deliberate accounting decisions (confirmed with the developer 2026-09-02):
 *
 *   * GST IS EXCLUDED from profit. It is collected for the government and
 *     paid on to it — counting it as earnings would inflate every figure
 *     here by the tax rate. It is reported as its own number so the total
 *     still reconciles against the job's grand total.
 *   * THE JOB DISCOUNT IS SUBTRACTED, whole, from the job's own profit. A
 *     discount is money given away on that job, not a shop-wide adjustment.
 *   * A FREE SERVICE EARNS NOTHING AND STILL COSTS. Its revenue is zero —
 *     nothing was collected and nothing was meant to be — while the parts it
 *     consumed cost exactly what they cost. Such a job shows a loss equal to
 *     its parts, which is the honest price of goodwill work, and the totals
 *     carry it separately so it can be seen rather than blamed on the paying
 *     jobs around it.
 *
 * Jobs are counted by `completed_at`, matching getServiceStats, the Revenue
 * Report and the Dashboard: a job earns on the day it is billed, not the day
 * the bike was booked in. Only COMPLETED jobs appear — anything else has no
 * invoice and has not moved stock.
 */

export interface ServiceProfitJobRow {
  id: string;
  jobNumber: string;
  invoiceNumber: string | null;
  /** ISO timestamp — `completed_at`. */
  completedAt: string;
  customerName: string;
  vehicleNumber: string;
  /** Service lines: labour and everything else that consumes no stock. */
  labourRevenue: number;
  /** Parts billed to the customer (`inventory_total`). */
  partsRevenue: number;
  /** Snapshotted FIFO cost of those parts (0041). */
  partsCost: number;
  /** Job-level discount, subtracted from this job's profit. */
  discount: number;
  /** Collected for the government — excluded from profit, shown so the row
   * still adds up to `grandTotal`. */
  gstAmount: number;
  grandTotal: number;
  /** labour + parts − discount − parts cost. Zero revenue on a free service,
   * so it lands at exactly −partsCost. Never floored: a job that gave away
   * more than it earned reads as the loss it was. */
  profit: number;
  isFreeService: boolean;
  /** True when any part on the job carries a back-filled estimate rather
   * than its real batch cost (0041 §4). Surfaced so an estimate is never
   * silently read as an exact figure. */
  costIsEstimated: boolean;
}

export interface ServiceProfitReport {
  jobCount: number;
  /** Pure margin — these lines consume no stock. */
  labourRevenue: number;
  partsRevenue: number;
  partsCost: number;
  /** partsRevenue − partsCost. Can be negative: combo parts bill at ₹0 and
   * still cost, and a part can be sold below what it cost. */
  partsProfit: number;
  discountTotal: number;
  /** labourRevenue + partsProfit − discountTotal. */
  totalProfit: number;
  /** Excluded from every profit figure above; here so the report reconciles
   * against what was actually billed. */
  gstCollected: number;
  /** Labour + parts − discount + GST, i.e. what the customers were billed,
   * free services included at zero. */
  totalBilled: number;
  freeServiceJobCount: number;
  /** What goodwill work cost in parts over the period. Already inside
   * partsCost — reported separately, not added twice. */
  freeServiceCost: number;
  /** How many rows carry a back-filled estimate (0041 §4). */
  estimatedCostJobCount: number;
  jobs: ServiceProfitJobRow[];
}

type NameJoin = { name: string } | { name: string }[] | null;
type VehicleJoin = { vehicle_number: string } | { vehicle_number: string }[] | null;
type UsageJoin = { cost_total: number | null; cost_is_estimated: boolean | null }[] | null;

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

type ServiceProfitSourceRow = {
  id: string;
  job_number: string;
  invoice_number: string | null;
  completed_at: string | null;
  payment_status: string | null;
  subtotal: number | null;
  inventory_total: number | null;
  discount_applicable: boolean | null;
  discount_amount: number | null;
  gst_amount: number | null;
  grand_total: number | null;
  customers: NameJoin;
  vehicles: VehicleJoin;
  service_inventory_usage: UsageJoin;
};

const SELECT_COLUMNS =
  "id, job_number, invoice_number, completed_at, payment_status, subtotal, inventory_total, discount_applicable, discount_amount, gst_amount, grand_total, customers!inner(name), vehicles!inner(vehicle_number), service_inventory_usage(cost_total, cost_is_estimated)";

/**
 * Pure aggregation, split out from the query so the arithmetic is
 * unit-testable without a database — the same split `getCollectionsReport`
 * and `getGstReport` use.
 */
export function buildServiceProfitReport(rows: ServiceProfitSourceRow[]): ServiceProfitReport {
  const jobs: ServiceProfitJobRow[] = rows
    .filter((row) => row.completed_at !== null)
    .map((row) => {
      const isFreeService = row.payment_status === "FREE_SERVICE";
      const usage = row.service_inventory_usage ?? [];

      const partsCost = roundPaise(usage.reduce((sum, u) => sum + Number(u.cost_total ?? 0), 0));
      const costIsEstimated = usage.some((u) => u.cost_is_estimated === true);

      // A free service was never going to bring money in, so it brings none
      // here either — but it consumed real parts, and those stay.
      const labourRevenue = isFreeService ? 0 : roundPaise(Number(row.subtotal ?? 0));
      const partsRevenue = isFreeService ? 0 : roundPaise(Number(row.inventory_total ?? 0));
      const discount = isFreeService || !row.discount_applicable ? 0 : roundPaise(Number(row.discount_amount ?? 0));
      const gstAmount = roundPaise(Number(row.gst_amount ?? 0));

      return {
        id: row.id,
        jobNumber: row.job_number,
        invoiceNumber: row.invoice_number,
        completedAt: row.completed_at as string,
        customerName: firstOrSelf(row.customers)?.name ?? "—",
        vehicleNumber: firstOrSelf(row.vehicles)?.vehicle_number ?? "—",
        labourRevenue,
        partsRevenue,
        partsCost,
        discount,
        gstAmount,
        grandTotal: roundPaise(Number(row.grand_total ?? 0)),
        profit: roundPaise(labourRevenue + partsRevenue - discount - partsCost),
        isFreeService,
        costIsEstimated,
      };
    })
    // Newest first — the same order every other Reports list uses.
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());

  const labourRevenue = roundPaise(jobs.reduce((sum, j) => sum + j.labourRevenue, 0));
  const partsRevenue = roundPaise(jobs.reduce((sum, j) => sum + j.partsRevenue, 0));
  const partsCost = roundPaise(jobs.reduce((sum, j) => sum + j.partsCost, 0));
  const discountTotal = roundPaise(jobs.reduce((sum, j) => sum + j.discount, 0));
  const gstCollected = roundPaise(jobs.reduce((sum, j) => sum + j.gstAmount, 0));
  const partsProfit = roundPaise(partsRevenue - partsCost);
  const freeServiceJobs = jobs.filter((j) => j.isFreeService);

  return {
    jobCount: jobs.length,
    labourRevenue,
    partsRevenue,
    partsCost,
    partsProfit,
    discountTotal,
    totalProfit: roundPaise(labourRevenue + partsProfit - discountTotal),
    gstCollected,
    totalBilled: roundPaise(labourRevenue + partsRevenue - discountTotal + gstCollected),
    freeServiceJobCount: freeServiceJobs.length,
    freeServiceCost: roundPaise(freeServiceJobs.reduce((sum, j) => sum + j.partsCost, 0)),
    estimatedCostJobCount: jobs.filter((j) => j.costIsEstimated).length,
    jobs,
  };
}

export async function getServiceProfitReport(
  supabase: SupabaseClient<Database>,
  range: { from: Date; to: Date }
): Promise<ServiceProfitReport> {
  const { data, error } = await supabase
    .from("service_jobs")
    .select(SELECT_COLUMNS)
    .eq("status", "COMPLETED")
    .gte("completed_at", range.from.toISOString())
    .lte("completed_at", range.to.toISOString());

  if (error) throw new Error(error.message);

  return buildServiceProfitReport((data ?? []) as unknown as ServiceProfitSourceRow[]);
}
