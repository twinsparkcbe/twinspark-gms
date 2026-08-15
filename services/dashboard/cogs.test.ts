import { describe, expect, it } from "vitest";

import { createQueryBuilderMock } from "../../test/supabase-query-mock";
import { getCostOfGoodsSold } from "./cogs";

const RANGE = { from: new Date("2026-07-01T00:00:00.000Z"), to: new Date("2026-07-31T23:59:59.999Z") };

function mockStockMovements(data: unknown, error: { message: string } | null = null) {
  return { from: () => createQueryBuilderMock({ data, error }) } as unknown as Parameters<typeof getCostOfGoodsSold>[0];
}

describe("getCostOfGoodsSold", () => {
  it("sums quantity * batch unit_price across every SALE movement, flipping the negative delta to a positive cost", async () => {
    const supabase = mockStockMovements([
      { delta: -2, purchase_entries: { unit_price: 1000 } }, // 2 units @ ₹1000 = ₹2000
      { delta: -1, purchase_entries: { unit_price: 1500 } }, // 1 unit @ ₹1500 = ₹1500
    ]);

    const cogs = await getCostOfGoodsSold(supabase, RANGE);
    expect(cogs).toBe(3500);
  });

  it("also sums SERVICE_USAGE movements (parts consumed by completed Service Jobs), same FIFO math as SALE", async () => {
    // A row's reason isn't part of the returned columns — the query itself
    // filters to SALE + SERVICE_USAGE, so any row the mock returns is one of
    // the two, and the aggregation math is identical either way.
    const supabase = mockStockMovements([
      { delta: -1, purchase_entries: { unit_price: 1000 } }, // sale
      { delta: -2, purchase_entries: { unit_price: 300 } }, // service part usage
    ]);

    const cogs = await getCostOfGoodsSold(supabase, RANGE);
    expect(cogs).toBe(1600);
  });

  it("filters stock_movements to reason IN ('SALE', 'SERVICE_USAGE'), not SALE alone", async () => {
    const builder = createQueryBuilderMock({ data: [], error: null });
    const supabase = { from: () => builder } as unknown as Parameters<typeof getCostOfGoodsSold>[0];

    await getCostOfGoodsSold(supabase, RANGE);

    expect(builder.in).toHaveBeenCalledWith("reason", ["SALE", "SERVICE_USAGE"]);
  });

  it("handles a single SALE split across two FIFO batches (same sale, two movement rows)", async () => {
    // e.g. selling 5 units where only 3 remained in the oldest batch —
    // adjust_stock()'s FIFO loop inserts one movement per batch touched.
    const supabase = mockStockMovements([
      { delta: -3, purchase_entries: { unit_price: 900 } }, // 2700
      { delta: -2, purchase_entries: { unit_price: 950 } }, // 1900
    ]);

    const cogs = await getCostOfGoodsSold(supabase, RANGE);
    expect(cogs).toBe(4600);
  });

  it("handles the embedded purchase_entries relationship as an array (defensive, mirrors firstOrSelf elsewhere)", async () => {
    const supabase = mockStockMovements([{ delta: -4, purchase_entries: [{ unit_price: 500 }] }]);
    const cogs = await getCostOfGoodsSold(supabase, RANGE);
    expect(cogs).toBe(2000);
  });

  it("skips a row with no matching batch rather than throwing", async () => {
    const supabase = mockStockMovements([
      { delta: -2, purchase_entries: null },
      { delta: -1, purchase_entries: { unit_price: 700 } },
    ]);
    const cogs = await getCostOfGoodsSold(supabase, RANGE);
    expect(cogs).toBe(700);
  });

  it("returns 0 when nothing was sold in the range", async () => {
    const supabase = mockStockMovements([]);
    const cogs = await getCostOfGoodsSold(supabase, RANGE);
    expect(cogs).toBe(0);
  });

  it("throws on a Supabase error", async () => {
    const supabase = mockStockMovements(null, { message: "stock_movements query failed" });
    await expect(getCostOfGoodsSold(supabase, RANGE)).rejects.toThrow("stock_movements query failed");
  });
});
