import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

export type FollowUpReason = "SALE" | "SERVICE" | "BOTH";

export interface FollowUpCandidateRow {
  customerId: string;
  customerName: string;
  customerMobile: string;
  reason: FollowUpReason;
  lastSaleDate: string | null;
  /** What they last bought (any sale, not tyre-only — see doc/reports-scope
   * .md §5's flagged decision) so staff can tailor the call either way. */
  lastSaleItemSummary: string | null;
  lastServiceDate: string | null;
}

type EmbeddedProduct = { product_name: string } | { product_name: string }[] | null;

type SaleActivityRow = {
  customer_id: string;
  sale_date: string;
  sale_items: { line_type: string; inventory_items: EmbeddedProduct }[];
};

type ServiceActivityRow = {
  customer_id: string;
  completed_at: string | null;
};

type CustomerRow = { id: string; name: string; mobile_number: string };

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function monthsAgo(now: Date, months: number): Date {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d;
}

/** "MRF Zapper +2 more" style summary — same shape as Sales' own itemsSummary helpers. */
function summarizeSaleItems(items: SaleActivityRow["sale_items"]): string {
  const productLines = items.filter((l) => l.line_type === "PRODUCT");
  if (productLines.length === 0) return "—";
  const first = productLines[0];
  const name = firstOrSelf(first.inventory_items)?.product_name ?? "Item";
  const extra = productLines.length - 1;
  return extra > 0 ? `${name} +${extra} more` : name;
}

/** Days since an ISO date, or -Infinity when there's nothing to measure from
 * (keeps a customer with no activity of that kind from ever "winning" the
 * most-overdue sort against a real, dated gap). */
function daysSince(iso: string | null, now: Date): number {
  if (!iso) return -Infinity;
  return (now.getTime() - new Date(iso).getTime()) / 86_400_000;
}

/**
 * Every customer whose last sale and/or last *completed* service is old
 * enough to be worth a call (doc/reports-scope.md §5 — your Follow-Up/
 * leads idea). No existing function answers "every customer past a
 * threshold" — only per-customer history (listSalesForCustomer etc.) — so
 * this fetches the whole customer base plus every sale/completed-service
 * once (same "low thousands, fetch it all" call already made for the
 * Customer directory picker) and reduces to last-activity-per-customer in
 * JS, rather than adding a new Postgres aggregate function for a report
 * that doesn't need to run more than a few times a day.
 *
 * A customer with *no* sale and *no* completed service at all is excluded
 * — there's no "since" to measure, so showing them would be a false
 * positive, not a real lead.
 */
export async function listFollowUpCandidates(
  supabase: SupabaseClient<Database>,
  input: { monthsSinceSale: number; monthsSinceService: number },
  now: Date = new Date()
): Promise<FollowUpCandidateRow[]> {
  const [customersRes, salesRes, serviceRes] = await Promise.all([
    supabase.from("customers").select("id, name, mobile_number").limit(5000),
    // A voided sale must never make a customer look "recently served" — that
    // would suppress a follow-up call for a visit that never happened.
    supabase
      .from("sales")
      .select("customer_id, sale_date, sale_items(line_type, inventory_items(product_name))")
      .is("voided_at", null)
      .limit(20000),
    supabase.from("service_jobs").select("customer_id, completed_at").eq("status", "COMPLETED").limit(20000),
  ]);

  if (customersRes.error) throw new Error(customersRes.error.message);
  if (salesRes.error) throw new Error(salesRes.error.message);
  if (serviceRes.error) throw new Error(serviceRes.error.message);

  const lastSale = new Map<string, { date: string; summary: string }>();
  for (const row of (salesRes.data ?? []) as unknown as SaleActivityRow[]) {
    const existing = lastSale.get(row.customer_id);
    if (!existing || new Date(row.sale_date) > new Date(existing.date)) {
      lastSale.set(row.customer_id, { date: row.sale_date, summary: summarizeSaleItems(row.sale_items) });
    }
  }

  const lastService = new Map<string, string>();
  for (const row of (serviceRes.data ?? []) as ServiceActivityRow[]) {
    if (!row.completed_at) continue;
    const existing = lastService.get(row.customer_id);
    if (!existing || new Date(row.completed_at) > new Date(existing)) {
      lastService.set(row.customer_id, row.completed_at);
    }
  }

  const saleCutoff = monthsAgo(now, input.monthsSinceSale).getTime();
  const serviceCutoff = monthsAgo(now, input.monthsSinceService).getTime();

  const results: FollowUpCandidateRow[] = [];

  for (const customer of (customersRes.data ?? []) as CustomerRow[]) {
    const sale = lastSale.get(customer.id) ?? null;
    const serviceDate = lastService.get(customer.id) ?? null;

    const saleOverdue = sale !== null && new Date(sale.date).getTime() <= saleCutoff;
    const serviceOverdue = serviceDate !== null && new Date(serviceDate).getTime() <= serviceCutoff;

    if (!saleOverdue && !serviceOverdue) continue;

    const reason: FollowUpReason = saleOverdue && serviceOverdue ? "BOTH" : saleOverdue ? "SALE" : "SERVICE";

    results.push({
      customerId: customer.id,
      customerName: customer.name,
      customerMobile: customer.mobile_number,
      reason,
      lastSaleDate: sale?.date ?? null,
      lastSaleItemSummary: sale?.summary ?? null,
      lastServiceDate: serviceDate,
    });
  }

  // Most-overdue-first, using whichever gap (sale or service) is larger.
  return results.sort((a, b) => {
    const bGap = Math.max(daysSince(b.lastSaleDate, now), daysSince(b.lastServiceDate, now));
    const aGap = Math.max(daysSince(a.lastSaleDate, now), daysSince(a.lastServiceDate, now));
    return bGap - aGap;
  });
}
