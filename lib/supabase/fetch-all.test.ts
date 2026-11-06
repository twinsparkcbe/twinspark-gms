import { describe, expect, it } from "vitest";

import { fetchAllRows } from "./fetch-all";

function source(total: number) {
  const calls: [number, number][] = [];
  const build = () => ({
    range: (from: number, to: number) => {
      calls.push([from, to]);
      const data = Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => from + i);
      return Promise.resolve({ data, error: null });
    },
  });
  return { build, calls };
}

describe("fetchAllRows", () => {
  it("keeps paging past the 1000-row cap until a short page", async () => {
    const { build, calls } = source(2500);
    const rows = await fetchAllRows<number>(build);
    expect(rows).toHaveLength(2500);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("asks for one more page when the total is an exact multiple", async () => {
    const { build, calls } = source(1000);
    expect(await fetchAllRows<number>(build)).toHaveLength(1000);
    expect(calls).toHaveLength(2);
  });

  it("throws the database error", async () => {
    const build = () => ({ range: () => Promise.resolve({ data: null, error: { message: "boom" } }) });
    await expect(fetchAllRows(build)).rejects.toThrow("boom");
  });
});
