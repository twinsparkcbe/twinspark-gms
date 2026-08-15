import { describe, expect, it } from "vitest";

import { createQueryBuilderMock } from "../../test/supabase-query-mock";
import { getCollectionsReport } from "./collections";

const RANGE = { from: new Date("2026-08-01T00:00:00.000Z"), to: new Date("2026-08-31T23:59:59.000Z") };
const AT = "2026-08-14T06:00:00.000Z"; // 11:30am IST on 14 Aug

function mockTwoQueries(sales: unknown[], service: unknown[], errors?: { sales?: string; service?: string }) {
  const results = [
    { data: errors?.sales ? null : sales, error: errors?.sales ? { message: errors.sales } : null },
    { data: errors?.service ? null : service, error: errors?.service ? { message: errors.service } : null },
  ];
  let call = 0;
  return {
    from: () => createQueryBuilderMock(results[call++] as never),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function sale(overrides: Record<string, unknown> = {}) {
  return {
    grand_total: 2000,
    payment_status: "PAID",
    payment_mode: "SPLIT",
    cash_amount: 1000,
    upi_amount: 1000,
    sale_date: AT,
    ...overrides,
  };
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    grand_total: 1500,
    payment_status: "PAID",
    payment_mode: "CASH",
    cash_amount: 1500,
    upi_amount: 0,
    completed_at: AT,
    ...overrides,
  };
}

describe("getCollectionsReport", () => {
  it("PAY-090: sums cash across sales and completed service jobs", async () => {
    const supabase = mockTwoQueries([sale()], [job()]);
    const report = await getCollectionsReport(supabase, RANGE);
    expect(report.cash).toBe(2500);
  });

  it("PAY-091: sums UPI across both sources", async () => {
    const supabase = mockTwoQueries([sale()], [job({ payment_mode: "UPI", cash_amount: 0, upi_amount: 1500 })]);
    const report = await getCollectionsReport(supabase, RANGE);
    expect(report.upi).toBe(2500);
  });

  it("PAY-094: a settled bill with no tender recorded lands in Unrecorded, not cash", async () => {
    const supabase = mockTwoQueries([sale({ payment_mode: null, cash_amount: 0, upi_amount: 0 })], []);
    const report = await getCollectionsReport(supabase, RANGE);

    expect(report.unrecorded).toBe(2000);
    expect(report.cash).toBe(0);
    expect(report.outstanding).toBe(0);
  });

  it("PAY-095: a part payment contributes its tender and leaves the rest outstanding", async () => {
    const supabase = mockTwoQueries(
      [sale({ payment_status: "PARTIAL", cash_amount: 500, upi_amount: 1000 })],
      []
    );
    const report = await getCollectionsReport(supabase, RANGE);

    expect(report.cash).toBe(500);
    expect(report.upi).toBe(1000);
    expect(report.outstanding).toBe(500);
  });

  it("PAY-095b: an entirely unpaid bill is fully outstanding", async () => {
    const supabase = mockTwoQueries(
      [sale({ payment_status: "PENDING", payment_mode: null, cash_amount: 0, upi_amount: 0 })],
      []
    );
    const report = await getCollectionsReport(supabase, RANGE);

    expect(report.outstanding).toBe(2000);
    expect(report.unrecorded).toBe(0);
  });

  it("PAY-096: a free service is excluded from every bucket, including outstanding", async () => {
    const supabase = mockTwoQueries(
      [],
      [job({ payment_status: "FREE_SERVICE", payment_mode: null, cash_amount: 0, upi_amount: 0 })]
    );
    const report = await getCollectionsReport(supabase, RANGE);

    expect(report).toMatchObject({ cash: 0, upi: 0, unrecorded: 0, outstanding: 0, totalBilled: 0 });
  });

  it("PAY-097: total billed is the sum of grand totals across both sources", async () => {
    const supabase = mockTwoQueries([sale()], [job()]);
    expect((await getCollectionsReport(supabase, RANGE)).totalBilled).toBe(3500);
  });

  it("PAY-098: per-day rows bucket on the IST calendar day and merge both sources", async () => {
    const supabase = mockTwoQueries([sale()], [job()]);
    const report = await getCollectionsReport(supabase, RANGE);

    expect(report.days).toHaveLength(1);
    expect(report.days[0]).toMatchObject({ date: "2026-08-14", label: "14 Aug 2026", cash: 2500, upi: 1000 });
  });

  it("PAY-098b: a late-evening IST bill counts on the shop's day, not the next UTC one", async () => {
    // 19:30 UTC on 14 Aug is 01:00 IST on 15 Aug — the shop's own calendar
    // day is what the owner reconciles against.
    const supabase = mockTwoQueries([sale({ sale_date: "2026-08-14T19:30:00.000Z" })], []);
    const report = await getCollectionsReport(supabase, RANGE);
    expect(report.days[0].date).toBe("2026-08-15");
  });

  it("PAY-098c: days are returned newest first", async () => {
    const supabase = mockTwoQueries([sale(), sale({ sale_date: "2026-08-02T06:00:00.000Z" })], []);
    const report = await getCollectionsReport(supabase, RANGE);
    expect(report.days.map((d) => d.date)).toEqual(["2026-08-14", "2026-08-02"]);
  });

  it("PAY-099: an empty range returns zeros and no rows rather than throwing", async () => {
    const supabase = mockTwoQueries([], []);
    const report = await getCollectionsReport(supabase, RANGE);

    expect(report).toMatchObject({ cash: 0, upi: 0, unrecorded: 0, outstanding: 0, totalBilled: 0 });
    expect(report.days).toEqual([]);
  });

  it("PAY-101: propagates a sales query error", async () => {
    const supabase = mockTwoQueries([], [], { sales: "boom" });
    await expect(getCollectionsReport(supabase, RANGE)).rejects.toThrow("boom");
  });

  it("PAY-101b: propagates a service query error", async () => {
    const supabase = mockTwoQueries([], [], { service: "kaboom" });
    await expect(getCollectionsReport(supabase, RANGE)).rejects.toThrow("kaboom");
  });
});
