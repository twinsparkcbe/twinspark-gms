import { describe, expect, it } from "vitest";

import { createQueryBuilderMock, createSupabaseMock } from "../../test/supabase-query-mock";
import { listStockMovements } from "./movements";

const movementRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "mv-1",
  delta: -2,
  resulting_balance: 38,
  reason: "SALE",
  source_module: "sales",
  note: null,
  created_at: "2026-08-11T09:15:00.000Z",
  ...overrides,
});

describe("listStockMovements", () => {
  const emptyResult = { data: [], error: null };

  it("scopes the history to the requested item", async () => {
    const builder = createQueryBuilderMock(emptyResult);
    const supabase = createSupabaseMock(builder);

    await listStockMovements(supabase, "item-42");

    expect(builder.eq).toHaveBeenCalledWith("inventory_item_id", "item-42");
  });

  it("returns the newest movement first", async () => {
    const builder = createQueryBuilderMock(emptyResult);
    const supabase = createSupabaseMock(builder);

    await listStockMovements(supabase, "item-42");

    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("caps at twenty entries by default — recent history, not an audit log", async () => {
    const builder = createQueryBuilderMock(emptyResult);
    const supabase = createSupabaseMock(builder);

    await listStockMovements(supabase, "item-42");

    expect(builder.limit).toHaveBeenCalledWith(20);
  });

  it("honours an explicit limit", async () => {
    const builder = createQueryBuilderMock(emptyResult);
    const supabase = createSupabaseMock(builder);

    await listStockMovements(supabase, "item-42", 5);

    expect(builder.limit).toHaveBeenCalledWith(5);
  });

  it("maps snake_case columns to camelCase and keeps the delta signed", async () => {
    const builder = createQueryBuilderMock({
      data: [movementRow({ delta: -2 }), movementRow({ id: "mv-2", delta: 10, resulting_balance: 40, reason: "PURCHASE", source_module: "purchases", note: "Batch #12" })],
      error: null,
    });
    const supabase = createSupabaseMock(builder);

    const movements = await listStockMovements(supabase, "item-42");

    expect(movements[0]).toEqual({
      id: "mv-1",
      delta: -2,
      resultingBalance: 38,
      reason: "SALE",
      sourceModule: "sales",
      note: null,
      createdAt: "2026-08-11T09:15:00.000Z",
    });
    expect(movements[1].delta).toBe(10);
    expect(movements[1].note).toBe("Batch #12");
  });

  it("returns an empty list for an item with no movements", async () => {
    const builder = createQueryBuilderMock(emptyResult);
    const supabase = createSupabaseMock(builder);

    expect(await listStockMovements(supabase, "item-new")).toEqual([]);
  });

  it("throws on a Supabase error", async () => {
    const builder = createQueryBuilderMock({ data: null, error: { message: "history unavailable" } });
    const supabase = createSupabaseMock(builder);

    await expect(listStockMovements(supabase, "item-42")).rejects.toThrow("history unavailable");
  });
});
