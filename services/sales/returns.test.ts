import { describe, expect, it } from "vitest";

import { InsufficientStockError, StockAdjustmentAuthError } from "@/services/shared/stock";

import { createQueryBuilderMock, createSupabaseMock } from "../../test/supabase-query-mock";
import {
  listReturnsForSale,
  listReturnsForSaleItem,
  recordSaleReturn,
  undoSaleReturn,
  SaleItemNotFoundError,
  SaleReturnNotFoundError,
  SaleReturnValidationError,
} from "./returns";

const validInput = {
  saleItemId: "22222222-2222-2222-2222-222222222222",
  quantity: 1,
  reason: "Customer changed their mind",
};

const returnRow = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccc01",
  sale_item_id: validInput.saleItemId,
  inventory_item_id: "33333333-3333-4333-8333-333333333301",
  quantity: 1,
  reason: validInput.reason,
  created_at: "2026-07-13T10:00:00.000Z",
};

// SALE-031/032/033: targets one specific PRODUCT sale_item, quantity capped
// server-side, restocks via adjust_stock(reason=SALE_RETURN) — all inside
// record_sale_return() (0013_sales_schema.sql). This test confirms the
// service layer calls it correctly and maps both success and every DB error.
describe("recordSaleReturn", () => {
  it("calls record_sale_return with the right params and returns the mapped row", async () => {
    const builder = createQueryBuilderMock({ data: returnRow, error: null });
    const supabase = createSupabaseMock(builder, { data: "cccccccc-cccc-4ccc-8ccc-cccccccccc01", error: null });

    const result = await recordSaleReturn(supabase, validInput);

    expect(supabase.rpc).toHaveBeenCalledWith("record_sale_return", {
      p_sale_item_id: validInput.saleItemId,
      p_quantity: 1,
      p_reason: validInput.reason,
    });
    expect(result.id).toBe("cccccccc-cccc-4ccc-8ccc-cccccccccc01");
    expect(result.saleItemId).toBe(validInput.saleItemId);
  });

  it("throws a validation error for a non-positive quantity without calling Supabase", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(recordSaleReturn(supabase, { ...validInput, quantity: 0 })).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  // SALE-034: blank reason rejected before calling Supabase.
  it("throws a validation error for a blank reason without calling Supabase", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(recordSaleReturn(supabase, { ...validInput, reason: "   " })).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  // SALE-032: server-side "exceeds remaining" rejection (also covers "only
  // product lines can be returned", the same 22023 error code).
  it("throws SaleReturnValidationError when the DB reports the quantity exceeds what's remaining", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, {
      data: null,
      error: { code: "22023", message: "Cannot return 3 units — only 2 remaining on this line" },
    });

    await expect(recordSaleReturn(supabase, validInput)).rejects.toBeInstanceOf(SaleReturnValidationError);
  });

  it("throws InsufficientStockError on DB error code P0001", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "P0001", message: "x" } });

    await expect(recordSaleReturn(supabase, validInput)).rejects.toBeInstanceOf(InsufficientStockError);
  });

  // SALE-040/admin-only: a non-admin caller is rejected by adjust_stock()'s
  // SALE_RETURN authorization rule (0013_sales_schema.sql).
  it("throws StockAdjustmentAuthError on DB error code 42501", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "42501", message: "x" } });

    await expect(recordSaleReturn(supabase, validInput)).rejects.toBeInstanceOf(StockAdjustmentAuthError);
  });

  it("throws SaleItemNotFoundError on DB error code P0002", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "P0002", message: "x" } });

    await expect(recordSaleReturn(supabase, validInput)).rejects.toBeInstanceOf(SaleItemNotFoundError);
  });
});

// SALE-035: a Sale Return only ever calls adjust_stock for the PRODUCT
// line's inventory item — there is no code path here that touches an
// INSTALLATION line's amount, since returns are keyed by sale_item_id and
// record_sale_return() rejects non-PRODUCT lines outright (tested above via
// the 22023 case).
describe("listReturnsForSaleItem", () => {
  it("returns mapped rows for a given sale item, newest first", async () => {
    const builder = createQueryBuilderMock({ data: [returnRow], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listReturnsForSaleItem(supabase, validInput.saleItemId);

    expect(result).toHaveLength(1);
    expect(builder.eq).toHaveBeenCalledWith("sale_item_id", validInput.saleItemId);
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });
});

// UNDO-010..013: the Return dialog needs every existing return across a
// whole Sale (not just one line) to show its "existing returns, with Undo"
// list — sale_returns has no sale_id column, only sale_item_id, so this
// filters through the sale_items join instead.
describe("listReturnsForSale", () => {
  const saleId = "dddddddd-dddd-4ddd-8ddd-dddddddddd01";
  const returnRowWithSaleJoin = { ...returnRow, sale_items: { sale_id: saleId } };

  it("UNDO-010: returns mapped rows for the given sale id, newest first", async () => {
    const builder = createQueryBuilderMock({ data: [returnRowWithSaleJoin], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listReturnsForSale(supabase, saleId);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(returnRow.id);
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("UNDO-011: filters through the sale_items join, not a direct sale_returns column", async () => {
    const builder = createQueryBuilderMock({ data: [returnRowWithSaleJoin], error: null });
    const supabase = createSupabaseMock(builder);

    await listReturnsForSale(supabase, saleId);

    expect(builder.eq).toHaveBeenCalledWith("sale_items.sale_id", saleId);
  });

  it("UNDO-012: returns an empty array when the sale has no returns yet", async () => {
    const builder = createQueryBuilderMock({ data: [], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listReturnsForSale(supabase, saleId);

    expect(result).toEqual([]);
  });

  it("UNDO-013: two returns against two different lines on the same sale both come back in one call", async () => {
    const other = { ...returnRowWithSaleJoin, id: "cccccccc-cccc-4ccc-8ccc-cccccccccc02", sale_item_id: "33333333-3333-4333-8333-333333333302", quantity: 2 };
    const builder = createQueryBuilderMock({ data: [returnRowWithSaleJoin, other], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listReturnsForSale(supabase, saleId);

    expect(result.map((r) => r.id)).toEqual([returnRow.id, "cccccccc-cccc-4ccc-8ccc-cccccccccc02"]);
  });
});

// UNDO-020..026: undoSaleReturn mirrors recordSaleReturn's error-mapping
// pattern exactly — same DB error codes, same shared error classes reused.
describe("undoSaleReturn", () => {
  const undoInput = { saleReturnId: "cccccccc-cccc-4ccc-8ccc-cccccccccc01", reason: "Entered against the wrong item by mistake" };

  it("UNDO-020: calls undo_sale_return with p_sale_return_id and p_reason mapped from input", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    await undoSaleReturn(supabase, undoInput);

    expect(supabase.rpc).toHaveBeenCalledWith("undo_sale_return", {
      p_sale_return_id: undoInput.saleReturnId,
      p_reason: undoInput.reason,
    });
  });

  it("UNDO-021: rejects a blank reason client-side (Zod) without ever calling Supabase", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(undoSaleReturn(supabase, { ...undoInput, reason: "   " })).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("UNDO-022: resolves successfully on a clean RPC response", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    await expect(undoSaleReturn(supabase, undoInput)).resolves.toBeUndefined();
  });

  it("UNDO-023: throws InsufficientStockError on DB error code P0001", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "P0001", message: "x" } });

    await expect(undoSaleReturn(supabase, undoInput)).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it("UNDO-024: throws StockAdjustmentAuthError on DB error code 42501", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "42501", message: "x" } });

    await expect(undoSaleReturn(supabase, undoInput)).rejects.toBeInstanceOf(StockAdjustmentAuthError);
  });

  it("UNDO-025: throws SaleReturnNotFoundError on DB error code P0002", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "P0002", message: "x" } });

    await expect(undoSaleReturn(supabase, undoInput)).rejects.toBeInstanceOf(SaleReturnNotFoundError);
  });

  it("UNDO-026: throws SaleReturnValidationError on DB error code 22023", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, {
      data: null,
      error: { code: "22023", message: "A reason is required to undo a sale return" },
    });

    await expect(undoSaleReturn(supabase, undoInput)).rejects.toBeInstanceOf(SaleReturnValidationError);
  });
});
