import { describe, expect, it } from "vitest";

import { createQueryBuilderMock } from "../../test/supabase-query-mock";
import { getProfitTrend } from "./profit";

const NOW = new Date("2026-07-29T10:00:00.000Z");

type Result = { data: unknown; error: unknown };
const EMPTY: Result = { data: [], error: null };

/**
 * Queued in the order getProfitTrend fires them: sales, online, service, COGS.
 * Service defaults to empty so the existing cases stay about what they were
 * written to test; the service cases pass it explicitly.
 */
function mockTwoQueries(
  salesResult: Result,
  cogsResult: Result,
  onlineResult: Result = EMPTY,
  serviceResult: Result = EMPTY
) {
  const results = [salesResult, onlineResult, serviceResult, cogsResult];
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

describe("getProfitTrend — online orders", () => {
  // Revenue and cost must move together: an online dispatch that added its
  // sale price but not its cost would overstate profit, which is exactly the
  // failure mode that made this change necessary.
  it("counts dispatched online revenue and its ONLINE_ORDER_DISPATCH cost in the same bucket", async () => {
    const online = [{ total_amount: 4500, dispatched_at: NOW.toISOString() }];
    const cogsRows = [{ delta: -2, created_at: NOW.toISOString(), purchase_entries: { unit_price: 1500 } }];
    const supabase = mockTwoQueries(
      { data: [], error: null },
      { data: cogsRows, error: null },
      { data: online, error: null }
    );

    const points = await getProfitTrend(supabase, "daily", NOW);

    expect(points[13].onlineAmount).toBe(4500);
    expect(points[13].cogs).toBe(3000);
    expect(points[13].profit).toBe(1500);
    // Kept out of salesAmount so that column still reconciles with the Sales Report.
    expect(points[13].salesAmount).toBe(0);
  });

  it("adds Sales and Online together in profit", async () => {
    const sales = [{ grand_total: 2000, sale_date: NOW.toISOString() }];
    const online = [{ total_amount: 3000, dispatched_at: NOW.toISOString() }];
    const supabase = mockTwoQueries(
      { data: sales, error: null },
      { data: [], error: null },
      { data: online, error: null }
    );

    const points = await getProfitTrend(supabase, "daily", NOW);

    expect(points[13].profit).toBe(5000);
  });

  it("buckets Service revenue by completed_at and adds it to profit", async () => {
    const service = [{ grand_total: 4000, completed_at: NOW.toISOString() }];
    const supabase = mockTwoQueries(EMPTY, EMPTY, EMPTY, { data: service, error: null });

    const points = await getProfitTrend(supabase, "daily", NOW);

    expect(points[13].serviceAmount).toBe(4000);
    expect(points[13].profit).toBe(4000);
  });

  it("counts all three channels against one Cost of Goods Sold", async () => {
    const sales = [{ grand_total: 1000, sale_date: NOW.toISOString() }];
    const online = [{ total_amount: 500, dispatched_at: NOW.toISOString() }];
    const service = [{ grand_total: 4000, completed_at: NOW.toISOString() }];
    const cogsRows = [{ delta: -2, created_at: NOW.toISOString(), purchase_entries: { unit_price: 900 } }];
    const supabase = mockTwoQueries(
      { data: sales, error: null },
      { data: cogsRows, error: null },
      { data: online, error: null },
      { data: service, error: null }
    );

    const points = await getProfitTrend(supabase, "daily", NOW);

    // 1000 + 500 + 4000 - 1800
    expect(points[13].profit).toBe(3700);
  });

  it("skips a completed job with no completed_at rather than bucketing it wrongly", async () => {
    const service = [{ grand_total: 4000, completed_at: null }];
    const supabase = mockTwoQueries(EMPTY, EMPTY, EMPTY, { data: service, error: null });

    const points = await getProfitTrend(supabase, "daily", NOW);

    expect(points.every((p) => p.serviceAmount === 0)).toBe(true);
  });
});
