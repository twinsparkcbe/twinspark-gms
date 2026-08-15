import { describe, expect, it } from "vitest";

import { createQueryBuilderMock, createSupabaseMock } from "../../test/supabase-query-mock";
import { listAgeingStock } from "./ageing-stock";

// Fixed "now" so "6 months old" is unambiguous in every test.
const NOW = new Date("2026-08-02T10:00:00.000Z");

function batch(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    inventory_item_id: "item-1",
    remaining_quantity: 4,
    unit_price: 1200,
    purchase_date: "2026-01-15T00:00:00.000Z", // ~6.5 months before NOW
    inventory_items: {
      product_name: "MRF Zapper",
      sku_code: "TYRE-001",
      item_type: "BRAND_NEW_TYRE",
      custom_type_label: null,
      brand_id: "brand-1",
      brands: { name: "MRF" },
    },
    ...overrides,
  };
}

describe("listAgeingStock", () => {
  it("includes an item whose oldest unsold batch is older than the threshold", async () => {
    const builder = createQueryBuilderMock({ data: [batch()], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listAgeingStock(supabase, 6, NOW);

    expect(builder.gt).toHaveBeenCalledWith("remaining_quantity", 0);
    expect(builder.order).toHaveBeenCalledWith("purchase_date", { ascending: true });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      inventoryItemId: "item-1",
      itemName: "MRF Zapper",
      brandName: "MRF",
      remainingQuantity: 4,
      unitPrice: 1200,
    });
  });

  it("excludes an item whose oldest unsold batch is within the threshold", async () => {
    const recentBatch = batch({ purchase_date: "2026-07-20T00:00:00.000Z" }); // ~2 weeks before NOW
    const builder = createQueryBuilderMock({ data: [recentBatch], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listAgeingStock(supabase, 6, NOW);

    expect(result).toEqual([]);
  });

  it("uses the oldest unsold batch when an item has more than one, not the newest", async () => {
    const older = batch({ purchase_date: "2025-11-01T00:00:00.000Z", remaining_quantity: 2 });
    const newer = batch({ purchase_date: "2026-06-01T00:00:00.000Z", remaining_quantity: 6 });
    // Query is ordered oldest-first — the older row must come first in the fixture too.
    const builder = createQueryBuilderMock({ data: [older, newer], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listAgeingStock(supabase, 6, NOW);

    expect(result).toHaveLength(1);
    expect(result[0].oldestBatchDate).toBe("2025-11-01T00:00:00.000Z");
    expect(result[0].remainingQuantity).toBe(2);
  });

  it("is sorted oldest-first across multiple items", async () => {
    const item1 = batch({ inventory_item_id: "item-1", purchase_date: "2025-10-01T00:00:00.000Z" });
    const item2 = batch({ inventory_item_id: "item-2", purchase_date: "2025-06-01T00:00:00.000Z" });
    const builder = createQueryBuilderMock({ data: [item2, item1], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listAgeingStock(supabase, 6, NOW);

    expect(result.map((r) => r.inventoryItemId)).toEqual(["item-2", "item-1"]);
  });

  it("returns an empty array when nothing qualifies", async () => {
    const builder = createQueryBuilderMock({ data: [], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listAgeingStock(supabase, 6, NOW);

    expect(result).toEqual([]);
  });

  it("throws on a Supabase error", async () => {
    const builder = createQueryBuilderMock({ data: null, error: { message: "boom" } });
    const supabase = createSupabaseMock(builder);

    await expect(listAgeingStock(supabase, 6, NOW)).rejects.toThrow("boom");
  });
});
