"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireOnlineOrdersAccess } from "@/lib/auth/require-online-orders-access";
import { createClient } from "@/lib/supabase/server";
import {
  approveOnlineOrder,
  dispatchOnlineOrder,
  getOnlineOrderStats,
  getPaymentScreenshotSignedUrl,
  listOnlineOrders,
  listOnlineOrdersByIds,
  rejectOnlineOrder,
  verifyOnlineOrderPayment,
  type OnlineOrderFilters,
  type OnlineOrderRow,
  type OnlineOrderStats,
  type RejectOnlineOrderInput,
} from "@/services/online-orders";
import type { Database } from "@/types/database.types";

type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

/** Result of a bulk Approve/Dispatch — each selected order is processed
 * independently (its own RPC call/transaction), so one order in the wrong
 * state or out of stock doesn't block the rest of the batch. `failed`
 * carries per-order reasons so the UI can report exactly which orders
 * still need attention instead of a single opaque "some failed" message. */
export interface BulkOnlineOrderActionResult {
  succeededCount: number;
  failed: { orderId: string; error: string }[];
}

function toErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Every action re-checks access server-side — never trust the client.
 * Online Orders is a Sales-tier module: both Administrator and Sales
 * Person get full workflow access (doc/online-orders-scope.md §5). */
async function ordersClient() {
  await requireOnlineOrdersAccess();
  return createClient();
}

function revalidateBoth() {
  revalidatePath("/online-orders");
  revalidatePath("/inventory"); // stock changes on Dispatch
}

export async function fetchOnlineOrdersAction(
  filters: OnlineOrderFilters
): Promise<ActionResult<{ orders: OnlineOrderRow[]; total: number }>> {
  try {
    const supabase = await ordersClient();
    const data = await listOnlineOrders(supabase, filters);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load online orders.") };
  }
}

export async function fetchOnlineOrdersByIdsAction(ids: string[]): Promise<ActionResult<OnlineOrderRow[]>> {
  try {
    const supabase = await ordersClient();
    const data = await listOnlineOrdersByIds(supabase, ids);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load selected orders.") };
  }
}

export async function fetchOnlineOrderStatsAction(): Promise<ActionResult<OnlineOrderStats>> {
  try {
    const supabase = await ordersClient();
    const data = await getOnlineOrderStats(supabase);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load stats.") };
  }
}

// Bucket is private (0018_online_orders_schema.sql §5) — staff need a
// signed URL to view a payment screenshot, no public URL exists.
export async function fetchScreenshotSignedUrlAction(path: string): Promise<ActionResult<string>> {
  try {
    const supabase = await ordersClient();
    const data = await getPaymentScreenshotSignedUrl(supabase, path);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load the screenshot.") };
  }
}

export async function verifyOnlineOrderPaymentAction(orderId: string): Promise<ActionResult<undefined>> {
  try {
    const supabase = await ordersClient();
    await verifyOnlineOrderPayment(supabase, orderId);
    revalidatePath("/online-orders");
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to verify payment.") };
  }
}

export async function approveOnlineOrderAction(orderId: string): Promise<ActionResult<undefined>> {
  try {
    const supabase = await ordersClient();
    await approveOnlineOrder(supabase, orderId);
    revalidatePath("/online-orders");
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to approve order.") };
  }
}

// The only action that touches stock — revalidates Inventory too.
export async function dispatchOnlineOrderAction(orderId: string): Promise<ActionResult<undefined>> {
  try {
    const supabase = await ordersClient();
    await dispatchOnlineOrder(supabase, orderId);
    revalidateBoth();
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to dispatch order.") };
  }
}

export async function rejectOnlineOrderAction(input: RejectOnlineOrderInput): Promise<ActionResult<undefined>> {
  try {
    const supabase = await ordersClient();
    await rejectOnlineOrder(supabase, input);
    revalidatePath("/online-orders");
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to reject order.") };
  }
}

/** Runs `action` once per order id, sequentially, on a single authenticated
 * client — each call is its own independent RPC transaction, so a failure
 * on one order (wrong status, insufficient stock) never rolls back or
 * blocks the others. */
async function runBulkAction(
  orderIds: string[],
  action: (supabase: SupabaseClient<Database>, orderId: string) => Promise<void>
): Promise<BulkOnlineOrderActionResult> {
  const supabase = await ordersClient();
  const failed: { orderId: string; error: string }[] = [];
  let succeededCount = 0;

  for (const orderId of orderIds) {
    try {
      await action(supabase, orderId);
      succeededCount += 1;
    } catch (err) {
      failed.push({ orderId, error: toErrorMessage(err, "Failed.") });
    }
  }

  return { succeededCount, failed };
}

// Bulk Verify Payment — same SUBMITTED -> PAYMENT_VERIFIED guard as the
// single action, applied per order. Counting the money is still a per-order
// judgement made against the screenshot; this exists for the common case
// where that judgement has already been made on a run of orders and the
// only thing left is the clicking.
export async function bulkVerifyOnlineOrderPaymentsAction(
  orderIds: string[]
): Promise<ActionResult<BulkOnlineOrderActionResult>> {
  try {
    const data = await runBulkAction(orderIds, verifyOnlineOrderPayment);
    if (data.succeededCount > 0) revalidatePath("/online-orders");
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to verify the selected orders.") };
  }
}

// Bulk Approve — same PAYMENT_VERIFIED -> APPROVED guard as the single
// action, per order (doc/online-orders-scope.md §5, both roles allowed).
export async function bulkApproveOnlineOrdersAction(
  orderIds: string[]
): Promise<ActionResult<BulkOnlineOrderActionResult>> {
  try {
    const data = await runBulkAction(orderIds, approveOnlineOrder);
    if (data.succeededCount > 0) revalidatePath("/online-orders");
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to approve the selected orders.") };
  }
}

// Bulk Dispatch — the only bulk action that touches stock; revalidates
// Inventory too, same as the single dispatchOnlineOrderAction.
export async function bulkDispatchOnlineOrdersAction(
  orderIds: string[]
): Promise<ActionResult<BulkOnlineOrderActionResult>> {
  try {
    const data = await runBulkAction(orderIds, dispatchOnlineOrder);
    if (data.succeededCount > 0) revalidateBoth();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to dispatch the selected orders.") };
  }
}
