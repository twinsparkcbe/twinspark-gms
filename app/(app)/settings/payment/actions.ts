"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import {
  createPaymentQrConfig,
  deletePaymentQrConfig,
  listPaymentQrConfigs,
  setActivePaymentQrConfig,
  updatePaymentQrConfig,
  uploadPaymentQrImage,
  type PaymentQrConfigInput,
  type PaymentQrConfigRow,
} from "@/services/payments";

type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

function toErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Every action re-checks Admin access server-side — never trust the
 * client. Settings / Payment is Admin-only, same as Settings / Users. */
async function paymentAdminClient() {
  const { userId } = await requireAdmin();
  return { supabase: await createClient(), userId };
}

function revalidatePayment() {
  revalidatePath("/settings/payment");
  // The public order form reads the active config server-side on every
  // request (createClient() forces dynamic rendering via cookies()), but
  // revalidating explicitly keeps this consistent with every other
  // Admin-writes-affect-a-public-surface path in the app.
  revalidatePath("/order");
}

export async function fetchPaymentQrConfigsAction(): Promise<ActionResult<PaymentQrConfigRow[]>> {
  try {
    const { supabase } = await paymentAdminClient();
    const data = await listPaymentQrConfigs(supabase);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load payment configs.") };
  }
}

export async function uploadPaymentQrImageAction(formData: FormData): Promise<ActionResult<{ path: string }>> {
  try {
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { success: false, error: "No file provided." };
    }
    const { supabase } = await paymentAdminClient();
    const path = await uploadPaymentQrImage(supabase, file);
    return { success: true, data: { path } };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to upload the QR image.") };
  }
}

export async function createPaymentQrConfigAction(input: PaymentQrConfigInput): Promise<ActionResult<PaymentQrConfigRow>> {
  try {
    const { supabase, userId } = await paymentAdminClient();
    const data = await createPaymentQrConfig(supabase, userId, input);
    revalidatePayment();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to create payment config.") };
  }
}

export async function updatePaymentQrConfigAction(
  id: string,
  input: PaymentQrConfigInput
): Promise<ActionResult<PaymentQrConfigRow>> {
  try {
    const { supabase } = await paymentAdminClient();
    const data = await updatePaymentQrConfig(supabase, id, input);
    revalidatePayment();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to update payment config.") };
  }
}

export async function setActivePaymentQrConfigAction(id: string): Promise<ActionResult<PaymentQrConfigRow>> {
  try {
    const { supabase } = await paymentAdminClient();
    const data = await setActivePaymentQrConfig(supabase, id);
    revalidatePayment();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to activate payment config.") };
  }
}

export async function deletePaymentQrConfigAction(id: string): Promise<ActionResult<undefined>> {
  try {
    const { supabase } = await paymentAdminClient();
    await deletePaymentQrConfig(supabase, id);
    revalidatePayment();
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to delete payment config.") };
  }
}
