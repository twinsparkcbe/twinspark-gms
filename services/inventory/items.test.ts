import { describe, expect, it } from "vitest";

import { createQueryBuilderMock, createSupabaseMock } from "../../test/supabase-query-mock";
import {
  deleteInventoryItem,
  getActiveTrackTyreItem,
  getInventoryItem,
  getInventoryStats,
  InventoryItemHasHistoryError,
  InventoryItemNotFoundError,
  listCustomTypeLabels,
  listInventoryItems,
  listReorderItems,
  updateInventoryItemDetails,
} from "./items";

const validInput = {
  itemType: "TRACK_TYRE" as const,
  productName: "MRF Nylogrip Zapper 100/90-17",
  skuCode: "MRF-ZAP-100-90-17",
  brandId: "b1111111-1111-1111-1111-111111111111",
  lowStockThreshold: 5,
};

const itemRow = {
  id: "item-1",
  item_type: "TRACK_TYRE",
  product_name: validInput.productName,
  sku_code: validInput.skuCode,
  brand_id: validInput.brandId,
  purchase_price: 1500,
  selling_price: 2200,
  available_quantity: 42,
  low_stock_threshold: 5,
  stock_status: "in_stock",
  is_active: true,
  image_url: null,
  custom_type_label: null,
  brands: null,
};

// Item creation moved to services/purchases/item-creation.ts
// (createInventoryItemWithPurchase) — see that file's test for the
// atomic-item-creation coverage that used to live here.
describe("updateInventoryItemDetails", () => {
  // Deliberately never touches price — see doc/inventory-purchase-
  // simplification-scope.md §1.2. available_quantity is also never part of
  // the payload — it can only change via adjustStock().
  it("never sends purchase_price, selling_price, or available_quantity in the update payload", async () => {
    const builder = createQueryBuilderMock({ data: itemRow, error: null });
    const supabase = createSupabaseMock(builder);

    await updateInventoryItemDetails(supabase, "item-1", validInput);

    const updateCall = (builder.update as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(updateCall).not.toHaveProperty("purchase_price");
    expect(updateCall).not.toHaveProperty("selling_price");
    expect(updateCall).not.toHaveProperty("available_quantity");
  });

  it("throws InventoryItemNotFoundError when the item doesn't exist", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(updateInventoryItemDetails(supabase, "missing-id", validInput)).rejects.toBeInstanceOf(
      InventoryItemNotFoundError
    );
  });

  // SKU is optional (for create's auto-generation via the New Item flow),
  // but on edit a blank value must never blank out — or regenerate — the
  // item's existing sku_code. The update payload should simply omit the key.
  it("does not overwrite the existing sku_code when skuCode is left blank", async () => {
    const builder = createQueryBuilderMock({ data: itemRow, error: null });
    const supabase = createSupabaseMock(builder);

    await updateInventoryItemDetails(supabase, "item-1", { ...validInput, skuCode: "" });

    const updateCall = (builder.update as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(updateCall).not.toHaveProperty("sku_code");
  });

  it("sends custom_type_label for an Other Spare Part item", async () => {
    const builder = createQueryBuilderMock({
      data: { ...itemRow, item_type: "OTHER_SPARE_PART", custom_type_label: "Helmet Lock" },
      error: null,
    });
    const supabase = createSupabaseMock(builder);

    await updateInventoryItemDetails(supabase, "item-1", {
      ...validInput,
      itemType: "OTHER_SPARE_PART",
      customTypeLabel: "Helmet Lock",
    });

    const updateCall = (builder.update as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(updateCall.custom_type_label).toBe("Helmet Lock");
  });

  it("sends null custom_type_label for every non-Other-Spare-Part type", async () => {
    const builder = createQueryBuilderMock({ data: itemRow, error: null });
    const supabase = createSupabaseMock(builder);

    await updateInventoryItemDetails(supabase, "item-1", validInput);

    const updateCall = (builder.update as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(updateCall.custom_type_label).toBeNull();
  });

  it("throws DuplicateInventoryItemError for a duplicate SKU", async () => {
    const builder = createQueryBuilderMock({
      data: null,
      error: { code: "23505", message: 'duplicate key value violates unique constraint "inventory_items_sku_code_key"' },
    });
    const supabase = createSupabaseMock(builder);

    await expect(
      updateInventoryItemDetails(supabase, "item-1", { ...validInput, skuCode: "DUPLICATE" })
    ).rejects.toThrow("An item with this SKU / Code already exists.");
  });
});

describe("deleteInventoryItem", () => {
  // INV-014: item with no history can be hard-deleted.
  it("deletes an item with no history", async () => {
    const builder = createQueryBuilderMock({ data: { id: "item-1" }, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(deleteInventoryItem(supabase, "item-1")).resolves.toBeUndefined();
  });

  // INV-015/016: item with purchase/sale history cannot be hard-deleted —
  // Postgres FK "on delete restrict" surfaces as error code 23503.
  it("throws InventoryItemHasHistoryError when the DB blocks the delete (FK restrict)", async () => {
    const builder = createQueryBuilderMock({
      data: null,
      error: { code: "23503", message: "update or delete on table violates foreign key constraint" },
    });
    const supabase = createSupabaseMock(builder);

    await expect(deleteInventoryItem(supabase, "item-1")).rejects.toBeInstanceOf(
      InventoryItemHasHistoryError
    );
  });

  it("throws InventoryItemNotFoundError when the item doesn't exist", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(deleteInventoryItem(supabase, "missing-id")).rejects.toBeInstanceOf(
      InventoryItemNotFoundError
    );
  });
});

describe("getInventoryItem", () => {
  it("throws InventoryItemNotFoundError when no row matches", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(getInventoryItem(supabase, "missing-id")).rejects.toBeInstanceOf(
      InventoryItemNotFoundError
    );
  });

  it("maps custom_type_label to customTypeLabel", async () => {
    const builder = createQueryBuilderMock({
      data: { ...itemRow, item_type: "OTHER_SPARE_PART", custom_type_label: "Helmet Lock" },
      error: null,
    });
    const supabase = createSupabaseMock(builder);

    const result = await getInventoryItem(supabase, "item-1");

    expect(result.customTypeLabel).toBe("Helmet Lock");
  });
});

describe("listInventoryItems — search & filter", () => {
  const emptyResult = { data: [], error: null, count: 0 };

  // INV-019: search matches product name, SKU, or custom type label.
  it("applies a search filter across name, SKU and custom type label", async () => {
    const builder = createQueryBuilderMock(emptyResult);
    const supabase = createSupabaseMock(builder);

    await listInventoryItems(supabase, { search: "pilot", page: 1, pageSize: 20 });

    expect(builder.or).toHaveBeenCalledWith(
      "product_name.ilike.%pilot%,sku_code.ilike.%pilot%,custom_type_label.ilike.%pilot%"
    );
  });

  // INV-020: filter by item type(s) — multi-select, match-ANY via IN.
  it("applies an item type filter via IN", async () => {
    const builder = createQueryBuilderMock(emptyResult);
    const supabase = createSupabaseMock(builder);

    await listInventoryItems(supabase, {
      itemTypes: ["TRACK_TYRE", "CHAIN"],
      page: 1,
      pageSize: 20,
    });

    expect(builder.in).toHaveBeenCalledWith("item_type", ["TRACK_TYRE", "CHAIN"]);
  });

  // INV-022: filter by brand(s) — multi-select, match-ANY via IN.
  it("applies a brand filter via IN", async () => {
    const builder = createQueryBuilderMock(emptyResult);
    const supabase = createSupabaseMock(builder);

    await listInventoryItems(supabase, { brandIds: ["brand-1", "brand-2"], page: 1, pageSize: 20 });

    expect(builder.in).toHaveBeenCalledWith("brand_id", ["brand-1", "brand-2"]);
  });

  // INV-023: filter by stock status — uses the DB's generated stock_status
  // column so pagination/counts stay accurate (not a post-fetch JS filter).
  it("applies a stock status filter", async () => {
    const builder = createQueryBuilderMock(emptyResult);
    const supabase = createSupabaseMock(builder);

    await listInventoryItems(supabase, { stockStatus: "low_stock", page: 1, pageSize: 20 });

    expect(builder.eq).toHaveBeenCalledWith("stock_status", "low_stock");
  });

  it("only returns active items", async () => {
    const builder = createQueryBuilderMock(emptyResult);
    const supabase = createSupabaseMock(builder);

    await listInventoryItems(supabase, { page: 1, pageSize: 20 });

    expect(builder.eq).toHaveBeenCalledWith("is_active", true);
  });
});

describe("listInventoryItems — sorting", () => {
  const emptyResult = { data: [], error: null, count: 0 };

  /**
   * The tripwire. The entire default ordering of the Inventory screen rests on
   * this string comparison being true — `stock_status` is a generated *text*
   * column, so "order descending" only produces urgency order because of how
   * the three statuses happen to be spelled. Rename one and the screen would
   * silently sort healthy stock to the top with nothing else failing.
   */
  it("relies on descending alphabetical order of the status strings being urgency order", () => {
    const sorted = ["in_stock", "low_stock", "out_of_stock"].sort().reverse();
    expect(sorted).toEqual(["out_of_stock", "low_stock", "in_stock"]);
  });

  it("sorts by urgency by default, leading with stock status descending", async () => {
    const builder = createQueryBuilderMock(emptyResult);
    const supabase = createSupabaseMock(builder);

    await listInventoryItems(supabase, { page: 1, pageSize: 20 });

    expect(builder.order).toHaveBeenNthCalledWith(1, "stock_status", { ascending: false });
  });

  it("tie-breaks urgency by lowest quantity, then name", async () => {
    const builder = createQueryBuilderMock(emptyResult);
    const supabase = createSupabaseMock(builder);

    await listInventoryItems(supabase, { sortBy: "urgency", page: 1, pageSize: 20 });

    expect(builder.order).toHaveBeenNthCalledWith(2, "available_quantity", { ascending: true });
    expect(builder.order).toHaveBeenNthCalledWith(3, "product_name", { ascending: true });
  });

  it("no longer defaults to newest-first", async () => {
    const builder = createQueryBuilderMock(emptyResult);
    const supabase = createSupabaseMock(builder);

    await listInventoryItems(supabase, { page: 1, pageSize: 20 });

    expect(builder.order).not.toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("still supports the explicit newest, name and stock sorts", async () => {
    const cases: [Parameters<typeof listInventoryItems>[1]["sortBy"], string, { ascending: boolean }][] = [
      ["newest", "created_at", { ascending: false }],
      ["name", "product_name", { ascending: true }],
      ["stock", "available_quantity", { ascending: true }],
    ];

    for (const [sortBy, column, options] of cases) {
      const builder = createQueryBuilderMock(emptyResult);
      const supabase = createSupabaseMock(builder);

      await listInventoryItems(supabase, { sortBy, page: 1, pageSize: 20 });

      expect(builder.order).toHaveBeenCalledTimes(1);
      expect(builder.order).toHaveBeenCalledWith(column, options);
    }
  });
});

describe("listReorderItems", () => {
  const emptyResult = { data: [], error: null };

  it("returns only items that are out of stock or running low", async () => {
    const builder = createQueryBuilderMock(emptyResult);
    const supabase = createSupabaseMock(builder);

    await listReorderItems(supabase);

    expect(builder.in).toHaveBeenCalledWith("stock_status", ["out_of_stock", "low_stock"]);
    expect(builder.eq).toHaveBeenCalledWith("is_active", true);
  });

  it("puts out-of-stock ahead of low stock, lowest quantity first", async () => {
    const builder = createQueryBuilderMock(emptyResult);
    const supabase = createSupabaseMock(builder);

    await listReorderItems(supabase);

    expect(builder.order).toHaveBeenNthCalledWith(1, "stock_status", { ascending: false });
    expect(builder.order).toHaveBeenNthCalledWith(2, "available_quantity", { ascending: true });
  });

  it("caps the strip at six items by default", async () => {
    const builder = createQueryBuilderMock(emptyResult);
    const supabase = createSupabaseMock(builder);

    await listReorderItems(supabase);

    expect(builder.limit).toHaveBeenCalledWith(6);
  });

  it("honours an explicit limit", async () => {
    const builder = createQueryBuilderMock(emptyResult);
    const supabase = createSupabaseMock(builder);

    await listReorderItems(supabase, 3);

    expect(builder.limit).toHaveBeenCalledWith(3);
  });

  it("cannot be narrowed by the page's search or type filters", async () => {
    // Typing a product name to look something up must not make the reorder
    // strip appear to empty out — so the function takes no filter argument at
    // all, and the only `in`/`eq` calls are its own two constraints.
    const builder = createQueryBuilderMock(emptyResult);
    const supabase = createSupabaseMock(builder);

    await listReorderItems(supabase);

    expect(builder.or).not.toHaveBeenCalled();
    expect(builder.in).toHaveBeenCalledTimes(1);
    expect(builder.eq).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list when nothing needs reordering, so the strip just hides", async () => {
    const builder = createQueryBuilderMock(emptyResult);
    const supabase = createSupabaseMock(builder);

    expect(await listReorderItems(supabase)).toEqual([]);
  });

  it("throws on a Supabase error", async () => {
    const builder = createQueryBuilderMock({ data: null, error: { message: "reorder query failed" } });
    const supabase = createSupabaseMock(builder);

    await expect(listReorderItems(supabase)).rejects.toThrow("reorder query failed");
  });
});

describe("listCustomTypeLabels", () => {
  it("returns distinct, trimmed, sorted labels", async () => {
    const builder = createQueryBuilderMock({
      data: [
        { custom_type_label: "Seat Cover" },
        { custom_type_label: "Helmet Lock" },
        { custom_type_label: " Seat Cover " },
        { custom_type_label: null },
      ],
      error: null,
    });
    const supabase = createSupabaseMock(builder);

    const result = await listCustomTypeLabels(supabase);

    expect(result).toEqual(["Helmet Lock", "Seat Cover"]);
    expect(builder.eq).toHaveBeenCalledWith("item_type", "OTHER_SPARE_PART");
  });
});

describe("getActiveTrackTyreItem", () => {
  // Track Tyre Front and Back are each their own singleton, scoped by exact
  // product name — the New Item flow (Purchases) uses this to detect
  // whether the picked position already exists before deciding to restock
  // it instead of inserting a second row.
  it("returns null when no active item exists for that exact name", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    const result = await getActiveTrackTyreItem(supabase, "Track Tyre - Front");

    expect(result).toBeNull();
  });

  it("returns the mapped row when an active item exists for that exact name", async () => {
    const builder = createQueryBuilderMock({
      data: {
        id: "track-tyre-front-1",
        item_type: "TRACK_TYRE",
        product_name: "Track Tyre - Front",
        sku_code: "SKU-00001",
        brand_id: validInput.brandId,
        purchase_price: 1000,
        selling_price: 1500,
        available_quantity: 12,
        low_stock_threshold: 10,
        stock_status: "in_stock",
        is_active: true,
        image_url: null,
        custom_type_label: null,
        brands: { name: "Track Tyre" },
      },
      error: null,
    });
    const supabase = createSupabaseMock(builder);

    const result = await getActiveTrackTyreItem(supabase, "Track Tyre - Front");

    expect(result).not.toBeNull();
    expect(result?.id).toBe("track-tyre-front-1");
    expect(result?.skuCode).toBe("SKU-00001");
    expect(result?.availableQuantity).toBe(12);
  });

  it("queries only active Track Tyre items with that exact product name, newest first", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await getActiveTrackTyreItem(supabase, "Track Tyre - Back");

    expect(builder.eq).toHaveBeenCalledWith("item_type", "TRACK_TYRE");
    expect(builder.eq).toHaveBeenCalledWith("product_name", "Track Tyre - Back");
    expect(builder.eq).toHaveBeenCalledWith("is_active", true);
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(1);
  });

  // An active Front item must never block detecting/creating Back, and vice
  // versa — each position is queried independently by exact name.
  it("does not match a different position's product name", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await getActiveTrackTyreItem(supabase, "Track Tyre - Back");

    expect(builder.eq).not.toHaveBeenCalledWith("product_name", "Track Tyre - Front");
  });
});

// FIFO batch tracking (0010_purchase_batch_fifo.sql): Inventory Value sums
// each batch's remaining_quantity × its own unit_price instead of one flat
// purchase_price × available_quantity — see items.ts's getInventoryStats.
describe("getInventoryStats", () => {
  it("sums remaining_quantity * unit_price across all of an item's batches", async () => {
    // getInventoryStats fires 4 queries via Promise.all, in this order:
    // total count, low-stock count, out-of-stock count, then the batch
    // value rows. Each .from() call happens synchronously in that order
    // even though the awaits resolve concurrently, so a call-order queue
    // reliably maps each canned result to the right query.
    const results = [
      { data: null, error: null, count: 3 },
      { data: null, error: null, count: 1 },
      { data: null, error: null, count: 0 },
      {
        data: [
          { remaining_quantity: 38, unit_price: 1000 }, // 50 bought, 12 sold/returned
          { remaining_quantity: 30, unit_price: 900 },
        ],
        error: null,
      },
    ];
    let call = 0;
    const supabase = {
      from: () => createQueryBuilderMock(results[call++]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const stats = await getInventoryStats(supabase);

    expect(stats.totalProducts).toBe(3);
    expect(stats.lowStock).toBe(1);
    expect(stats.outOfStock).toBe(0);
    // 38*1000 + 30*900 = 38000 + 27000 = 65000
    expect(stats.inventoryValueCost).toBe(65000);
  });

  it("returns zero inventory value when there are no batches", async () => {
    const results = [
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: [], error: null },
    ];
    let call = 0;
    const supabase = {
      from: () => createQueryBuilderMock(results[call++]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const stats = await getInventoryStats(supabase);
    expect(stats.inventoryValueCost).toBe(0);
  });
});
