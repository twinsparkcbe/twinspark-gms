import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { InsufficientStockError } from "@/services/shared/stock";
import type { Database, OnlineOrderStatus } from "@/types/database.types";

import {
  onlineOrderFiltersSchema,
  rejectOnlineOrderInputSchema,
  submitOnlineOrderInputSchema,
  type OnlineOrderFilters,
  type RejectOnlineOrderInput,
  type SubmitOnlineOrderInput,
} from "./schemas";

const SCREENSHOT_BUCKET = "online-order-screenshots";
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Raised whenever a workflow action (verify/approve/dispatch/reject) hits
 * DB error code P0002 — the order either doesn't exist, or isn't in the
 * state that action requires (e.g. Approve on a not-yet-verified order).
 * The Postgres function's own message already distinguishes the two, so
 * it's surfaced as-is rather than split into separate error classes. */
export class OnlineOrderTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnlineOrderTransitionError";
  }
}

export class OnlineOrderAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnlineOrderAuthError";
  }
}

export class OnlineOrderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnlineOrderValidationError";
  }
}

export class InvalidScreenshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidScreenshotError";
  }
}

export interface OnlineOrderRow {
  id: string;
  customerName: string;
  mobileNumber: string;
  address: string;
  pinCode: string;
  quantityFront: number;
  quantityBack: number;
  paymentScreenshotPath: string;
  /** Snapshot of the item's selling_price at submission time (server-side,
   * never client-supplied — see submit_online_order() in
   * 0019_online_orders_pricing.sql). Null when that position wasn't ordered
   * (quantity 0) or no active item existed yet at submission time. */
  unitPriceFront: number | null;
  unitPriceBack: number | null;
  /** quantityFront * unitPriceFront + quantityBack * unitPriceBack, computed
   * and stored server-side at submission — never client-supplied. This is
   * the catalogue value of the order, the reference figure staff compare
   * against (0036_online_order_amount_override.sql). */
  computedAmount: number;
  /** What the customer will actually pay: the amount they were quoted when
   * they entered one, otherwise computedAmount. */
  totalAmount: number;
  /** True when the two differ — surfaced at Verify Payment so a quoted
   * price is checked by a human rather than passing silently. */
  amountIsOverridden: boolean;
  status: OnlineOrderStatus;
  rejectionReason: string | null;
  submittedAt: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  dispatchedBy: string | null;
  dispatchedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  createdAt: string;
}

type OnlineOrderDbRow = {
  id: string;
  customer_name: string;
  mobile_number: string;
  address: string;
  pin_code: string;
  quantity_front: number;
  quantity_back: number;
  payment_screenshot_path: string;
  unit_price_front: number | null;
  unit_price_back: number | null;
  computed_amount: number;
  total_amount: number;
  amount_is_overridden: boolean;
  status: OnlineOrderStatus;
  rejection_reason: string | null;
  submitted_at: string;
  verified_by: string | null;
  verified_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  dispatched_by: string | null;
  dispatched_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  created_at: string;
};

const SELECT_COLUMNS =
  "id, customer_name, mobile_number, address, pin_code, quantity_front, quantity_back, payment_screenshot_path, unit_price_front, unit_price_back, computed_amount, total_amount, amount_is_overridden, status, rejection_reason, submitted_at, verified_by, verified_at, approved_by, approved_at, dispatched_by, dispatched_at, rejected_by, rejected_at, created_at";

function mapOnlineOrder(row: OnlineOrderDbRow): OnlineOrderRow {
  return {
    id: row.id,
    customerName: row.customer_name,
    mobileNumber: row.mobile_number,
    address: row.address,
    pinCode: row.pin_code,
    quantityFront: row.quantity_front,
    quantityBack: row.quantity_back,
    paymentScreenshotPath: row.payment_screenshot_path,
    unitPriceFront: row.unit_price_front !== null ? Number(row.unit_price_front) : null,
    unitPriceBack: row.unit_price_back !== null ? Number(row.unit_price_back) : null,
    computedAmount: Number(row.computed_amount),
    totalAmount: Number(row.total_amount),
    amountIsOverridden: row.amount_is_overridden,
    status: row.status,
    rejectionReason: row.rejection_reason,
    submittedAt: row.submitted_at,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    dispatchedBy: row.dispatched_by,
    dispatchedAt: row.dispatched_at,
    rejectedBy: row.rejected_by,
    rejectedAt: row.rejected_at,
    createdAt: row.created_at,
  };
}

/**
 * Uploads a payment screenshot to the private `online-order-screenshots`
 * bucket and returns its storage *path* (not a public URL — the bucket has
 * no public read, see 0018_online_orders_schema.sql §5). Called from the
 * public order form before submitOnlineOrder(), same two-step shape as
 * uploadInventoryItemImage() in services/inventory/items.ts.
 */
export async function uploadPaymentScreenshot(
  supabase: SupabaseClient<Database>,
  file: File
): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new InvalidScreenshotError("Only PNG, JPEG, or WEBP images are allowed.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new InvalidScreenshotError("Image must be 5MB or smaller.");
  }

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage.from(SCREENSHOT_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(error.message);

  return path;
}

/**
 * Signed, time-limited URL for viewing a payment screenshot — the bucket
 * isn't public (§5 above), so staff need this rather than a direct public
 * URL. Defaults to 5 minutes, long enough to open the Verify Payment dialog
 * without leaving a long-lived link lying around in the DOM/network log.
 */
export async function getPaymentScreenshotSignedUrl(
  supabase: SupabaseClient<Database>,
  path: string,
  expiresInSeconds = 300
): Promise<string> {
  const { data, error } = await supabase.storage.from(SCREENSHOT_BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error) throw new Error(error.message);
  if (!data?.signedUrl) throw new Error("Failed to generate a signed URL for this screenshot.");
  return data.signedUrl;
}

export interface TrackTyrePrices {
  front: number | null;
  back: number | null;
}

/**
 * Public, read-only current selling price for Track Tyre Front/Back — the
 * order form calls this to show "how much am I about to pay" before
 * submitting (0019_online_orders_pricing.sql's get_track_tyre_prices()).
 * Deliberately callable by an anonymous visitor: it only ever exposes these
 * two prices, never the rest of the inventory catalog (inventory_items
 * itself has no anon read policy). A position with no active item yet
 * comes back null, not an error — the form just shows "price unavailable".
 */
export async function getTrackTyrePrices(supabase: SupabaseClient<Database>): Promise<TrackTyrePrices> {
  const { data, error } = await supabase.rpc("get_track_tyre_prices");
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { product_name: string; selling_price: number }[];
  const front = rows.find((r) => r.product_name === "Track Tyre - Front")?.selling_price;
  const back = rows.find((r) => r.product_name === "Track Tyre - Back")?.selling_price;

  return {
    front: front !== undefined ? Number(front) : null,
    back: back !== undefined ? Number(back) : null,
  };
}

/**
 * The only way a new order gets created — calls submit_online_order()
 * (0018_online_orders_schema.sql), callable by an anonymous visitor. Returns
 * just the new order id; the public form has no read access to this table
 * (doc/online-orders-scope.md §4), so there's no follow-up fetch here.
 */
export async function submitOnlineOrder(
  supabase: SupabaseClient<Database>,
  rawInput: SubmitOnlineOrderInput
): Promise<string> {
  const input = submitOnlineOrderInputSchema.parse(rawInput);

  const { data, error } = await supabase.rpc("submit_online_order", {
    p_customer_name: input.customerName,
    p_mobile_number: input.mobileNumber,
    p_address: input.address,
    p_pin_code: input.pinCode,
    p_quantity_front: input.quantityFront,
    p_quantity_back: input.quantityBack,
    p_payment_screenshot_path: input.paymentScreenshotPath,
    // Omitted (null) means "use the catalogue price" — submit_online_order()
    // computes and stores that itself either way.
    p_quoted_amount: input.quotedAmount ?? null,
  });

  if (error) {
    if (error.code === "22023") {
      throw new OnlineOrderValidationError(error.message);
    }
    throw new Error(error.message);
  }
  if (typeof data !== "string") {
    throw new Error("Unexpected response from submit_online_order.");
  }

  return data;
}

async function applyFilters<T>(
  query: T,
  filters: Pick<OnlineOrderFilters, "search" | "statuses" | "dateFrom" | "dateTo">
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = query as any;

  if (filters.search) {
    const term = filters.search.replace(/[,()%]/g, " ").trim();
    if (term) {
      q = q.or(`customer_name.ilike.%${term}%,mobile_number.ilike.%${term}%`);
    }
  }
  if (filters.statuses && filters.statuses.length > 0) {
    q = q.in("status", filters.statuses);
  }
  if (filters.dateFrom) q = q.gte("submitted_at", filters.dateFrom.toISOString());
  if (filters.dateTo) q = q.lte("submitted_at", filters.dateTo.toISOString());

  return q as T;
}

function applySort<T>(query: T, sortBy: OnlineOrderFilters["sortBy"] | undefined): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = query as any;
  return q.order("submitted_at", { ascending: sortBy === "oldest" }) as T;
}

export async function listOnlineOrders(
  supabase: SupabaseClient<Database>,
  rawFilters: OnlineOrderFilters
): Promise<{ orders: OnlineOrderRow[]; total: number }> {
  const filters = onlineOrderFiltersSchema.parse(rawFilters);
  const from = (filters.page - 1) * filters.pageSize;
  const to = from + filters.pageSize - 1;

  const baseQuery = applySort(
    supabase.from("online_orders").select(SELECT_COLUMNS, { count: "exact" }),
    filters.sortBy
  ).range(from, to);

  const filteredQuery = await applyFilters(baseQuery, filters);
  const { data, error, count } = await filteredQuery;
  if (error) throw new Error(error.message);

  return {
    orders: ((data ?? []) as unknown as OnlineOrderDbRow[]).map(mapOnlineOrder),
    total: count ?? 0,
  };
}

/** Powers Courier Label Export — fetches the exact set of orders the staff
 * selected from the queue, in no particular guaranteed order (the labels
 * view sorts/renders them as selected). */
export async function listOnlineOrdersByIds(
  supabase: SupabaseClient<Database>,
  ids: string[]
): Promise<OnlineOrderRow[]> {
  if (ids.length === 0) return [];

  const { data, error } = await supabase.from("online_orders").select(SELECT_COLUMNS).in("id", ids);
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as OnlineOrderDbRow[]).map(mapOnlineOrder);
}

export interface OnlineOrderStats {
  /** Awaiting a staff member to check the uploaded screenshot. */
  submittedCount: number;
  /** Payment confirmed, awaiting Approve. */
  paymentVerifiedCount: number;
  /** Approved, awaiting Dispatch (and the stock decrement that comes with it). */
  approvedCount: number;
  /** Dispatched so far this calendar month. */
  dispatchedThisMonthCount: number;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

async function countByStatus(supabase: SupabaseClient<Database>, status: OnlineOrderStatus): Promise<number> {
  const { count, error } = await supabase
    .from("online_orders")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Queue-depth stats for the Online Orders page's stat cards — these are
 * current snapshot counts (how many orders need attention *right now*),
 * not a date-ranged revenue aggregate like Sales/Purchases' "this month"
 * totals (total_amount is shown per-row in the table instead — see
 * OnlineOrderRow.totalAmount, added in 0019_online_orders_pricing.sql).
 * Dispatched-this-month is the one exception, included as a simple
 * throughput indicator. */
export async function getOnlineOrderStats(supabase: SupabaseClient<Database>): Promise<OnlineOrderStats> {
  const [submittedCount, paymentVerifiedCount, approvedCount, dispatchedThisMonthCount] = await Promise.all([
    countByStatus(supabase, "SUBMITTED"),
    countByStatus(supabase, "PAYMENT_VERIFIED"),
    countByStatus(supabase, "APPROVED"),
    (async () => {
      const { count, error } = await supabase
        .from("online_orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "DISPATCHED")
        .gte("dispatched_at", startOfMonth(new Date()).toISOString());
      if (error) throw new Error(error.message);
      return count ?? 0;
    })(),
  ]);

  return { submittedCount, paymentVerifiedCount, approvedCount, dispatchedThisMonthCount };
}

export interface OnlineOrdersReportStats {
  /** Orders submitted in the range (created_at) — every status, not just currently-pending ones. */
  submittedCount: number;
  /** Orders dispatched in the range (dispatched_at). */
  dispatchedCount: number;
  /** Sum of total_amount for orders dispatched in the range — i.e. what was
   * actually charged, including any quoted price the customer entered
   * (confirmed 2026-08-27), not the catalogue value. Reconciles against
   * money received; use computed_amount if you ever need list value. */
  dispatchedAmount: number;
  /** Orders rejected in the range (rejected_at). */
  rejectedCount: number;
}

/**
 * Date-ranged version for the Online Orders Report (doc/reports-scope.md
 * §9) — deliberately a *separate* function from `getOnlineOrderStats`
 * above, not an optional-range extension of it. That function's counts are
 * live queue-depth snapshots ("how many orders need attention right now,"
 * status-only, no date filter) — bolting a date range onto
 * `submittedCount`/`paymentVerifiedCount`/`approvedCount` there would
 * silently change what those numbers mean on the live Online Orders page.
 * This one answers the Report's actual question instead: how many orders
 * moved through the channel *in this period*, keyed off each event's own
 * timestamp (`created_at`, `dispatched_at`, `rejected_at`).
 */
export async function getOnlineOrdersReportStats(
  supabase: SupabaseClient<Database>,
  range: { from: Date; to: Date }
): Promise<OnlineOrdersReportStats> {
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const [submittedRes, dispatchedRes, rejectedRes] = await Promise.all([
    supabase.from("online_orders").select("id", { count: "exact", head: true }).gte("created_at", fromIso).lte("created_at", toIso),
    supabase
      .from("online_orders")
      .select("total_amount")
      .eq("status", "DISPATCHED")
      .gte("dispatched_at", fromIso)
      .lte("dispatched_at", toIso),
    supabase
      .from("online_orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "REJECTED")
      .gte("rejected_at", fromIso)
      .lte("rejected_at", toIso),
  ]);

  if (submittedRes.error) throw new Error(submittedRes.error.message);
  if (dispatchedRes.error) throw new Error(dispatchedRes.error.message);
  if (rejectedRes.error) throw new Error(rejectedRes.error.message);

  const dispatchedRows = (dispatchedRes.data ?? []) as { total_amount: number }[];

  return {
    submittedCount: submittedRes.count ?? 0,
    dispatchedCount: dispatchedRows.length,
    dispatchedAmount: dispatchedRows.reduce((sum, row) => sum + Number(row.total_amount), 0),
    rejectedCount: rejectedRes.count ?? 0,
  };
}

function mapTransitionError(error: { code?: string; message: string }): never {
  if (error.code === "P0002") {
    throw new OnlineOrderTransitionError(error.message);
  }
  // Dispatch-only in practice (adjust_stock's FIFO guard, bubbled straight
  // through dispatch_online_order) — verify/approve/reject never touch
  // stock, but mapping it here too keeps one shared error mapper instead of
  // a near-duplicate for dispatch alone.
  if (error.code === "P0001") {
    throw new InsufficientStockError(
      "Not enough Track Tyre stock to dispatch this order. Restock, or reject the order instead."
    );
  }
  if (error.code === "42501") {
    throw new OnlineOrderAuthError("You don't have permission to do that.");
  }
  if (error.code === "22023") {
    throw new OnlineOrderValidationError(error.message);
  }
  throw new Error(error.message);
}

export async function verifyOnlineOrderPayment(supabase: SupabaseClient<Database>, orderId: string): Promise<void> {
  const { error } = await supabase.rpc("verify_online_order_payment", { p_order_id: orderId });
  if (error) mapTransitionError(error);
}

export async function approveOnlineOrder(supabase: SupabaseClient<Database>, orderId: string): Promise<void> {
  const { error } = await supabase.rpc("approve_online_order", { p_order_id: orderId });
  if (error) mapTransitionError(error);
}

export async function dispatchOnlineOrder(supabase: SupabaseClient<Database>, orderId: string): Promise<void> {
  const { error } = await supabase.rpc("dispatch_online_order", { p_order_id: orderId });
  if (error) mapTransitionError(error);
}

export async function rejectOnlineOrder(
  supabase: SupabaseClient<Database>,
  rawInput: RejectOnlineOrderInput
): Promise<void> {
  const input = rejectOnlineOrderInputSchema.parse(rawInput);
  const { error } = await supabase.rpc("reject_online_order", {
    p_order_id: input.orderId,
    p_reason: input.reason,
  });
  if (error) mapTransitionError(error);
}
