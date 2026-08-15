import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

import { escalateSaleInputSchema, type EscalateSaleInput } from "./schemas";
import { getSale, type SaleRow } from "./sales";

export class SaleEscalationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaleEscalationValidationError";
  }
}

/**
 * Flags a completed sale "Needs Service Follow-up" (scope doc §5) — calls
 * escalate_sale_to_service() (0013_sales_schema.sql), which only allows this
 * on a sale with at least one INSTALLATION line (SALE-036). Does not create
 * a Service Job — that module doesn't exist yet; this just makes sure the
 * customer/sale context isn't lost, for Service to pick up as a ready-made
 * intake queue once it's built.
 */
export async function escalateSaleToService(
  supabase: SupabaseClient<Database>,
  rawInput: EscalateSaleInput
): Promise<SaleRow> {
  const input = escalateSaleInputSchema.parse(rawInput);

  const { error } = await supabase.rpc("escalate_sale_to_service", {
    p_sale_id: input.saleId,
    p_note: input.note ?? null,
  });

  if (error) {
    if (error.code === "22023") {
      throw new SaleEscalationValidationError(error.message);
    }
    throw new Error(error.message);
  }

  return getSale(supabase, input.saleId);
}
