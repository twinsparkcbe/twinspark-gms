import { describe, expect, it } from "vitest";

import { createQueryBuilderMock } from "../../test/supabase-query-mock";
import { getProfitTrend } from "./profit";

const NOW = new Date("2026-07-29T10:00:00.000Z");

function mockTwoQueries(salesResult: { data: unknown; error: unknown }, cogsResult: { data: unknown; error: unknown }) {
  const results = [salesResult, cogsResult];
  let call = 0;
  return {
    from: () => createQueryBuilderMock(results[call++] as never),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("getProfitTrend", () => {
  it("buckets Sales grand_total by sale_date", async () => {
    const sales = [{ grand_total: 5000, sale_date: NOW.toISOString() }];
    const supabase = mockTwoQueries({ data: sales, error: null }, { data: [], error: null });

    const points = await getProfitTrend(supabase, "daily", NOW);

    expect(points[13].salesAmount).toBe(5000);
  });

  it("buckets Cost of Goods Sold from stock_movements (reason='SALE'), flipping delta's sign to a positive cost", async () => {
    const cogsRows = [{ delta: -2, created_at: NOW.toISOString(), purchase_entries: { unit_price: 900 } }];
    const supabase = mockTwoQueries({ data: [], error: null }, { data: cogsRows, error: null });

    const points = await getProfitTrend(supabase, "daily", NOW);

    expect(points[13].cogs).toBe(1800); // 2 * 900
  });

  it("computes profit = salesAmount - cogs per bucket, allowed to go negative", async () => {
    const sales = [{ grand_total: 1000, sale_date: NOW.toISOString() }];
    const cogsRows = [{ delta: -2, created_at: NOW.toISOString(), purchase_entries: { unit_price: 900 } }]; // cogs = 1800
    const supabase = mockTwoQueries({ data: sales, error: null }, { data: cogsRows, error: null });

    const points = await getProfitTrend(supabase, "daily", NOW);

    expect(points[13].profit).toBe(1000 - 1800);
    expect(points[13].profit).toBeLessThan(0);
  });

  it("skips a stock_movements row with no matching purchase batch rather than throwing", async () => {
    const cogsRows = [{ delta: -1, created_at: NOW.toISOString(), purchase_entries: null }];
    const supabase = mockTwoQueries({ data: [], error: null }, { data: cogsRows, error: null });

    const points = await getProfitTrend(supabase, "daily", NOW);

    expect(points[13].cogs).toBe(0);
  });

  it("returns zero-filled buckets for an empty period", async () => {
    const supabase = mockTwoQueries({ data: [], error: null }, { data: [], error: null });

    const points = await getProfitTrend(supabase, "weekly", NOW);

    expect(points).toHaveLength(8);
    expect(points.every((p) => p.salesAmount === 0 && p.cogs === 0 && p.profit === 0)).toBe(true);
  });

  it("throws when the sales query errors", async () => {
    const supabase = mockTwoQueries({ data: null, error: { message: "boom" } }, { data: [], error: null });

    await expect(getProfitTrend(supabase, "daily", NOW)).rejects.toThrow("boom");
  });

  it("throws when the stock_movements query errors", async () => {
    const supabase = mockTwoQueries({ data: [], error: null }, { data: null, error: { message: "boom" } });

    await expect(getProfitTrend(supabase, "daily", NOW)).rejects.toThrow("boom");
  });
});
