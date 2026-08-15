import { describe, expect, it } from "vitest";

import { createQueryBuilderMock, createSupabaseMock } from "../../test/supabase-query-mock";

import { getFrequentServices, rankByUsage, toUsageCounts, type RankableLine } from "./frequent";
import { pickerKey } from "./picker";

const PKG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SVC_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SVC_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const ALL_ACTIVE = new Set([pickerKey("PACKAGE", PKG_A), pickerKey("SPECIFIC", SVC_A), pickerKey("SPECIFIC", SVC_B)]);

function packageLine(name = "Standard Service"): RankableLine {
  return { lineType: "PACKAGE", generalServicePackageId: PKG_A, specificServiceId: null, description: name };
}

function specificLine(id: string, name: string): RankableLine {
  return { lineType: "SPECIFIC", generalServicePackageId: null, specificServiceId: id, description: name };
}

function customLine(name = "Fork Seal Replacement"): RankableLine {
  return { lineType: "CUSTOM", generalServicePackageId: null, specificServiceId: null, description: name };
}

describe("rankByUsage", () => {
  it("orders by how often each service was billed, most-used first", () => {
    const result = rankByUsage(
      [specificLine(SVC_A, "Chain Cleaning"), specificLine(SVC_A, "Chain Cleaning"), specificLine(SVC_B, "Brake Bleeding")],
      { activeKeys: ALL_ACTIVE }
    );

    expect(result.map((r) => r.name)).toEqual(["Chain Cleaning", "Brake Bleeding"]);
    expect(result[0].usageCount).toBe(2);
  });

  it("breaks ties alphabetically so chip order is stable between page loads", () => {
    const result = rankByUsage([specificLine(SVC_B, "Water Wash"), specificLine(SVC_A, "Brake Bleeding")], { activeKeys: ALL_ACTIVE });

    expect(result.map((r) => r.name)).toEqual(["Brake Bleeding", "Water Wash"]);
  });

  it("excludes custom lines — there's no catalog entry for a chip to re-add", () => {
    const result = rankByUsage([customLine(), customLine(), specificLine(SVC_A, "Chain Cleaning")], { activeKeys: ALL_ACTIVE });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Chain Cleaning");
  });

  it("excludes deactivated catalog entries however often they were billed", () => {
    const activeKeys = new Set([pickerKey("SPECIFIC", SVC_B)]);
    const result = rankByUsage([specificLine(SVC_A, "Retired Service"), specificLine(SVC_A, "Retired Service"), specificLine(SVC_B, "Water Wash")], {
      activeKeys,
    });

    expect(result.map((r) => r.name)).toEqual(["Water Wash"]);
  });

  it("counts packages and specific services separately, tagged by kind", () => {
    const result = rankByUsage([packageLine(), specificLine(SVC_A, "Chain Cleaning")], { activeKeys: ALL_ACTIVE });

    expect(result.map((r) => r.kind).sort()).toEqual(["PACKAGE", "SPECIFIC"]);
  });

  it("skips a line whose catalog id is missing (shouldn't happen, must not crash)", () => {
    const broken: RankableLine = { lineType: "SPECIFIC", generalServicePackageId: null, specificServiceId: null, description: "Orphan" };

    expect(rankByUsage([broken], { activeKeys: ALL_ACTIVE })).toEqual([]);
  });

  it("respects the chip limit", () => {
    const result = rankByUsage([packageLine(), specificLine(SVC_A, "Chain Cleaning"), specificLine(SVC_B, "Brake Bleeding")], {
      activeKeys: ALL_ACTIVE,
      limit: 2,
    });

    expect(result).toHaveLength(2);
  });

  it("returns nothing on a fresh install with no history — the chip row simply hides", () => {
    expect(rankByUsage([], { activeKeys: ALL_ACTIVE })).toEqual([]);
  });
});

describe("toUsageCounts", () => {
  it("maps the ranking into counts keyed the same way as the picker index", () => {
    const ranked = rankByUsage([specificLine(SVC_A, "Chain Cleaning"), specificLine(SVC_A, "Chain Cleaning")], { activeKeys: ALL_ACTIVE });

    expect(toUsageCounts(ranked)).toEqual({ [pickerKey("SPECIFIC", SVC_A)]: 2 });
  });

  it("returns an empty lookup for an empty ranking", () => {
    expect(toUsageCounts([])).toEqual({});
  });
});

describe("getFrequentServices", () => {
  it("queries service_job_lines filtered to COMPLETED jobs only", async () => {
    const builder = createQueryBuilderMock({
      data: [
        { line_type: "SPECIFIC", general_service_package_id: null, specific_service_id: SVC_A, description: "Chain Cleaning", service_jobs: { status: "COMPLETED" } },
      ],
      error: null,
    });
    const supabase = createSupabaseMock(builder);

    const result = await getFrequentServices(supabase, { activeKeys: ALL_ACTIVE });

    expect(supabase.from).toHaveBeenCalledWith("service_job_lines");
    expect(builder.eq).toHaveBeenCalledWith("service_jobs.status", "COMPLETED");
    expect(result).toEqual([{ key: pickerKey("SPECIFIC", SVC_A), kind: "SPECIFIC", id: SVC_A, name: "Chain Cleaning", usageCount: 1 }]);
  });

  it("limits the lookback window so the chips follow what the shop does now", async () => {
    const builder = createQueryBuilderMock({ data: [], error: null });
    const supabase = createSupabaseMock(builder);

    await getFrequentServices(supabase, { activeKeys: ALL_ACTIVE });

    expect(builder.gte).toHaveBeenCalledWith("created_at", expect.any(String));
  });

  it("returns an empty list when there's no completed history yet", async () => {
    const supabase = createSupabaseMock(createQueryBuilderMock({ data: [], error: null }));

    expect(await getFrequentServices(supabase, { activeKeys: ALL_ACTIVE })).toEqual([]);
  });

  it("throws the underlying error rather than silently returning nothing", async () => {
    const supabase = createSupabaseMock(createQueryBuilderMock({ data: null, error: { message: "boom" } }));

    await expect(getFrequentServices(supabase, { activeKeys: ALL_ACTIVE })).rejects.toThrow("boom");
  });
});
