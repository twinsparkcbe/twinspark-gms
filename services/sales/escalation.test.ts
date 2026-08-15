import { describe, expect, it } from "vitest";

import { createQueryBuilderMock, createSupabaseMock } from "../../test/supabase-query-mock";
import { escalateSaleToService, SaleEscalationValidationError } from "./escalation";

const saleId = "33333333-3333-3333-3333-333333333333";

const saleRow = {
  id: saleId,
  customer_id: "cust-1",
  sale_date: "2026-07-13T10:00:00.000Z",
  gst_applicable: false,
  gst_amount: 0,
  discount_applicable: false,
  discount_amount: 0,
  subtotal: 1500,
  installation_total: 300,
  grand_total: 1800,
  invoice_number: "TW-S-000002",
  needs_service_followup: true,
  service_followup_note: "Wheel bearing looked worn",
  created_at: "2026-07-13T10:00:00.000Z",
  customers: { name: "Arun Kumar", mobile_number: "9876543210" },
  sale_items: [],
};

describe("escalateSaleToService", () => {
  // SALE-037: sets the flag + optional note, tied to the sale/customer — no
  // Service Job is created (that RPC only ever updates `sales`, see
  // 0013_sales_schema.sql's escalate_sale_to_service()).
  it("calls escalate_sale_to_service with the note, then returns the refetched sale", async () => {
    const builder = createQueryBuilderMock({ data: saleRow, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    const result = await escalateSaleToService(supabase, { saleId, note: "Wheel bearing looked worn" });

    expect(supabase.rpc).toHaveBeenCalledWith("escalate_sale_to_service", {
      p_sale_id: saleId,
      p_note: "Wheel bearing looked worn",
    });
    expect(result.needsServiceFollowup).toBe(true);
    expect(result.serviceFollowupNote).toBe("Wheel bearing looked worn");
  });

  it("passes null when no note is given", async () => {
    const builder = createQueryBuilderMock({ data: saleRow, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    await escalateSaleToService(supabase, { saleId });

    expect(supabase.rpc).toHaveBeenCalledWith("escalate_sale_to_service", {
      p_sale_id: saleId,
      p_note: null,
    });
  });

  // SALE-036: only a sale with at least one INSTALLATION line can be
  // escalated — enforced server-side by escalate_sale_to_service(), surfaced
  // here as a 22023 validation error.
  it("throws SaleEscalationValidationError when the sale has no installation line", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, {
      data: null,
      error: { code: "22023", message: "Only a sale with at least one installation line can be escalated to Service" },
    });

    await expect(escalateSaleToService(supabase, { saleId })).rejects.toBeInstanceOf(
      SaleEscalationValidationError
    );
  });
});
