import { describe, expect, it } from "vitest";

import { InsufficientStockError, StockAdjustmentAuthError, StockAdjustmentValidationError } from "@/services/shared/stock";

import { createQueryBuilderMock, createSupabaseMock } from "../../test/supabase-query-mock";
import {
  getPurchaseEntry,
  getPurchaseStats,
  listPurchaseEntries,
  PurchaseEntryNotFoundError,
  PurchaseItemUnavailableError,
  recordPurchaseEntry,
  updatePurchaseEntry,
} from "./entries";

const validInput = {
  inventoryItemId: "11111111-1111-1111-1111-111111111111",
  quantity: 50,
  unitPrice: 1250,
  sellingPrice: 1500,
  purchaseDate: new Date("2026-06-01T10:00:00.000Z"),
  supplierName: "ABC Tyre Distributors",
  note: "Monthly restock",
};

const joinedRow = {
  id: "entry-1",
  inventory_item_id: validInput.inventoryItemId,
  quantity: 50,
  unit_price: 1250,
  total_amount: 62500,
  batch_number: "BATCH-000001",
  remaining_quantity: 50,
  selling_price: 1500,
  supplier_name: "ABC Tyre Distributors",
  purchase_date: "2026-06-01T10:00:00.000Z",
  note: "Monthly restock",
  created_at: "2026-06-01T10:05:00.000Z",
  inventory_items: {
    product_name: "MRF Track Tyre",
    sku_code: "SKU-00001",
    item_type: "TRACK_TYRE",
    brand_id: "brand-1",
    brands: { name: "MRF" },
  },
};

// PUR-001: happy path — records the entry, RPC called with the right args,
// and the follow-up fetch returns the full joined + mapped row.
describe("recordPurchaseEntry", () => {
  it("calls record_purchase_entry with the right params and returns the mapped entry", async () => {
    const builder = createQueryBuilderMock({ data: joinedRow, error: null });
    const supabase = createSupabaseMock(builder, { data: "entry-1", error: null });

    const result = await recordPurchaseEntry(supabase, validInput);

    expect(supabase.rpc).toHaveBeenCalledWith("record_purchase_entry", {
      p_inventory_item_id: validInput.inventoryItemId,
      p_quantity: 50,
      p_unit_price: 1250,
      p_purchase_date: validInput.purchaseDate.toISOString(),
      p_supplier_name: "ABC Tyre Distributors",
      p_note: "Monthly restock",
      p_selling_price: 1500,
    });
    expect(result.id).toBe("entry-1");
    expect(result.totalAmount).toBe(62500);
    expect(result.itemName).toBe("MRF Track Tyre");
    expect(result.brandName).toBe("MRF");
    expect(result.batchNumber).toBe("BATCH-000001");
    expect(result.remainingQuantity).toBe(50);
    expect(result.sellingPrice).toBe(1500);
  });

  it("sends null for omitted supplierName/note", async () => {
    const builder = createQueryBuilderMock({ data: joinedRow, error: null });
    const supabase = createSupabaseMock(builder, { data: "entry-1", error: null });

    const { supplierName: _s, note: _n, ...rest } = validInput;
    await recordPurchaseEntry(supabase, rest);

    expect(supabase.rpc).toHaveBeenCalledWith(
      "record_purchase_entry",
      expect.objectContaining({ p_supplier_name: null, p_note: null, p_selling_price: 1500 })
    );
  });

  // sellingPrice is required now (0011_purchases_item_ownership.sql) —
  // rejected before ever calling Supabase, same as quantity/unitPrice.
  it("throws a validation error for a non-positive sellingPrice without calling Supabase", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(recordPurchaseEntry(supabase, { ...validInput, sellingPrice: 0 })).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  // PUR-002/003: zero/negative quantity or price is rejected before calling Supabase.
  it("throws a validation error for a non-positive quantity without calling Supabase", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(recordPurchaseEntry(supabase, { ...validInput, quantity: 0 })).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  // Maps adjust_stock()'s insufficient-stock code (bubbled through
  // record_purchase_entry) to the shared typed error.
  it("throws InsufficientStockError on DB error code P0001", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "P0001", message: "insufficient" } });

    await expect(recordPurchaseEntry(supabase, validInput)).rejects.toBeInstanceOf(InsufficientStockError);
  });

  // PUR-008: non-admin caller.
  it("throws StockAdjustmentAuthError on DB error code 42501", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "42501", message: "not authorized" } });

    await expect(recordPurchaseEntry(supabase, validInput)).rejects.toBeInstanceOf(StockAdjustmentAuthError);
  });

  // PUR-005: item not found or inactive.
  it("throws PurchaseItemUnavailableError on DB error code P0002", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "P0002", message: "not found" } });

    await expect(recordPurchaseEntry(supabase, validInput)).rejects.toBeInstanceOf(PurchaseItemUnavailableError);
  });

  it("throws StockAdjustmentValidationError on DB error code 22023", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "22023", message: "bad input" } });

    await expect(recordPurchaseEntry(supabase, validInput)).rejects.toBeInstanceOf(StockAdjustmentValidationError);
  });
});

// Edit Purchase — corrects a data-entry mistake on an already-recorded
// batch. Any batch can be edited at any time (confirmed decision); the
// server enforces the "can't drop below what's already consumed" rule via
// update_purchase_entry()'s reuse of adjust_stock()'s remaining_quantity
// floor check (surfaced here as P0001).
describe("updatePurchaseEntry", () => {
  const editInput = {
    quantity: 40,
    unitPrice: 1300,
    sellingPrice: 1600,
    purchaseDate: new Date("2026-07-01T10:00:00.000Z"),
    supplierName: "XYZ Distributors",
    note: "Fixed a typo in the original entry",
  };

  it("calls update_purchase_entry with the right params and returns the mapped entry", async () => {
    const builder = createQueryBuilderMock({ data: joinedRow, error: null });
    const supabase = createSupabaseMock(builder, { data: "entry-1", error: null });

    const result = await updatePurchaseEntry(supabase, "entry-1", editInput);

    expect(supabase.rpc).toHaveBeenCalledWith("update_purchase_entry", {
      p_entry_id: "entry-1",
      p_quantity: 40,
      p_unit_price: 1300,
      p_selling_price: 1600,
      p_purchase_date: editInput.purchaseDate.toISOString(),
      p_supplier_name: "XYZ Distributors",
      p_note: "Fixed a typo in the original entry",
    });
    expect(result.id).toBe("entry-1");
  });

  it("sends null for omitted supplierName/note", async () => {
    const builder = createQueryBuilderMock({ data: joinedRow, error: null });
    const supabase = createSupabaseMock(builder, { data: "entry-1", error: null });

    const { supplierName: _s, note: _n, ...rest } = editInput;
    await updatePurchaseEntry(supabase, "entry-1", rest);

    expect(supabase.rpc).toHaveBeenCalledWith(
      "update_purchase_entry",
      expect.objectContaining({ p_supplier_name: null, p_note: null })
    );
  });

  it("throws a validation error for a non-positive quantity without calling Supabase", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(updatePurchaseEntry(supabase, "entry-1", { ...editInput, quantity: 0 })).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("throws a validation error for a non-positive sellingPrice without calling Supabase", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(updatePurchaseEntry(supabase, "entry-1", { ...editInput, sellingPrice: 0 })).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  // Reducing quantity below what's already been sold/returned from this
  // batch surfaces adjust_stock()'s existing floor check as P0001.
  it("throws InsufficientStockError on DB error code P0001", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "P0001", message: "insufficient" } });

    await expect(updatePurchaseEntry(supabase, "entry-1", editInput)).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it("throws StockAdjustmentAuthError on DB error code 42501", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "42501", message: "not authorized" } });

    await expect(updatePurchaseEntry(supabase, "entry-1", editInput)).rejects.toBeInstanceOf(StockAdjustmentAuthError);
  });

  it("throws PurchaseEntryNotFoundError on DB error code P0002", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "P0002", message: "not found" } });

    await expect(updatePurchaseEntry(supabase, "entry-1", editInput)).rejects.toBeInstanceOf(PurchaseEntryNotFoundError);
  });

  it("throws StockAdjustmentValidationError on DB error code 22023", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "22023", message: "bad input" } });

    await expect(updatePurchaseEntry(supabase, "entry-1", editInput)).rejects.toBeInstanceOf(
      StockAdjustmentValidationError
    );
  });
});

describe("getPurchaseEntry", () => {
  it("returns the mapped row when found", async () => {
    const builder = createQueryBuilderMock({ data: joinedRow, error: null });
    const supabase = createSupabaseMock(builder);

    const result = await getPurchaseEntry(supabase, "entry-1");
    expect(result.itemSkuCode).toBe("SKU-00001");
  });

  it("throws PurchaseEntryNotFoundError when missing", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(getPurchaseEntry(supabase, "missing")).rejects.toBeInstanceOf(PurchaseEntryNotFoundError);
  });
});

describe("listPurchaseEntries", () => {
  // PUR-009: pagination.
  it("applies range based on page/pageSize", async () => {
    const builder = createQueryBuilderMock({ data: [joinedRow], error: null, count: 1 });
    const supabase = createSupabaseMock(builder);

    await listPurchaseEntries(supabase, { page: 2, pageSize: 10 });

    expect(builder.range).toHaveBeenCalledWith(10, 19);
  });

  // PUR-010: filters.
  it("applies item type, brand, and date-range filters", async () => {
    const builder = createQueryBuilderMock({ data: [], error: null, count: 0 });
    const supabase = createSupabaseMock(builder);

    await listPurchaseEntries(supabase, {
      page: 1,
      pageSize: 20,
      itemTypes: ["TRACK_TYRE"],
      brandIds: ["brand-1"],
      dateFrom: new Date("2026-06-01T00:00:00.000Z"),
      dateTo: new Date("2026-06-30T23:59:59.000Z"),
    });

    expect(builder.in).toHaveBeenCalledWith("inventory_items.item_type", ["TRACK_TYRE"]);
    expect(builder.in).toHaveBeenCalledWith("inventory_items.brand_id", ["brand-1"]);
    expect(builder.gte).toHaveBeenCalledWith("purchase_date", "2026-06-01T00:00:00.000Z");
    expect(builder.lte).toHaveBeenCalledWith("purchase_date", "2026-06-30T23:59:59.000Z");
  });

  // PUR-011: sort mapping.
  it.each([
    ["newest", "created_at", { ascending: false }],
    ["amount", "total_amount", { ascending: false }],
  ] as const)("sorts by %s", async (sortBy, column, opts) => {
    const builder = createQueryBuilderMock({ data: [], error: null, count: 0 });
    const supabase = createSupabaseMock(builder);

    await listPurchaseEntries(supabase, { page: 1, pageSize: 20, sortBy });

    expect(builder.order).toHaveBeenCalledWith(column, opts);
  });

  it('sorts by "name" on the embedded item table', async () => {
    const builder = createQueryBuilderMock({ data: [], error: null, count: 0 });
    const supabase = createSupabaseMock(builder);

    await listPurchaseEntries(supabase, { page: 1, pageSize: 20, sortBy: "name" });

    expect(builder.order).toHaveBeenCalledWith("product_name", { ascending: true, foreignTable: "inventory_items" });
  });

  // PUR-012: total count returned alongside rows.
  it("returns entries and total count", async () => {
    const builder = createQueryBuilderMock({ data: [joinedRow], error: null, count: 1 });
    const supabase = createSupabaseMock(builder);

    const result = await listPurchaseEntries(supabase, { page: 1, pageSize: 20 });
    expect(result.total).toBe(1);
    expect(result.entries).toHaveLength(1);
  });
});

// PUR-020: aggregate purchase amount.
describe("getPurchaseStats", () => {
  it("sums total_amount for the given range", async () => {
    const builder = createQueryBuilderMock({
      data: [{ total_amount: 1000 }, { total_amount: 2500 }],
      error: null,
    });
    const supabase = createSupabaseMock(builder);

    const result = await getPurchaseStats(supabase, {
      from: new Date("2026-06-01"),
      to: new Date("2026-06-30"),
    });

    expect(result.totalPurchaseAmount).toBe(3500);
    expect(result.entryCount).toBe(2);
  });

  it("defaults to the current month when no range is given", async () => {
    const builder = createQueryBuilderMock({ data: [], error: null });
    const supabase = createSupabaseMock(builder);

    await getPurchaseStats(supabase);

    const gteCall = (builder.gte as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(gteCall[0]).toBe("purchase_date");
    const fromArg = new Date(gteCall[1] as string);
    expect(fromArg.getDate()).toBe(1); // start of month
  });
});
