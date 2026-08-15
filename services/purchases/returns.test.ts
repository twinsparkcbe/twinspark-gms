import { describe, expect, it } from "vitest";

import { InsufficientStockError, StockAdjustmentAuthError } from "@/services/shared/stock";

import { createQueryBuilderMock, createSupabaseMock } from "../../test/supabase-query-mock";
import { PurchaseEntryNotFoundError } from "./entries";
import { listReturnsForEntry, PurchaseReturnValidationError, recordPurchaseReturn } from "./returns";

const validInput = {
  purchaseEntryId: "22222222-2222-2222-2222-222222222222",
  quantity: 2,
  reason: "Defective batch",
};

const returnRow = {
  id: "return-1",
  purchase_entry_id: validInput.purchaseEntryId,
  inventory_item_id: "item-1",
  quantity: 2,
  reason: "Defective batch",
  created_at: "2026-06-05T09:00:00.000Z",
};

// PUR-013
describe("recordPurchaseReturn", () => {
  it("calls record_purchase_return with the right params and returns the mapped row", async () => {
    const builder = createQueryBuilderMock({ data: returnRow, error: null });
    const supabase = createSupabaseMock(builder, { data: "return-1", error: null });

    const result = await recordPurchaseReturn(supabase, validInput);

    expect(supabase.rpc).toHaveBeenCalledWith("record_purchase_return", {
      p_purchase_entry_id: validInput.purchaseEntryId,
      p_quantity: 2,
      p_reason: "Defective batch",
    });
    expect(result.id).toBe("return-1");
    expect(result.quantity).toBe(2);
  });

  // PUR-016: rejected before ever calling Supabase.
  it("throws a validation error for a non-positive quantity without calling Supabase", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(recordPurchaseReturn(supabase, { ...validInput, quantity: 0 })).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  // PUR-015: blank reason rejected before calling Supabase.
  it("throws a validation error for a blank reason without calling Supabase", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(recordPurchaseReturn(supabase, { ...validInput, reason: "   " })).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  // PUR-014/FIFO-010: server-side "exceeds remaining" rejection — remaining
  // now reflects both prior returns AND anything already sold from this
  // batch, since both decrement the same DB column.
  it("throws PurchaseReturnValidationError when the DB reports the quantity exceeds what's remaining", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, {
      data: null,
      error: { code: "22023", message: "Cannot return 8 units — only 7 remaining on this purchase" },
    });

    await expect(recordPurchaseReturn(supabase, validInput)).rejects.toBeInstanceOf(
      PurchaseReturnValidationError
    );
  });

  // PUR-018: insufficient stock at return time (edge case — stock was
  // separately reduced by something else between purchase and return).
  it("throws InsufficientStockError on DB error code P0001", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "P0001", message: "x" } });

    await expect(recordPurchaseReturn(supabase, validInput)).rejects.toBeInstanceOf(InsufficientStockError);
  });

  // PUR-019: non-admin caller.
  it("throws StockAdjustmentAuthError on DB error code 42501", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "42501", message: "x" } });

    await expect(recordPurchaseReturn(supabase, validInput)).rejects.toBeInstanceOf(StockAdjustmentAuthError);
  });

  it("throws PurchaseEntryNotFoundError on DB error code P0002", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "P0002", message: "x" } });

    await expect(recordPurchaseReturn(supabase, validInput)).rejects.toBeInstanceOf(PurchaseEntryNotFoundError);
  });
});

describe("listReturnsForEntry", () => {
  it("returns mapped rows ordered newest first", async () => {
    const builder = createQueryBuilderMock({ data: [returnRow], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listReturnsForEntry(supabase, validInput.purchaseEntryId);

    expect(result).toHaveLength(1);
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });
});
