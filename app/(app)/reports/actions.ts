"use server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { resolveDateRangePreset } from "@/services/dashboard/date-range";
import type { DateRangePreset } from "@/services/dashboard/date-range-types";
import { listInventoryItems, type InventoryItemRow } from "@/services/inventory";
import { getPurchaseStats, listPurchaseEntries, type PurchaseEntryRow, type PurchaseStats } from "@/services/purchases";
import { getSalesStats, listSales, type SaleRow, type SalesStats } from "@/services/sales";
import { getServiceStats, listServiceJobs, type ServiceJobRow, type ServiceStats } from "@/services/service";
import { getOnlineOrdersReportStats, type OnlineOrdersReportStats } from "@/services/online-orders";
import {
  getCollectionsReport,
  getGstReport,
  listAgeingStock,
  listFollowUpCandidates,
  type AgeingStockRow,
  type CollectionsReport,
  type FollowUpCandidateRow,
  type GstReport,
} from "@/services/reports";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

function toErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Every Reports action re-checks access server-side — Reports is
 * Admin-only, full stop (doc/reports-scope.md §0). */
async function reportsClient() {
  await requireAdmin();
  return createClient();
}

function resolveRange(preset: DateRangePreset, custom?: { fromYMD: string; toYMD: string }) {
  return resolveDateRangePreset(preset, new Date(), custom);
}

const REPORT_PAGE_SIZE = 50;

// --- Inventory Report -------------------------------------------------

export interface InventoryReportData {
  items: InventoryItemRow[];
  total: number;
  ageingItemIds: string[];
}

export interface InventoryReportFilters {
  search?: string;
  itemTypes?: InventoryItemRow["itemType"][];
  stockStatus?: InventoryItemRow["stockStatus"];
}

/** Ageing threshold baked into the Inventory Report's flag column — the
 * dedicated Ageing Stock report has its own adjustable threshold; this one
 * stays fixed so the Inventory Report doesn't need a second control. */
const INVENTORY_REPORT_AGEING_MONTHS = 6;

export async function fetchInventoryReportAction(filters: InventoryReportFilters): Promise<ActionResult<InventoryReportData>> {
  try {
    const supabase = await reportsClient();
    const [{ items, total }, ageingRows] = await Promise.all([
      listInventoryItems(supabase, { ...filters, page: 1, pageSize: 200 }),
      listAgeingStock(supabase, INVENTORY_REPORT_AGEING_MONTHS),
    ]);
    return {
      success: true,
      data: { items, total, ageingItemIds: ageingRows.map((r) => r.inventoryItemId) },
    };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load the Inventory Report.") };
  }
}

// --- Collections Report (doc/payment-split-scope.md §8) ------------------

export async function fetchCollectionsReportAction(
  preset: DateRangePreset,
  custom?: { fromYMD: string; toYMD: string }
): Promise<ActionResult<CollectionsReport>> {
  try {
    const supabase = await reportsClient();
    const { from, to } = resolveRange(preset, custom);
    const data = await getCollectionsReport(supabase, { from, to });
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load the Collections Report.") };
  }
}

// --- GST Report (doc/reports-scope.md addendum) ---------------------------

export async function fetchGstReportAction(
  preset: DateRangePreset,
  custom?: { fromYMD: string; toYMD: string }
): Promise<ActionResult<GstReport>> {
  try {
    const supabase = await reportsClient();
    const { from, to } = resolveRange(preset, custom);
    const data = await getGstReport(supabase, { from, to });
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load the GST Report.") };
  }
}

// --- Purchase Report ---------------------------------------------------

export interface PurchaseReportData {
  entries: PurchaseEntryRow[];
  total: number;
  stats: PurchaseStats;
}

export async function fetchPurchaseReportAction(
  preset: DateRangePreset,
  custom?: { fromYMD: string; toYMD: string }
): Promise<ActionResult<PurchaseReportData>> {
  try {
    const supabase = await reportsClient();
    const { from, to } = resolveRange(preset, custom);
    const [{ entries, total }, stats] = await Promise.all([
      listPurchaseEntries(supabase, { dateFrom: from, dateTo: to, page: 1, pageSize: REPORT_PAGE_SIZE }),
      getPurchaseStats(supabase, { from, to }),
    ]);
    return { success: true, data: { entries, total, stats } };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load the Purchase Report.") };
  }
}

// --- Sales Report --------------------------------------------------------

export interface SalesReportData {
  sales: SaleRow[];
  total: number;
  stats: SalesStats;
}

export async function fetchSalesReportAction(
  preset: DateRangePreset,
  custom?: { fromYMD: string; toYMD: string }
): Promise<ActionResult<SalesReportData>> {
  try {
    const supabase = await reportsClient();
    const { from, to } = resolveRange(preset, custom);
    const [{ sales, total }, stats] = await Promise.all([
      listSales(supabase, { dateFrom: from, dateTo: to, page: 1, pageSize: REPORT_PAGE_SIZE }),
      getSalesStats(supabase, { from, to }),
    ]);
    return { success: true, data: { sales, total, stats } };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load the Sales Report.") };
  }
}

// --- Service Report ------------------------------------------------------

export interface ServiceReportData {
  jobs: ServiceJobRow[];
  total: number;
  stats: ServiceStats;
}

export async function fetchServiceReportAction(
  preset: DateRangePreset,
  custom?: { fromYMD: string; toYMD: string }
): Promise<ActionResult<ServiceReportData>> {
  try {
    const supabase = await reportsClient();
    const { from, to } = resolveRange(preset, custom);
    const [{ jobs, total }, stats] = await Promise.all([
      listServiceJobs(supabase, { dateFrom: from, dateTo: to, page: 1, pageSize: REPORT_PAGE_SIZE }),
      getServiceStats(supabase, { from, to }),
    ]);
    return { success: true, data: { jobs, total, stats } };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load the Service Report.") };
  }
}

// --- Online Orders Report -------------------------------------------------

export async function fetchOnlineOrdersReportAction(
  preset: DateRangePreset,
  custom?: { fromYMD: string; toYMD: string }
): Promise<ActionResult<OnlineOrdersReportStats>> {
  try {
    const supabase = await reportsClient();
    const { from, to } = resolveRange(preset, custom);
    const data = await getOnlineOrdersReportStats(supabase, { from, to });
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load the Online Orders Report.") };
  }
}

// --- Ageing Stock Report ---------------------------------------------------

export async function fetchAgeingStockAction(monthsThreshold: number): Promise<ActionResult<AgeingStockRow[]>> {
  try {
    const supabase = await reportsClient();
    const data = await listAgeingStock(supabase, monthsThreshold);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load the Ageing Stock Report.") };
  }
}

// --- Customer Follow-Up Report --------------------------------------------

export async function fetchFollowUpCandidatesAction(input: {
  monthsSinceSale: number;
  monthsSinceService: number;
}): Promise<ActionResult<FollowUpCandidateRow[]>> {
  try {
    const supabase = await reportsClient();
    const data = await listFollowUpCandidates(supabase, input);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load the Customer Follow-Up Report.") };
  }
}
