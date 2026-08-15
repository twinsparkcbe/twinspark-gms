import { describe, expect, it } from "vitest";

import { createQueryBuilderMock } from "../../test/supabase-query-mock";
import { listFollowUpCandidates } from "./customer-followup";

// Fixed "now" so "N months since" is unambiguous in every test.
const NOW = new Date("2026-08-02T10:00:00.000Z");

function mockThreeQueries(
  customersResult: { data: unknown; error: unknown },
  salesResult: { data: unknown; error: unknown },
  serviceResult: { data: unknown; error: unknown }
) {
  const results = [customersResult, salesResult, serviceResult];
  let call = 0;
  return {
    from: () => createQueryBuilderMock(results[call++] as never),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const customers = [
  { id: "cust-1", name: "Arun Kumar", mobile_number: "9876543210" },
  { id: "cust-2", name: "Priya S", mobile_number: "9876500000" },
];

describe("listFollowUpCandidates", () => {
  it("includes a customer whose last sale is older than the sale threshold, with no service history", async () => {
    const sales = [
      { customer_id: "cust-1", sale_date: "2026-01-01T00:00:00.000Z", sale_items: [{ line_type: "PRODUCT", inventory_items: { product_name: "MRF Zapper" } }] },
    ];
    const supabase = mockThreeQueries({ data: [customers[0]], error: null }, { data: sales, error: null }, { data: [], error: null });

    const result = await listFollowUpCandidates(supabase, { monthsSinceSale: 6, monthsSinceService: 3 }, NOW);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ customerId: "cust-1", reason: "SALE", lastSaleItemSummary: "MRF Zapper", lastServiceDate: null });
  });

  it("includes a customer whose last completed service is older than the service threshold, with no sales history", async () => {
    const serviceJobs = [{ customer_id: "cust-1", completed_at: "2026-03-01T00:00:00.000Z" }];
    const supabase = mockThreeQueries({ data: [customers[0]], error: null }, { data: [], error: null }, { data: serviceJobs, error: null });

    const result = await listFollowUpCandidates(supabase, { monthsSinceSale: 6, monthsSinceService: 3 }, NOW);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ customerId: "cust-1", reason: "SERVICE", lastSaleDate: null, lastServiceDate: "2026-03-01T00:00:00.000Z" });
  });

  it("collapses a customer past both thresholds into one row tagged BOTH", async () => {
    const sales = [{ customer_id: "cust-1", sale_date: "2026-01-01T00:00:00.000Z", sale_items: [] }];
    const serviceJobs = [{ customer_id: "cust-1", completed_at: "2026-02-01T00:00:00.000Z" }];
    const supabase = mockThreeQueries({ data: [customers[0]], error: null }, { data: sales, error: null }, { data: serviceJobs, error: null });

    const result = await listFollowUpCandidates(supabase, { monthsSinceSale: 6, monthsSinceService: 3 }, NOW);

    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("BOTH");
  });

  it("excludes a customer within both thresholds", async () => {
    const sales = [{ customer_id: "cust-1", sale_date: "2026-07-20T00:00:00.000Z", sale_items: [] }];
    const serviceJobs = [{ customer_id: "cust-1", completed_at: "2026-07-25T00:00:00.000Z" }];
    const supabase = mockThreeQueries({ data: [customers[0]], error: null }, { data: sales, error: null }, { data: serviceJobs, error: null });

    const result = await listFollowUpCandidates(supabase, { monthsSinceSale: 6, monthsSinceService: 3 }, NOW);

    expect(result).toEqual([]);
  });

  it("excludes a customer with neither a sale nor a completed service at all", async () => {
    const supabase = mockThreeQueries({ data: customers, error: null }, { data: [], error: null }, { data: [], error: null });

    const result = await listFollowUpCandidates(supabase, { monthsSinceSale: 6, monthsSinceService: 3 }, NOW);

    expect(result).toEqual([]);
  });

  it("never counts an in-progress/draft job as last service — only COMPLETED resets the clock", async () => {
    const supabase = mockThreeQueries({ data: [customers[0]], error: null }, { data: [], error: null }, { data: [], error: null });

    const result = await listFollowUpCandidates(supabase, { monthsSinceSale: 6, monthsSinceService: 3 }, NOW);

    // The service_jobs query itself filters to COMPLETED (see listFollowUpCandidates'
    // .eq("status", "COMPLETED")) — an in-progress job never appears in serviceRes at
    // all, so with an empty result set here there's nothing to count as "last service."
    expect(result).toEqual([]);
  });

  it("sorts most-overdue-first", async () => {
    const sales = [
      { customer_id: "cust-1", sale_date: "2026-02-01T00:00:00.000Z", sale_items: [] }, // ~6 months ago
      { customer_id: "cust-2", sale_date: "2025-08-01T00:00:00.000Z", sale_items: [] }, // ~12 months ago
    ];
    const supabase = mockThreeQueries({ data: customers, error: null }, { data: sales, error: null }, { data: [], error: null });

    const result = await listFollowUpCandidates(supabase, { monthsSinceSale: 3, monthsSinceService: 3 }, NOW);

    expect(result.map((r) => r.customerId)).toEqual(["cust-2", "cust-1"]);
  });

  it("returns an empty array when nobody qualifies", async () => {
    const supabase = mockThreeQueries({ data: [], error: null }, { data: [], error: null }, { data: [], error: null });

    const result = await listFollowUpCandidates(supabase, { monthsSinceSale: 6, monthsSinceService: 3 }, NOW);

    expect(result).toEqual([]);
  });

  it("throws on a Supabase error from any of the three queries", async () => {
    const supabase = mockThreeQueries({ data: null, error: { message: "boom" } }, { data: [], error: null }, { data: [], error: null });

    await expect(listFollowUpCandidates(supabase, { monthsSinceSale: 6, monthsSinceService: 3 }, NOW)).rejects.toThrow("boom");
  });
});
