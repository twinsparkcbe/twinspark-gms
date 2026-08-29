import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { roundPaise } from "@/services/shared/payment";
import type { Database } from "@/types/database.types";
import { IST_OFFSET_MS, MONTH_ABBR } from "@/lib/format";

/**
 * Collections Report (doc/payment-split-scope.md §8) — how much of what was
 * billed actually came in, split by tender, so the cash box can be
 * reconciled against the bank.
 *
 * Covers Sales, COMPLETED Service jobs, and DISPATCHED Online Orders
 * (doc/online-orders-revenue-scope.md §3.2). Online money lands wholly in
 * the UPI column: the customer pays through the QR on the order page before
 * the order can be submitted, so there is no cash case and nothing
 * outstanding — an online order is always settled in full by the time staff
 * see it.
 *
 * Online orders are dated by `dispatched_at`, not by when the customer paid.
 * That keeps revenue in the same period as the stock movement. The
 * trade-off, accepted deliberately: money that reached the UPI account on
 * Monday shows in Tuesday's column if the tyres go out on Tuesday.
 *
 * `unrecorded` is a deliberate, visible bucket rather than a rounding of
 * history into cash: rows written before 0027 are settled bills whose tender
 * genuinely isn't known. Folding them into cash would overstate the cash box
 * by exactly the amount most likely to be miscounted.
 */

export interface CollectionsDayRow {
  /** ISO date (YYYY-MM-DD) in IST — the shop's own calendar day. */
  date: string;
  label: string;
  cash: number;
  upi: number;
  outstanding: number;
}

export interface CollectionsReport {
  cash: number;
  upi: number;
  unrecorded: number;
  outstanding: number;
  totalBilled: number;
  days: CollectionsDayRow[];
}

type CollectionSourceRow = {
  grand_total: number | null;
  payment_status: string | null;
  payment_mode: string | null;
  cash_amount: number | null;
  upi_amount: number | null;
  at: string | null;
};

/** IST calendar day for a timestamp — the same fixed-offset approach every
 * other date helper here uses, so a bill rung up at 11pm lands on the day the
 * shop counted it, not the next UTC one. */
function istDateKey(iso: string): string {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${month}-${day}`;
}

function dayLabel(key: string): string {
  const [year, month, day] = key.split("-");
  return `${day} ${MONTH_ABBR[Number(month) - 1]} ${year}`;
}

export async function getCollectionsReport(
  supabase: SupabaseClient<Database>,
  range: { from: Date; to: Date }
): Promise<CollectionsReport> {
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const [salesRes, serviceRes, onlineRes] = await Promise.all([
    // Voided sales are corrections, not revenue (0029) — excluded from every
    // figure that adds up to money.
    supabase
      .from("sales")
      .select("grand_total, payment_status, payment_mode, cash_amount, upi_amount, sale_date")
      .is("voided_at", null)
      .gte("sale_date", fromIso)
      .lte("sale_date", toIso),
    supabase
      .from("service_jobs")
      .select("grand_total, payment_status, payment_mode, cash_amount, upi_amount, completed_at")
      .eq("status", "COMPLETED")
      .gte("completed_at", fromIso)
      .lte("completed_at", toIso),
    supabase
      .from("online_orders")
      .select("total_amount, dispatched_at")
      .eq("status", "DISPATCHED")
      .gte("dispatched_at", fromIso)
      .lte("dispatched_at", toIso),
  ]);

  if (salesRes.error) throw new Error(salesRes.error.message);
  if (serviceRes.error) throw new Error(serviceRes.error.message);
  if (onlineRes.error) throw new Error(onlineRes.error.message);

  const rows: CollectionSourceRow[] = [
    ...((salesRes.data ?? []) as Record<string, unknown>[]).map((row) => ({
      grand_total: row.grand_total as number | null,
      payment_status: row.payment_status as string | null,
      payment_mode: row.payment_mode as string | null,
      cash_amount: row.cash_amount as number | null,
      upi_amount: row.upi_amount as number | null,
      at: row.sale_date as string | null,
    })),
    ...((serviceRes.data ?? []) as Record<string, unknown>[]).map((row) => ({
      grand_total: row.grand_total as number | null,
      payment_status: row.payment_status as string | null,
      payment_mode: row.payment_mode as string | null,
      cash_amount: row.cash_amount as number | null,
      upi_amount: row.upi_amount as number | null,
      at: row.completed_at as string | null,
    })),
    // Shaped to look like a fully-paid UPI bill so it flows through the same
    // loop below rather than needing a parallel code path: payment_mode is
    // set so it is never counted as "unrecorded", and upi_amount equals the
    // total so nothing is left outstanding.
    ...((onlineRes.data ?? []) as Record<string, unknown>[]).map((row) => ({
      grand_total: row.total_amount as number | null,
      payment_status: "PAID" as string | null,
      payment_mode: "UPI" as string | null,
      cash_amount: 0 as number | null,
      upi_amount: row.total_amount as number | null,
      at: row.dispatched_at as string | null,
    })),
  ];

  const report: CollectionsReport = { cash: 0, upi: 0, unrecorded: 0, outstanding: 0, totalBilled: 0, days: [] };
  const byDay = new Map<string, CollectionsDayRow>();

  for (const row of rows) {
    // A free service is not revenue and not a debt — it never belonged in
    // any of these buckets, and counting it as outstanding would invent a
    // receivable the shop will never collect.
    if (row.payment_status === "FREE_SERVICE") continue;

    const total = Number(row.grand_total ?? 0);
    const cash = Number(row.cash_amount ?? 0);
    const upi = Number(row.upi_amount ?? 0);
    const settled = row.payment_status === "PAID";
    const unrecorded = settled && !row.payment_mode ? total : 0;
    const outstanding = Math.max(0, roundPaise(total - cash - upi - unrecorded));

    report.totalBilled = roundPaise(report.totalBilled + total);
    report.cash = roundPaise(report.cash + cash);
    report.upi = roundPaise(report.upi + upi);
    report.unrecorded = roundPaise(report.unrecorded + unrecorded);
    report.outstanding = roundPaise(report.outstanding + outstanding);

    if (!row.at) continue;
    const key = istDateKey(row.at);
    const day = byDay.get(key) ?? { date: key, label: dayLabel(key), cash: 0, upi: 0, outstanding: 0 };
    day.cash = roundPaise(day.cash + cash);
    day.upi = roundPaise(day.upi + upi);
    day.outstanding = roundPaise(day.outstanding + outstanding);
    byDay.set(key, day);
  }

  report.days = [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date));

  return report;
}
