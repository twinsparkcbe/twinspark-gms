import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/sales", () => ({ getSalesStats: vi.fn() }));
vi.mock("@/services/purchases", () => ({ getPurchaseStats: vi.fn() }));
vi.mock("@/services/service", () => ({ getServiceStats: vi.fn() }));
vi.mock("@/services/reports", () => ({ getCollectionsReport: vi.fn() }));
vi.mock("./cogs", () => ({ getCostOfGoodsSold: vi.fn() }));

import { getSalesStats } from "@/services/sales";
import { getPurchaseStats } from "@/services/purchases";
import { getServiceStats } from "@/services/service";
import { getCollectionsReport } from "@/services/reports";
import { getCostOfGoodsSold } from "./cogs";

import { createQueryBuilderMock } from "../../test/supabase-query-mock";
import { istMidnightUTC, istParts } from "./ist-dates";
import { getDashboardStats, getOpenWorkCounts, getStockAlerts, getTrackTyreStock } from "./stats";

const trackTyreRow = (productName: string, quantity: number) => ({
  product_name: productName,
  available_quantity: quantity,
});

/** Supabase mock that returns each queued result in `from()` call order. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sequencedSupabase(results: unknown[]): any {
  let call = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => createQueryBuilderMock(results[call++] as any) };
}

describe("getTrackTyreStock", () => {
  it("returns front and back quantities when both active items exist", async () => {
    const supabase = sequencedSupabase([
      { data: [trackTyreRow("Track Tyre - Front", 12), trackTyreRow("Track Tyre - Back", 7)], error: null },
    ]);

    const stock = await getTrackTyreStock(supabase);
    expect(stock).toEqual({ front: 12, back: 7 });
  });

  it("returns null for a position whose active item is missing", async () => {
    const supabase = sequencedSupabase([{ data: [trackTyreRow("Track Tyre - Front", 12)], error: null }]);

    const stock = await getTrackTyreStock(supabase);
    expect(stock).toEqual({ front: 12, back: null });
  });

  it("returns null for both when neither item exists", async () => {
    const supabase = sequencedSupabase([{ data: [], error: null }]);

    const stock = await getTrackTyreStock(supabase);
    expect(stock).toEqual({ front: null, back: null });
  });

  it("throws on a Supabase error", async () => {
    const supabase = sequencedSupabase([{ data: null, error: { message: "network down" } }]);

    await expect(getTrackTyreStock(supabase)).rejects.toThrow("network down");
  });
});

describe("getStockAlerts", () => {
  const itemRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: "item-1",
    item_type: "TRACK_TYRE",
    product_name: "MRF Nylogrip Zapper",
    sku_code: "MRF-1",
    brand_id: "b1",
    purchase_price: 1500,
    selling_price: 2200,
    available_quantity: 2,
    low_stock_threshold: 5,
    stock_status: "low_stock",
    is_active: true,
    image_url: null,
    custom_type_label: null,
    brands: null,
    ...overrides,
  });

  // Query order inside getStockAlerts: out-of-stock list, out-of-stock count,
  // low-stock list, low-stock count.
  const outThenLow = (
    outItems: unknown[],
    outCount: number,
    lowItems: unknown[],
    lowCount: number
  ) => [
    { data: outItems, error: null },
    { data: null, error: null, count: outCount },
    { data: lowItems, error: null },
    { data: null, error: null, count: lowCount },
  ];

  it("keeps out-of-stock and low-stock as separate groups rather than one merged list", async () => {
    const supabase = sequencedSupabase(
      outThenLow(
        [itemRow({ id: "a", available_quantity: 0, stock_status: "out_of_stock" })],
        4,
        [itemRow({ id: "b", available_quantity: 2 })],
        3
      )
    );

    const alerts = await getStockAlerts(supabase);
    expect(alerts.outOfStock.items.map((i) => i.id)).toEqual(["a"]);
    expect(alerts.outOfStock.totalCount).toBe(4);
    expect(alerts.lowStock.items.map((i) => i.id)).toEqual(["b"]);
    expect(alerts.lowStock.totalCount).toBe(3);
  });

  it("does not let a long out-of-stock list starve the low-stock group", async () => {
    // The whole point of querying each status separately: a combined list
    // capped at N could be filled entirely by out-of-stock rows.
    const manyOut = Array.from({ length: 5 }, (_, i) =>
      itemRow({ id: `out-${i}`, available_quantity: 0, stock_status: "out_of_stock" })
    );
    const supabase = sequencedSupabase(outThenLow(manyOut, 12, [itemRow({ id: "low-1" })], 1));

    const alerts = await getStockAlerts(supabase, 5);
    expect(alerts.outOfStock.items).toHaveLength(5);
    expect(alerts.lowStock.items).toHaveLength(1);
  });

  it("reports a total count higher than the capped preview list", async () => {
    const supabase = sequencedSupabase(outThenLow([itemRow({ stock_status: "out_of_stock" })], 25, [], 0));

    const alerts = await getStockAlerts(supabase, 1);
    expect(alerts.outOfStock.items).toHaveLength(1);
    expect(alerts.outOfStock.totalCount).toBe(25);
  });

  it("returns empty groups and zero counts when nothing is low or out of stock", async () => {
    const supabase = sequencedSupabase(outThenLow([], 0, [], 0));

    const alerts = await getStockAlerts(supabase);
    expect(alerts.outOfStock).toEqual({ items: [], totalCount: 0 });
    expect(alerts.lowStock).toEqual({ items: [], totalCount: 0 });
  });

  it("throws if a list query errors rather than silently showing an empty panel", async () => {
    const supabase = sequencedSupabase([
      { data: null, error: { message: "boom" } },
      { data: null, error: null, count: 0 },
      { data: [], error: null },
      { data: null, error: null, count: 0 },
    ]);

    await expect(getStockAlerts(supabase)).rejects.toThrow("boom");
  });

  it("throws if a count query errors", async () => {
    const supabase = sequencedSupabase([
      { data: [], error: null },
      { data: null, error: { message: "count failed" } },
      { data: [], error: null },
      { data: null, error: null, count: 0 },
    ]);

    await expect(getStockAlerts(supabase)).rejects.toThrow("count failed");
  });
});

describe("getOpenWorkCounts", () => {
  it("counts undispatched orders and unfinished service jobs", async () => {
    const supabase = sequencedSupabase([
      { data: null, error: null, count: 3 },
      { data: null, error: null, count: 2 },
    ]);

    expect(await getOpenWorkCounts(supabase)).toEqual({ ordersToDispatch: 3, openServiceJobs: 2 });
  });

  it("returns zeroes rather than nulls when there is nothing pending", async () => {
    const supabase = sequencedSupabase([
      { data: null, error: null, count: null },
      { data: null, error: null, count: null },
    ]);

    expect(await getOpenWorkCounts(supabase)).toEqual({ ordersToDispatch: 0, openServiceJobs: 0 });
  });

  it("throws when the orders count query fails", async () => {
    const supabase = sequencedSupabase([
      { data: null, error: { message: "orders unavailable" } },
      { data: null, error: null, count: 0 },
    ]);

    await expect(getOpenWorkCounts(supabase)).rejects.toThrow("orders unavailable");
  });

  it("throws when the service jobs count query fails", async () => {
    const supabase = sequencedSupabase([
      { data: null, error: null, count: 0 },
      { data: null, error: { message: "jobs unavailable" } },
    ]);

    await expect(getOpenWorkCounts(supabase)).rejects.toThrow("jobs unavailable");
  });
});

describe("getDashboardStats", () => {
  const emptySupabase = () => sequencedSupabase([{ data: [], error: null }]);
  const zeroServiceStats = { grossCompletedRevenue: 0, collectedRevenue: 0, completedJobCount: 0 };
  const zeroCollections = { cash: 0, upi: 0, unrecorded: 0, outstanding: 0, totalBilled: 0, days: [] };

  beforeEach(() => {
    // Every test below sets its own Sales/Purchases/COGS mocks explicitly;
    // Service and Collections default to zero unless a test cares about
    // them specifically.
    vi.mocked(getServiceStats).mockResolvedValue(zeroServiceStats);
    vi.mocked(getCollectionsReport).mockResolvedValue(zeroCollections);
  });

  it("composes salesAmount, serviceAmount, purchaseAmount, totalSalesCount, and costOfGoodsSold from the underlying functions", async () => {
    vi.mocked(getSalesStats).mockResolvedValue({ totalSalesAmount: 50000, saleCount: 12 });
    vi.mocked(getPurchaseStats).mockResolvedValue({ totalPurchaseAmount: 30000, entryCount: 8 });
    vi.mocked(getServiceStats).mockResolvedValue({ grossCompletedRevenue: 15000, collectedRevenue: 15000, completedJobCount: 6 });
    vi.mocked(getCostOfGoodsSold).mockResolvedValue(18000);

    const stats = await getDashboardStats(emptySupabase());

    expect(stats.salesAmount).toBe(50000);
    expect(stats.serviceAmount).toBe(15000);
    expect(stats.purchaseAmount).toBe(30000);
    expect(stats.totalSalesCount).toBe(12);
    expect(stats.costOfGoodsSold).toBe(18000);
  });

  it("passes cashCollected and upiCollected straight through from getCollectionsReport", async () => {
    vi.mocked(getSalesStats).mockResolvedValue({ totalSalesAmount: 50000, saleCount: 12 });
    vi.mocked(getPurchaseStats).mockResolvedValue({ totalPurchaseAmount: 30000, entryCount: 8 });
    vi.mocked(getCostOfGoodsSold).mockResolvedValue(18000);
    vi.mocked(getCollectionsReport).mockResolvedValue({
      cash: 32000,
      upi: 28000,
      unrecorded: 500,
      outstanding: 1200,
      totalBilled: 61700,
      days: [],
    });

    const stats = await getDashboardStats(emptySupabase());

    expect(stats.cashCollected).toBe(32000);
    expect(stats.upiCollected).toBe(28000);
  });

  it("profit is (salesAmount + serviceAmount) minus costOfGoodsSold, NOT salesAmount minus purchaseAmount", async () => {
    // A big-restock month: purchaseAmount is huge, but only a little was
    // actually sold (costOfGoodsSold is small) — profit should reflect the
    // latter, not read as a loss just because a lot of stock was bought.
    vi.mocked(getSalesStats).mockResolvedValue({ totalSalesAmount: 20000, saleCount: 5 });
    vi.mocked(getPurchaseStats).mockResolvedValue({ totalPurchaseAmount: 500000, entryCount: 40 });
    vi.mocked(getServiceStats).mockResolvedValue({ grossCompletedRevenue: 5000, collectedRevenue: 5000, completedJobCount: 2 });
    vi.mocked(getCostOfGoodsSold).mockResolvedValue(12000);

    const stats = await getDashboardStats(emptySupabase());
    expect(stats.profit).toBe(13000); // (20000 + 5000) - 12000, not 20000 - 500000
  });

  it("folds Service Job revenue into profit even when Sales alone would show a loss", async () => {
    // A garage that runs mostly on service work — Sales alone reads
    // unprofitable, but Service revenue swings it positive.
    vi.mocked(getSalesStats).mockResolvedValue({ totalSalesAmount: 5000, saleCount: 1 });
    vi.mocked(getPurchaseStats).mockResolvedValue({ totalPurchaseAmount: 0, entryCount: 0 });
    vi.mocked(getServiceStats).mockResolvedValue({ grossCompletedRevenue: 25000, collectedRevenue: 25000, completedJobCount: 10 });
    vi.mocked(getCostOfGoodsSold).mockResolvedValue(8000);

    const stats = await getDashboardStats(emptySupabase());
    expect(stats.profit).toBe(22000); // (5000 + 25000) - 8000
  });

  it("returns a negative profit as-is when cost of goods sold exceeds sales + service, not floored at zero", async () => {
    vi.mocked(getSalesStats).mockResolvedValue({ totalSalesAmount: 10000, saleCount: 2 });
    vi.mocked(getPurchaseStats).mockResolvedValue({ totalPurchaseAmount: 0, entryCount: 0 });
    vi.mocked(getCostOfGoodsSold).mockResolvedValue(14000);

    const stats = await getDashboardStats(emptySupabase());
    expect(stats.profit).toBe(-4000);
  });

  it("returns an all-zero state when there's no activity this month", async () => {
    vi.mocked(getSalesStats).mockResolvedValue({ totalSalesAmount: 0, saleCount: 0 });
    vi.mocked(getPurchaseStats).mockResolvedValue({ totalPurchaseAmount: 0, entryCount: 0 });
    vi.mocked(getCostOfGoodsSold).mockResolvedValue(0);

    const stats = await getDashboardStats(emptySupabase());
    expect(stats).toMatchObject({
      salesAmount: 0,
      serviceAmount: 0,
      purchaseAmount: 0,
      totalSalesCount: 0,
      costOfGoodsSold: 0,
      profit: 0,
      cashCollected: 0,
      upiCollected: 0,
      previous: { salesAmount: 0, serviceAmount: 0, purchaseAmount: 0, profit: 0 },
    });
  });

  it("propagates a failure from any underlying call rather than returning partial data", async () => {
    vi.mocked(getSalesStats).mockRejectedValue(new Error("sales query failed"));
    vi.mocked(getPurchaseStats).mockResolvedValue({ totalPurchaseAmount: 0, entryCount: 0 });
    vi.mocked(getCostOfGoodsSold).mockResolvedValue(0);

    await expect(getDashboardStats(emptySupabase())).rejects.toThrow("sales query failed");
  });

  it("passes an explicit range through to getSalesStats/getPurchaseStats/getServiceStats/getCollectionsReport/getCostOfGoodsSold", async () => {
    vi.mocked(getSalesStats).mockResolvedValue({ totalSalesAmount: 1000, saleCount: 1 });
    vi.mocked(getPurchaseStats).mockResolvedValue({ totalPurchaseAmount: 500, entryCount: 1 });
    vi.mocked(getCostOfGoodsSold).mockResolvedValue(300);

    const supabase = emptySupabase();
    const range = { from: new Date("2026-06-01T00:00:00.000Z"), to: new Date("2026-06-30T23:59:59.999Z") };
    await getDashboardStats(supabase, { preset: "custom", range });

    expect(getSalesStats).toHaveBeenCalledWith(supabase, range);
    expect(getPurchaseStats).toHaveBeenCalledWith(supabase, range);
    expect(getServiceStats).toHaveBeenCalledWith(supabase, range);
    expect(getCollectionsReport).toHaveBeenCalledWith(supabase, range);
    expect(getCostOfGoodsSold).toHaveBeenCalledWith(supabase, range);
  });

  it("defaults to Today (IST), not This Month — the Dashboard is a daily glance-and-go screen", async () => {
    vi.mocked(getSalesStats).mockResolvedValue({ totalSalesAmount: 1, saleCount: 1 });
    vi.mocked(getPurchaseStats).mockResolvedValue({ totalPurchaseAmount: 1, entryCount: 1 });
    vi.mocked(getCostOfGoodsSold).mockResolvedValue(1);

    const now = new Date();
    await getDashboardStats(emptySupabase());

    const salesRange = vi.mocked(getSalesStats).mock.calls[0][1];
    // "from" is today's IST midnight — an exact, non-time-sensitive value,
    // unlike "this_month"'s day-1 midnight. "to" is `now` at call time
    // (date-range.ts) — a second, independent `new Date()` call, so it's
    // asserted as "within a few seconds of this test running" rather than an
    // exact instant, to avoid a flaky millisecond mismatch.
    const { year, month, day } = istParts(now);
    expect(salesRange?.from).toEqual(istMidnightUTC(year, month, day));
    expect(salesRange?.to).toBeDefined();
    expect(Math.abs(salesRange!.to!.getTime() - now.getTime())).toBeLessThan(5000);
  });

  it("uses the SAME resolved range for every current-period call", async () => {
    vi.mocked(getSalesStats).mockResolvedValue({ totalSalesAmount: 1, saleCount: 1 });
    vi.mocked(getPurchaseStats).mockResolvedValue({ totalPurchaseAmount: 1, entryCount: 1 });
    vi.mocked(getCostOfGoodsSold).mockResolvedValue(1);

    await getDashboardStats(emptySupabase());

    const salesRange = vi.mocked(getSalesStats).mock.calls[0][1];
    const purchaseRange = vi.mocked(getPurchaseStats).mock.calls[0][1];
    const serviceRange = vi.mocked(getServiceStats).mock.calls[0][1];
    const collectionsRange = vi.mocked(getCollectionsReport).mock.calls[0][1];
    const cogsRange = vi.mocked(getCostOfGoodsSold).mock.calls[0][1];

    expect(salesRange).toEqual(purchaseRange);
    expect(salesRange).toEqual(serviceRange);
    expect(salesRange).toEqual(collectionsRange);
    expect(salesRange).toEqual(cogsRange);
  });
});

describe("getDashboardStats — previous period", () => {
  const emptySupabase = () => sequencedSupabase([{ data: [], error: null }]);
  const zeroServiceStats = { grossCompletedRevenue: 0, collectedRevenue: 0, completedJobCount: 0 };
  const zeroCollections = { cash: 0, upi: 0, unrecorded: 0, outstanding: 0, totalBilled: 0, days: [] };

  beforeEach(() => {
    vi.mocked(getServiceStats).mockResolvedValue(zeroServiceStats);
    vi.mocked(getCollectionsReport).mockResolvedValue(zeroCollections);
  });

  it("queries a second, earlier window that ends before the selected range starts", async () => {
    vi.mocked(getSalesStats).mockResolvedValue({ totalSalesAmount: 1, saleCount: 1 });
    vi.mocked(getPurchaseStats).mockResolvedValue({ totalPurchaseAmount: 1, entryCount: 1 });
    vi.mocked(getCostOfGoodsSold).mockResolvedValue(1);

    await getDashboardStats(emptySupabase());

    const currentRange = vi.mocked(getSalesStats).mock.calls[0][1];
    const previousRange = vi.mocked(getSalesStats).mock.calls[1][1];
    expect(previousRange?.to?.getTime()).toBeLessThan(currentRange!.from!.getTime());
  });

  it("uses the same previous window for sales, purchases, service, and cost of goods sold", async () => {
    vi.mocked(getSalesStats).mockResolvedValue({ totalSalesAmount: 1, saleCount: 1 });
    vi.mocked(getPurchaseStats).mockResolvedValue({ totalPurchaseAmount: 1, entryCount: 1 });
    vi.mocked(getCostOfGoodsSold).mockResolvedValue(1);

    await getDashboardStats(emptySupabase());

    expect(vi.mocked(getSalesStats).mock.calls[1][1]).toEqual(vi.mocked(getPurchaseStats).mock.calls[1][1]);
    expect(vi.mocked(getSalesStats).mock.calls[1][1]).toEqual(vi.mocked(getServiceStats).mock.calls[1][1]);
    expect(vi.mocked(getSalesStats).mock.calls[1][1]).toEqual(vi.mocked(getCostOfGoodsSold).mock.calls[1][1]);
  });

  it("does NOT fetch a previous-period Collections Report — cash/UPI collected has no delta, only a current snapshot", async () => {
    vi.mocked(getSalesStats).mockResolvedValue({ totalSalesAmount: 1, saleCount: 1 });
    vi.mocked(getPurchaseStats).mockResolvedValue({ totalPurchaseAmount: 1, entryCount: 1 });
    vi.mocked(getCostOfGoodsSold).mockResolvedValue(1);

    // Mocks in this file aren't auto-reset between tests (no
    // clearMocks/resetMocks in vitest.config.ts), so this asserts the call
    // count *delta* from one getDashboardStats() invocation, not an
    // absolute total.
    const callsBefore = vi.mocked(getCollectionsReport).mock.calls.length;
    await getDashboardStats(emptySupabase());
    const callsAfter = vi.mocked(getCollectionsReport).mock.calls.length;

    expect(callsAfter - callsBefore).toBe(1);
  });

  it("computes the previous profit from the previous period's own service revenue and cost of goods sold", async () => {
    vi.mocked(getSalesStats)
      .mockResolvedValueOnce({ totalSalesAmount: 5400, saleCount: 3 })
      .mockResolvedValueOnce({ totalSalesAmount: 4580, saleCount: 2 });
    vi.mocked(getPurchaseStats)
      .mockResolvedValueOnce({ totalPurchaseAmount: 27000, entryCount: 4 })
      .mockResolvedValueOnce({ totalPurchaseAmount: 19000, entryCount: 3 });
    vi.mocked(getServiceStats)
      .mockResolvedValueOnce({ grossCompletedRevenue: 1000, collectedRevenue: 1000, completedJobCount: 1 })
      .mockResolvedValueOnce({ grossCompletedRevenue: 800, collectedRevenue: 800, completedJobCount: 1 });
    vi.mocked(getCostOfGoodsSold).mockResolvedValueOnce(3900).mockResolvedValueOnce(3390);

    const stats = await getDashboardStats(emptySupabase());

    expect(stats.profit).toBe(2500); // (5400 + 1000) - 3900
    expect(stats.previous).toEqual({ salesAmount: 4580, serviceAmount: 800, purchaseAmount: 19000, profit: 1990 }); // (4580 + 800) - 3390
  });

  it("returns zeroed previous figures for a first-ever period instead of omitting them", async () => {
    vi.mocked(getSalesStats)
      .mockResolvedValueOnce({ totalSalesAmount: 5400, saleCount: 3 })
      .mockResolvedValueOnce({ totalSalesAmount: 0, saleCount: 0 });
    vi.mocked(getPurchaseStats)
      .mockResolvedValueOnce({ totalPurchaseAmount: 27000, entryCount: 4 })
      .mockResolvedValueOnce({ totalPurchaseAmount: 0, entryCount: 0 });
    vi.mocked(getCostOfGoodsSold).mockResolvedValueOnce(3900).mockResolvedValueOnce(0);

    const stats = await getDashboardStats(emptySupabase());
    expect(stats.previous).toEqual({ salesAmount: 0, serviceAmount: 0, purchaseAmount: 0, profit: 0 });
  });
});
