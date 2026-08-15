import { describe, expect, it } from "vitest";

import { createQueryBuilderMock } from "../../test/supabase-query-mock";
import { getRevenueTrend } from "./revenue";

// Fixed "today" — same fixture date used by Dashboard's trend tests.
const NOW = new Date("2026-07-29T10:00:00.000Z");

function mockTwoQueries(salesResult: { data: unknown; error: unknown }, serviceResult: { data: unknown; error: unknown }) {
  const results = [salesResult, serviceResult];
  let call = 0;
  return {
    from: () => createQueryBuilderMock(results[call++] as never),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("getRevenueTrend", () => {
  it("buckets Sales grand_total by sale_date into the correct bucket", async () => {
    const sales = [{ grand_total: 5000, sale_date: NOW.toISOString() }];
    const supabase = mockTwoQueries({ data: sales, error: null }, { data: [], error: null });

    const points = await getRevenueTrend(supabase, "daily", NOW);

    expect(points).toHaveLength(14);
    expect(points[13].salesAmount).toBe(5000); // today's bucket
    expect(points.reduce((sum, p) => sum + p.salesAmount, 0)).toBe(5000);
  });

  it("buckets completed Service grand_total by completed_at, excluding non-COMPLETED jobs at the query level", async () => {
    const serviceJobs = [{ grand_total: 1200, completed_at: NOW.toISOString() }];
    const supabase = mockTwoQueries({ data: [], error: null }, { data: serviceJobs, error: null });

    const points = await getRevenueTrend(supabase, "daily", NOW);

    expect(points[13].serviceAmount).toBe(1200);
  });

  it("excludes a row whose date falls outside the requested window", async () => {
    const wayOld = [{ grand_total: 9999, sale_date: "2020-01-01T00:00:00.000Z" }];
    const supabase = mockTwoQueries({ data: wayOld, error: null }, { data: [], error: null });

    const points = await getRevenueTrend(supabase, "daily", NOW);

    expect(points.reduce((sum, p) => sum + p.salesAmount, 0)).toBe(0);
  });

  it("returns zero-filled buckets for an empty period, not missing entries", async () => {
    const supabase = mockTwoQueries({ data: [], error: null }, { data: [], error: null });

    const points = await getRevenueTrend(supabase, "monthly", NOW);

    expect(points).toHaveLength(6);
    expect(points.every((p) => p.salesAmount === 0 && p.serviceAmount === 0)).toBe(true);
  });

  it("throws when the sales query errors", async () => {
    const supabase = mockTwoQueries({ data: null, error: { message: "boom" } }, { data: [], error: null });

    await expect(getRevenueTrend(supabase, "daily", NOW)).rejects.toThrow("boom");
  });

  it("throws when the service_jobs query errors", async () => {
    const supabase = mockTwoQueries({ data: [], error: null }, { data: null, error: { message: "boom" } });

    await expect(getRevenueTrend(supabase, "daily", NOW)).rejects.toThrow("boom");
  });
});
