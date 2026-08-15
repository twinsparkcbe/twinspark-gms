import { describe, expect, it, vi } from "vitest";

import {
  adjustStock,
  InsufficientStockError,
  StockAdjustmentAuthError,
  StockAdjustmentValidationError,
} from "./stock";

function mockSupabaseRpc(result: { data: unknown; error: { code?: string; message: string } | null }) {
  return {
    rpc: vi.fn(() => Promise.resolve(result)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("adjustStock", () => {
  const input = {
    itemId: "item-1",
    delta: -2,
    reason: "SALE" as const,
    sourceModule: "sales",
  };

  it("calls the adjust_stock RPC with the right params and returns the new balance", async () => {
    const supabase = mockSupabaseRpc({ data: 8, error: null });

    const result = await adjustStock(supabase, input);

    expect(result).toBe(8);
    expect(supabase.rpc).toHaveBeenCalledWith("adjust_stock", {
      p_item_id: "item-1",
      p_delta: -2,
      p_reason: "SALE",
      p_source_module: "sales",
      p_note: null,
      p_purchase_entry_id: null,
      p_unit_cost: null,
    });
  });

  // FIFO batch tracking (0010_purchase_batch_fifo.sql): purchaseEntryId
  // targets one specific batch (Purchase Return) instead of generic FIFO.
  it("forwards purchaseEntryId as p_purchase_entry_id when given", async () => {
    const supabase = mockSupabaseRpc({ data: 8, error: null });

    await adjustStock(supabase, { ...input, purchaseEntryId: "entry-1", note: "Defective batch" });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "adjust_stock",
      expect.objectContaining({ p_purchase_entry_id: "entry-1" })
    );
  });

  // unitCost seeds a synthetic batch's cost for a positive Manual
  // Correction/Opening Stock adjustment with no explicit batch.
  it("forwards unitCost as p_unit_cost when given", async () => {
    const supabase = mockSupabaseRpc({ data: 8, error: null });

    await adjustStock(supabase, { ...input, delta: 5, unitCost: 950, note: "Stock-take correction" });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "adjust_stock",
      expect.objectContaining({ p_unit_cost: 950 })
    );
  });

  // INV-037: stock cannot go negative — the DB raises P0001, mapped to a
  // typed, catchable error.
  it("throws InsufficientStockError on DB error code P0001", async () => {
    const supabase = mockSupabaseRpc({ data: null, error: { code: "P0001", message: "insufficient stock" } });

    await expect(adjustStock(supabase, input)).rejects.toBeInstanceOf(InsufficientStockError);
  });

  // Reason-based authorization (e.g. a Sales Person attempting a PURCHASE
  // movement) — the DB raises 42501, mapped to a typed error.
  it("throws StockAdjustmentAuthError on DB error code 42501", async () => {
    const supabase = mockSupabaseRpc({ data: null, error: { code: "42501", message: "not authorized" } });

    await expect(adjustStock(supabase, input)).rejects.toBeInstanceOf(StockAdjustmentAuthError);
  });

  // INV-041: a required note missing for MANUAL_CORRECTION/DAMAGE — the DB
  // raises 22023, mapped to a typed error.
  it("throws StockAdjustmentValidationError on DB error code 22023", async () => {
    const supabase = mockSupabaseRpc({ data: null, error: { code: "22023", message: "note required" } });

    await expect(
      adjustStock(supabase, { ...input, reason: "DAMAGE", delta: -1 })
    ).rejects.toBeInstanceOf(StockAdjustmentValidationError);
  });

  it("throws StockAdjustmentValidationError for a zero delta without calling Supabase", async () => {
    const supabase = mockSupabaseRpc({ data: null, error: null });

    await expect(adjustStock(supabase, { ...input, delta: 0 })).rejects.toBeInstanceOf(
      StockAdjustmentValidationError
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  // Each of the 6 movement reasons is passed through untouched — the DB
  // function (not this layer) is what applies the sign/authorization rules
  // per reason. This just confirms every reason is forwarded correctly,
  // including MANUAL_CORRECTION/DAMAGE which also carry a note.
  it.each([
    "PURCHASE",
    "SALE",
    "SERVICE_USAGE",
    "ONLINE_ORDER_DISPATCH",
    "MANUAL_CORRECTION",
    "DAMAGE",
  ] as const)(
    "forwards reason %s to the RPC call",
    async (
      reason: "PURCHASE" | "SALE" | "SERVICE_USAGE" | "ONLINE_ORDER_DISPATCH" | "MANUAL_CORRECTION" | "DAMAGE"
    ) => {
      const supabase = mockSupabaseRpc({ data: 1, error: null });
      const note = reason === "MANUAL_CORRECTION" || reason === "DAMAGE" ? "Stock-take correction" : undefined;

      await adjustStock(supabase, { ...input, reason, note });

      expect(supabase.rpc).toHaveBeenCalledWith(
        "adjust_stock",
        expect.objectContaining({ p_reason: reason })
      );
    }
  );
});
