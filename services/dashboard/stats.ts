import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getPurchaseStats } from "@/services/purchases";
import { getCollectionsReport } from "@/services/reports";
import { getOnlineRevenue } from "@/services/online-orders";
import { getSalesStats } from "@/services/sales";
import { getServiceStats } from "@/services/service";
import { mapRow, SELECT_COLUMNS, type InventoryItemJoinedRow, type InventoryItemRow } from "@/services/inventory/items";
import type { Database, OnlineOrderStatus, ServiceJobStatus } from "@/types/database.types";

import { getCostOfGoodsSold } from "./cogs";
import { resolveDateRangePreset } from "./date-range";
import type { DashboardDateRange, DateRangePreset } from "./date-range-types";
import { resolvePreviousPeriod } from "./previous-period";

/**
 * Track Tyre stock is shown as two independent numbers (Front/Back), not one
 * combined count — they're separate `inventory_items` rows with independent
 * stock (doc/track-tyre-front-back-split-scope.md). `null` means that
 * position has no active item to report on (deleted/deactivated), which the
 * UI renders as "—" rather than 0 (doc/dashboard-scope.md §6).
 */
export interface TrackTyreStock {
  front: number | null;
  back: number | null;
}

export async function getTrackTyreStock(supabase: SupabaseClient<Database>): Promise<TrackTyreStock> {
  const { data, error } = await supabase
    .from("inventory_items")
    .select("product_name, available_quantity")
    .eq("is_active", true)
    .in("product_name", ["Track Tyre - Front", "Track Tyre - Back"]);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { product_name: string; available_quantity: number }[];
  const front = rows.find((r) => r.product_name === "Track Tyre - Front");
  const back = rows.find((r) => r.product_name === "Track Tyre - Back");

  return {
    front: front ? front.available_quantity : null,
    back: back ? back.available_quantity : null,
  };
}

/**
 * The same three money figures, recomputed over the comparison window, so the
 * UI can render a "vs previous period" delta. Deliberately does NOT include a
 * sale count — the money delta on the hero card already conveys the trend, and
 * a second count delta beside it was noise (doc/dashboard-redesign-scope.md §3d).
 */
export interface PreviousPeriodStats {
  salesAmount: number;
  serviceAmount: number;
  onlineAmount: number;
  purchaseAmount: number;
  profit: number;
}

export interface DashboardStats {
  trackTyreStock: TrackTyreStock;
  /** Count of sales in the selected range — the spec's ambiguous "Total
   * Sales" resolved as a count, with the ₹ figure living in salesAmount
   * instead (doc §1 decision point). */
  totalSalesCount: number;
  /** Aggregate purchase total for the selected range — how much was spent
   * restocking, a cash-outlay figure. Deliberately NOT what Profit is
   * computed from (see costOfGoodsSold) — most of a given month's purchases
   * sit on the shelf, unsold, until a later period. */
  purchaseAmount: number;
  /** Aggregate sales total for the selected range — also stands in for the
   * spec's separate "Current Month Revenue" card (doc §1 decision point). */
  salesAmount: number;
  /** Gross revenue across COMPLETED Service Jobs in the selected range
   * (getServiceStats().grossCompletedRevenue) — Dashboard Profit folds this
   * in alongside Sales Amount (doc/dashboard-redesign-scope.md addendum), so
   * a garage that runs mostly on service work isn't shown a permanently
   * understated Profit. */
  serviceAmount: number;
  /** What the online channel earned in the selected range — the total
   * charged on orders DISPATCHED in it (doc/online-orders-revenue-scope.md
   * §3.1). Deliberately its own figure rather than folded into salesAmount:
   * "Sales" means the Sales module everywhere in this app, so salesAmount
   * still reconciles exactly against the Sales Report. */
  onlineAmount: number;
  /** How many orders that was. */
  onlineOrderCount: number;
  /** FIFO cost of the units sold through Sales, the parts consumed by
   * completed Service Jobs, *and* the tyres shipped on online orders in the
   * selected range (see getCostOfGoodsSold) — what Profit is really computed
   * from. */
  costOfGoodsSold: number;
  /** (salesAmount + serviceAmount + onlineAmount) - costOfGoodsSold — profit on what was
   * actually sold/serviced this range, not "revenue minus whatever was
   * bought this range" (that conflated restocking cash-outlay with cost of
   * goods sold, and could read as a loss in a big-restock month even on a
   * profitable one). Can be negative — shown as-is, never floored at zero
   * (doc §6 edge case). */
  profit: number;
  /** How much actually came in as cash in the selected range, across Sales +
   * COMPLETED Service Jobs (getCollectionsReport().cash,
   * services/reports/collections.ts) — reuses the Collections Report's own
   * tender-split logic rather than re-deriving it, so the Dashboard and the
   * full report can never disagree on what counts as "cash." Excludes voided
   * sales and FREE_SERVICE jobs, same as every other money figure here. */
  cashCollected: number;
  /** Same tender-split, UPI side (getCollectionsReport().upi) — which now
   * also carries every dispatched online order, since an online customer
   * always pays through the QR before the order is submitted. */
  upiCollected: number;
  /** Same figures over the comparison window (see resolvePreviousPeriod). */
  previous: PreviousPeriodStats;
}

/**
 * Composes the Sales/Purchases/Service modules' own stats functions plus
 * Track Tyre stock, Cost of Goods Sold, and the Collections Report's
 * cash/UPI split — no aggregation logic is re-derived here, this is purely a
 * read-only rollup for the Dashboard's stat cards (doc/dashboard-scope.md,
 * doc/dashboard-redesign-scope.md addendum).
 *
 * `preset` defaults to "today" — the Dashboard is a daily glance-and-go
 * screen (doc/dashboard-scope.md's own framing: "one screen I can glance at
 * each morning") — and, unless an explicit `range` is passed, resolves it
 * (IST-aware) into the window every period-based call below shares —
 * guaranteeing Sales, Purchases, Service, and Cost of Goods Sold are
 * computed over the *exact* same instants rather than each defaulting
 * independently a few milliseconds apart. The preset is also what decides how
 * far back the comparison window sits, which is why it's passed alongside the
 * range rather than inferred from it.
 *
 * Track Tyre Stock is always a live snapshot and ignores the range entirely —
 * stock isn't a period-based figure.
 */
export async function getDashboardStats(
  supabase: SupabaseClient<Database>,
  options: { preset?: DateRangePreset; range?: DashboardDateRange } = {}
): Promise<DashboardStats> {
  const preset = options.preset ?? "today";
  const resolvedRange = options.range ?? resolveDateRangePreset(preset);
  const previousRange = resolvePreviousPeriod(preset, resolvedRange);

  const [
    salesStats,
    purchaseStats,
    serviceStats,
    trackTyreStock,
    costOfGoodsSold,
    collections,
    onlineRevenue,
    prevSales,
    prevPurchases,
    prevService,
    prevOnline,
    prevCogs,
  ] = await Promise.all([
    getSalesStats(supabase, resolvedRange),
    getPurchaseStats(supabase, resolvedRange),
    getServiceStats(supabase, resolvedRange),
    getTrackTyreStock(supabase),
    getCostOfGoodsSold(supabase, resolvedRange),
    getCollectionsReport(supabase, resolvedRange),
    getOnlineRevenue(supabase, resolvedRange),
    getSalesStats(supabase, previousRange),
    getPurchaseStats(supabase, previousRange),
    getServiceStats(supabase, previousRange),
    getOnlineRevenue(supabase, previousRange),
    getCostOfGoodsSold(supabase, previousRange),
  ]);

  return {
    trackTyreStock,
    totalSalesCount: salesStats.saleCount,
    purchaseAmount: purchaseStats.totalPurchaseAmount,
    salesAmount: salesStats.totalSalesAmount,
    serviceAmount: serviceStats.grossCompletedRevenue,
    onlineAmount: onlineRevenue.amount,
    onlineOrderCount: onlineRevenue.orderCount,
    costOfGoodsSold,
    profit:
      salesStats.totalSalesAmount + serviceStats.grossCompletedRevenue + onlineRevenue.amount - costOfGoodsSold,
    cashCollected: collections.cash,
    upiCollected: collections.upi,
    previous: {
      salesAmount: prevSales.totalSalesAmount,
      serviceAmount: prevService.grossCompletedRevenue,
      onlineAmount: prevOnline.amount,
      purchaseAmount: prevPurchases.totalPurchaseAmount,
      profit:
        prevSales.totalSalesAmount + prevService.grossCompletedRevenue + prevOnline.amount - prevCogs,
    },
  };
}

export interface StockAlertGroup {
  /** Capped to the preview limit, lowest quantity first. */
  items: InventoryItemRow[];
  /** Full count, uncapped — powers "+N more" and the section headline. */
  totalCount: number;
}

/**
 * Out-of-stock and low-stock are returned as separate groups, not one merged
 * list. Merged, an item sitting at 0 looked identical to one sitting at 2,
 * which buried the only genuinely urgent case (doc/dashboard-redesign-scope.md
 * §3e). Each group is queried independently rather than partitioned from one
 * combined list, because a combined list capped at N could be filled entirely
 * by one status and silently hide the other.
 */
export interface StockAlerts {
  outOfStock: StockAlertGroup;
  lowStock: StockAlertGroup;
}

const DEFAULT_STOCK_ALERT_LIMIT = 5;

async function getStockAlertGroup(
  supabase: SupabaseClient<Database>,
  status: "low_stock" | "out_of_stock",
  limit: number
): Promise<StockAlertGroup> {
  const [listRes, countRes] = await Promise.all([
    supabase
      .from("inventory_items")
      .select(SELECT_COLUMNS)
      .eq("is_active", true)
      .eq("stock_status", status)
      .order("available_quantity", { ascending: true })
      .limit(limit),
    supabase
      .from("inventory_items")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .eq("stock_status", status),
  ]);

  if (listRes.error) throw new Error(listRes.error.message);
  if (countRes.error) throw new Error(countRes.error.message);

  return {
    items: ((listRes.data ?? []) as unknown as InventoryItemJoinedRow[]).map(mapRow),
    totalCount: countRes.count ?? 0,
  };
}

export async function getStockAlerts(
  supabase: SupabaseClient<Database>,
  limit: number = DEFAULT_STOCK_ALERT_LIMIT
): Promise<StockAlerts> {
  const [outOfStock, lowStock] = await Promise.all([
    getStockAlertGroup(supabase, "out_of_stock", limit),
    getStockAlertGroup(supabase, "low_stock", limit),
  ]);

  return { outOfStock, lowStock };
}

/**
 * Work sitting in the owner's queue right now. Deliberately NOT filtered by
 * the Dashboard's date range — "what's waiting on me" is a live question, and
 * an order submitted last month is still undispatched today
 * (doc/dashboard-redesign-scope.md §3e).
 */
export interface OpenWorkCounts {
  /** Online orders not yet dispatched and not rejected. Stock hasn't left for
   * any of these — it only decrements on dispatch (business rule §15). */
  ordersToDispatch: number;
  /** Service jobs not yet completed and not cancelled. */
  openServiceJobs: number;
}

const PENDING_DISPATCH_STATUSES: OnlineOrderStatus[] = ["SUBMITTED", "PAYMENT_VERIFIED", "APPROVED"];
const OPEN_SERVICE_STATUSES: ServiceJobStatus[] = ["DRAFT", "IN_PROGRESS", "READY_FOR_DELIVERY"];

export async function getOpenWorkCounts(supabase: SupabaseClient<Database>): Promise<OpenWorkCounts> {
  const [ordersRes, jobsRes] = await Promise.all([
    supabase
      .from("online_orders")
      .select("id", { count: "exact", head: true })
      .in("status", PENDING_DISPATCH_STATUSES),
    supabase
      .from("service_jobs")
      .select("id", { count: "exact", head: true })
      .in("status", OPEN_SERVICE_STATUSES),
  ]);

  if (ordersRes.error) throw new Error(ordersRes.error.message);
  if (jobsRes.error) throw new Error(jobsRes.error.message);

  return {
    ordersToDispatch: ordersRes.count ?? 0,
    openServiceJobs: jobsRes.count ?? 0,
  };
}
