"use server";

import { createClient } from "@/lib/supabase/server";
import {
  getTrackTyrePrices,
  submitOnlineOrder,
  uploadPaymentScreenshot,
  type SubmitOnlineOrderInput,
  type TrackTyrePrices,
} from "@/services/online-orders";

type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

function toErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Deliberately NO auth guard on this file — this is the public order
 * submission surface (doc/online-orders-scope.md §1), the app's first
 * genuinely anonymous write path. createClient() here just runs as the
 * Supabase `anon` role for a visitor with no session, which is exactly what
 * submit_online_order()/the storage bucket's RLS policies are built for
 * (0018_online_orders_schema.sql). Never import requireAdmin/
 * requireOnlineOrdersAccess/etc. into this file.
 */

// Seeds the "Amount to Pay" field on the order form. The catalogue price is
// recomputed server-side at submit time regardless (see submitOnlineOrder's
// doc comment) — a customer may override the amount with what they were
// quoted, but never by tampering with what this returns.
export async function fetchTrackTyrePricesAction(): Promise<ActionResult<TrackTyrePrices>> {
  try {
    const supabase = await createClient();
    const data = await getTrackTyrePrices(supabase);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load current prices.") };
  }
}

export async function uploadOnlineOrderScreenshotAction(formData: FormData): Promise<ActionResult<{ path: string }>> {
  try {
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { success: false, error: "No file provided." };
    }
    const supabase = await createClient();
    const path = await uploadPaymentScreenshot(supabase, file);
    return { success: true, data: { path } };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to upload the screenshot.") };
  }
}

export async function submitOnlineOrderAction(
  input: SubmitOnlineOrderInput
): Promise<ActionResult<{ orderId: string }>> {
  try {
    const supabase = await createClient();
    const orderId = await submitOnlineOrder(supabase, input);
    return { success: true, data: { orderId } };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to submit your order.") };
  }
}
