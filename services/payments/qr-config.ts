import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

import { paymentQrConfigInputSchema, type PaymentQrConfigInput } from "./schemas";

const QR_IMAGE_BUCKET = "payment-qr-images";
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export class PaymentQrConfigNotFoundError extends Error {
  constructor() {
    super("Payment QR config not found.");
    this.name = "PaymentQrConfigNotFoundError";
  }
}

/** Raised on delete of the currently active config — the admin must
 * activate a different config first. Deliberately blocked rather than
 * silently leaving zero active configs, which would make the payment card
 * vanish from /order with no obvious explanation on the admin side. */
export class ActivePaymentQrConfigError extends Error {
  constructor() {
    super("Can't delete the active payment config — set another config active first.");
    this.name = "ActivePaymentQrConfigError";
  }
}

export class InvalidPaymentQrImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPaymentQrImageError";
  }
}

export interface PaymentQrConfigRow {
  id: string;
  label: string;
  upiId: string;
  payeeName: string;
  qrImagePath: string;
  /** Public URL — the bucket is public-read (0030_payment_qr_config.sql),
   * unlike the private online-order-screenshots bucket, so this can be a
   * plain public URL rather than a signed one. */
  qrImageUrl: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type PaymentQrConfigDbRow = {
  id: string;
  label: string;
  upi_id: string;
  payee_name: string;
  qr_image_path: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const SELECT_COLUMNS = "id, label, upi_id, payee_name, qr_image_path, is_active, created_at, updated_at";

function mapRow(supabase: SupabaseClient<Database>, row: PaymentQrConfigDbRow): PaymentQrConfigRow {
  const {
    data: { publicUrl },
  } = supabase.storage.from(QR_IMAGE_BUCKET).getPublicUrl(row.qr_image_path);

  return {
    id: row.id,
    label: row.label,
    upiId: row.upi_id,
    payeeName: row.payee_name,
    qrImagePath: row.qr_image_path,
    qrImageUrl: publicUrl,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Full roster for the Settings / Payment admin table — active and inactive
 * configs both, newest first. Admin-only (RLS restricts non-admin reads to
 * nothing; see 0030_payment_qr_config.sql). */
export async function listPaymentQrConfigs(supabase: SupabaseClient<Database>): Promise<PaymentQrConfigRow[]> {
  const { data, error } = await supabase
    .from("payment_qr_configs")
    .select(SELECT_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) throw new Error(toErrorMessage(error, "Failed to load payment configs."));
  return ((data ?? []) as unknown as PaymentQrConfigDbRow[]).map((row) => mapRow(supabase, row));
}

/**
 * The one config /order shows. Returns null (not an error) when none is
 * active — the public form's PaymentDetailsCard is simply absent in that
 * case, the rest of the order flow is unaffected either way.
 */
export async function getActivePaymentQrConfig(supabase: SupabaseClient<Database>): Promise<PaymentQrConfigRow | null> {
  const { data, error } = await supabase.from("payment_qr_configs").select(SELECT_COLUMNS).eq("is_active", true).maybeSingle();

  if (error) throw new Error(toErrorMessage(error, "Failed to load the payment config."));
  if (!data) return null;
  return mapRow(supabase, data as unknown as PaymentQrConfigDbRow);
}

/**
 * Uploads a QR image to the public `payment-qr-images` bucket and returns
 * its storage path — same two-step shape as uploadPaymentScreenshot()
 * (services/online-orders/orders.ts) and uploadInventoryItemImage()
 * (services/inventory/items.ts): upload first, then pass the returned path
 * into create/update.
 */
export async function uploadPaymentQrImage(supabase: SupabaseClient<Database>, file: File): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new InvalidPaymentQrImageError("Only PNG, JPEG, or WEBP images are allowed.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new InvalidPaymentQrImageError("Image must be 5MB or smaller.");
  }

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage.from(QR_IMAGE_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(error.message);

  return path;
}

export async function createPaymentQrConfig(
  supabase: SupabaseClient<Database>,
  createdBy: string,
  rawInput: PaymentQrConfigInput
): Promise<PaymentQrConfigRow> {
  const input = paymentQrConfigInputSchema.parse(rawInput);

  const { data, error } = await supabase
    .from("payment_qr_configs")
    .insert({
      label: input.label,
      upi_id: input.upiId,
      payee_name: input.payeeName,
      qr_image_path: input.qrImagePath,
      created_by: createdBy,
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) throw new Error(toErrorMessage(error, "Failed to create payment config."));
  return mapRow(supabase, data as unknown as PaymentQrConfigDbRow);
}

export async function updatePaymentQrConfig(
  supabase: SupabaseClient<Database>,
  id: string,
  rawInput: PaymentQrConfigInput
): Promise<PaymentQrConfigRow> {
  const input = paymentQrConfigInputSchema.parse(rawInput);

  const { data, error } = await supabase
    .from("payment_qr_configs")
    .update({
      label: input.label,
      upi_id: input.upiId,
      payee_name: input.payeeName,
      qr_image_path: input.qrImagePath,
    })
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(toErrorMessage(error, "Failed to update payment config."));
  if (!data) throw new PaymentQrConfigNotFoundError();
  return mapRow(supabase, data as unknown as PaymentQrConfigDbRow);
}

/** Calls set_active_payment_qr() (0030_payment_qr_config.sql) — deactivates
 * every other config and activates this one in a single DB statement, so
 * there's never a window with zero or two active rows. */
export async function setActivePaymentQrConfig(supabase: SupabaseClient<Database>, id: string): Promise<PaymentQrConfigRow> {
  const { data, error } = await supabase.rpc("set_active_payment_qr", { p_id: id });

  if (error) {
    if (error.code === "P0002") throw new PaymentQrConfigNotFoundError();
    throw new Error(toErrorMessage(error, "Failed to activate payment config."));
  }
  if (!data) throw new PaymentQrConfigNotFoundError();
  return mapRow(supabase, data as unknown as PaymentQrConfigDbRow);
}

export async function deletePaymentQrConfig(supabase: SupabaseClient<Database>, id: string): Promise<void> {
  const { data: existing, error: fetchErr } = await supabase
    .from("payment_qr_configs")
    .select("is_active")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) throw new Error(toErrorMessage(fetchErr, "Failed to delete payment config."));
  if (!existing) throw new PaymentQrConfigNotFoundError();
  if (existing.is_active) throw new ActivePaymentQrConfigError();

  const { error } = await supabase.from("payment_qr_configs").delete().eq("id", id);
  if (error) throw new Error(toErrorMessage(error, "Failed to delete payment config."));
}
