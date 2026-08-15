import { describe, expect, it } from "vitest";

import { createQueryBuilderMock } from "../../test/supabase-query-mock";
import { getTrackTyreSalesTrend } from "./trend";

// Fixed "today" for every test — 29 Jul 2026, 10:00 UTC = 15:30 IST, so the
// IST calendar day is unambiguously 29 Jul 2026 (no midnight-boundary edge
// case to worry about in these fixtures).
const NOW = new Date("2026-07-29T10:00:00.000Z");

function mockTwoQueries(saleItemsResult: { data: unknown; error: unknown }, onlineOrdersResult: { data: unknown; error: unknown }) {
  const results = [saleItemsResult, onlineOrdersResult];
  let call = 0;
  return {
    from: () => createQueryBuilderMock(results[call++] as never),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("getTrackTyreSalesTrend — bucket shape", () => {
  it("daily: returns 14 buckets, oldest to newest, ending on today", async () => {
    const supabase = mockTwoQueries({ data: [], error: null }, { data: [], error: null });
    const points = await getTrackTyreSalesTrend(supabase, "daily", NOW);

    expect(points).toHaveLength(14);
    expect(points[13].label).toBe("29 Jul"); // today
    expect(points[0].label).toBe("16 Jul"); // 13 days before today
    expect(points.every((p) => p.unitsSold === 0)).toBe(true);
  });

  it("weekly: returns 8 buckets", async () => {
    const supabase = mockTwoQueries({ data: [], error: null }, { data: [], error: null });
    const points = await getTrackTyreSalesTrend(supabase, "weekly", NOW);
    expect(points).toHaveLength(8);
  });

  it("monthly: returns 6 buckets, ending on the current month", async () => {
    const supabase = mockTwoQueries({ data: [], error: null }, { data: [], error: null });
    const points = await getTrackTyreSalesTrend(supabase, "monthly", NOW);

    expect(points).toHaveLength(6);
    expect(points[5].fullLabel).toBe("Jul 2026");
    expect(points[0].fullLabel).toBe("Feb 2026"); // 5 months before July
  });
});

describe("getTrackTyreSalesTrend — combining channels", () => {
  it("sums in-store Sales quantity and Dispatched Online Order quantity (Front+Back combined) into today's bucket", async () => {
    const saleItemsData = [{ quantity: 3, sales: { sale_date: NOW.toISOString() } }];
    const onlineOrdersData = [{ quantity_front: 2, quantity_back: 1, dispatched_at: NOW.toISOString() }];

    const supabase = mockTwoQueries({ data: saleItemsData, error: null }, { data: onlineOrdersData, error: null });
    const points = await getTrackTyreSalesTrend(supabase, "daily", NOW);

    // 3 (in-store) + 2 + 1 (online, front+back combined) = 6, all landing in
    // today's bucket since both rows are dated exactly `now`.
    expect(points[13].unitsSold).toBe(6);
    expect(points.reduce((sum, p) => sum + p.unitsSold, 0)).toBe(6);
  });

  it("handles the embedded sales relationship as an array (defensive, mirrors firstOrSelf elsewhere)", async () => {
    const saleItemsData = [{ quantity: 5, sales: [{ sale_date: NOW.toISOString() }] }];
    const supabase = mockTwoQueries({ data: saleItemsData, error: null }, { data: [], error: null });

    const points = await getTrackTyreSalesTrend(supabase, "daily", NOW);
    expect(points[13].unitsSold).toBe(5);
  });

  it("ignores a row whose date falls outside the requested range", async () => {
    const farInThePast = "2020-01-01T00:00:00.000Z";
    const saleItemsData = [
      { quantity: 100, sales: { sale_date: farInThePast } },
      { quantity: 4, sales: { sale_date: NOW.toISOString() } },
    ];
    const supabase = mockTwoQueries({ data: saleItemsData, error: null }, { data: [], error: null });

    const points = await getTrackTyreSalesTrend(supabase, "daily", NOW);
    expect(points.reduce((sum, p) => sum + p.unitsSold, 0)).toBe(4);
  });

  it("ignores an online order with no dispatched_at (not yet dispatched)", async () => {
    const onlineOrdersData = [{ quantity_front: 2, quantity_back: 0, dispatched_at: null }];
    const supabase = mockTwoQueries({ data: [], error: null }, { data: onlineOrdersData, error: null });

    const points = await getTrackTyreSalesTrend(supabase, "daily", NOW);
    expect(points.reduce((sum, p) => sum + p.unitsSold, 0)).toBe(0);
  });
});

describe("getTrackTyreSalesTrend — errors", () => {
  it("throws if the sale_items query errors", async () => {
    const supabase = mockTwoQueries({ data: null, error: { message: "sale_items failed" } }, { data: [], error: null });
    await expect(getTrackTyreSalesTrend(supabase, "daily", NOW)).rejects.toThrow("sale_items failed");
  });

  it("throws if the online_orders query errors", async () => {
    const supabase = mockTwoQueries({ data: [], error: null }, { data: null, error: { message: "online_orders failed" } });
    await expect(getTrackTyreSalesTrend(supabase, "daily", NOW)).rejects.toThrow("online_orders failed");
  });
});
