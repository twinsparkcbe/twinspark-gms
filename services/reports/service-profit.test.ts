import { describe, expect, it } from "vitest";

import { buildServiceProfitReport } from "./service-profit";

const AT = "2026-08-14T06:00:00.000Z"; // 11:30am IST on 14 Aug
const EARLIER = "2026-08-12T06:00:00.000Z";

type SourceRow = Parameters<typeof buildServiceProfitReport>[0][number];

function job(overrides: Partial<SourceRow> = {}): SourceRow {
  return {
    id: "job-1",
    job_number: "SJ-000001",
    invoice_number: "SI-000001",
    completed_at: AT,
    payment_status: "PAID",
    // General Service ₹650 + Water Wash ₹150 — no stock behind either.
    subtotal: 800,
    // One tyre billed at ₹3,200.
    inventory_total: 3200,
    discount_applicable: false,
    discount_amount: 0,
    gst_amount: 0,
    grand_total: 4000,
    customers: { name: "Ravi Kumar" },
    vehicles: { vehicle_number: "TN37AB1234" },
    service_inventory_usage: [{ cost_total: 1900, cost_is_estimated: false }],
    ...overrides,
  } as SourceRow;
}

describe("buildServiceProfitReport", () => {
  it("earns labour in full and parts only above what they cost", () => {
    const report = buildServiceProfitReport([job()]);

    expect(report.labourRevenue).toBe(800);
    expect(report.partsRevenue).toBe(3200);
    expect(report.partsCost).toBe(1900);
    expect(report.partsProfit).toBe(1300);
    // Labour is pure margin; parts contribute only their spread.
    expect(report.totalProfit).toBe(2100);
    expect(report.jobs[0].profit).toBe(2100);
  });

  it("leaves GST out of profit but keeps it in what was billed", () => {
    const report = buildServiceProfitReport([job({ gst_amount: 720, grand_total: 4720 })]);

    expect(report.gstCollected).toBe(720);
    expect(report.totalProfit).toBe(2100);
    expect(report.totalBilled).toBe(4720);
  });

  it("subtracts a job discount from that job's profit", () => {
    const report = buildServiceProfitReport([job({ discount_applicable: true, discount_amount: 300, grand_total: 3700 })]);

    expect(report.discountTotal).toBe(300);
    expect(report.totalProfit).toBe(1800);
  });

  it("ignores a discount amount left on a job whose discount was switched off", () => {
    const report = buildServiceProfitReport([job({ discount_applicable: false, discount_amount: 300 })]);

    expect(report.discountTotal).toBe(0);
    expect(report.totalProfit).toBe(2100);
  });

  it("gives a free service zero revenue and still charges it the parts", () => {
    const report = buildServiceProfitReport([job({ payment_status: "FREE_SERVICE" })]);

    expect(report.labourRevenue).toBe(0);
    expect(report.partsRevenue).toBe(0);
    expect(report.partsCost).toBe(1900);
    expect(report.totalProfit).toBe(-1900);
    expect(report.freeServiceJobCount).toBe(1);
    expect(report.freeServiceCost).toBe(1900);
    expect(report.jobs[0].isFreeService).toBe(true);
  });

  it("reads a labour-only job as pure profit", () => {
    const report = buildServiceProfitReport([
      job({ inventory_total: 0, grand_total: 800, service_inventory_usage: [] }),
    ]);

    expect(report.partsRevenue).toBe(0);
    expect(report.partsCost).toBe(0);
    expect(report.totalProfit).toBe(800);
  });

  it("counts a combo part billed at ₹0 as the cost it really was", () => {
    // The combo line's price sits in subtotal; the part it carried bills at
    // ₹0 in inventory_total but still left the shelf.
    const report = buildServiceProfitReport([
      job({ subtotal: 2500, inventory_total: 0, grand_total: 2500 }),
    ]);

    expect(report.partsProfit).toBe(-1900);
    expect(report.totalProfit).toBe(600);
  });

  it("never floors a loss at zero", () => {
    const report = buildServiceProfitReport([
      job({ subtotal: 0, inventory_total: 1000, grand_total: 1000, service_inventory_usage: [{ cost_total: 1900, cost_is_estimated: false }] }),
    ]);

    expect(report.totalProfit).toBe(-900);
  });

  it("sums a part's cost across every usage row on the job", () => {
    const report = buildServiceProfitReport([
      job({
        service_inventory_usage: [
          { cost_total: 1900, cost_is_estimated: false },
          { cost_total: 250.5, cost_is_estimated: false },
        ],
      }),
    ]);

    expect(report.partsCost).toBe(2150.5);
    expect(report.totalProfit).toBe(1849.5);
  });

  it("treats a not-yet-costed part as zero cost rather than NaN", () => {
    const report = buildServiceProfitReport([job({ service_inventory_usage: [{ cost_total: null, cost_is_estimated: false }] })]);

    expect(report.partsCost).toBe(0);
    expect(report.totalProfit).toBe(4000);
  });

  it("flags a job carrying a back-filled estimate", () => {
    const report = buildServiceProfitReport([
      job({
        service_inventory_usage: [
          { cost_total: 1900, cost_is_estimated: false },
          { cost_total: 250, cost_is_estimated: true },
        ],
      }),
    ]);

    expect(report.jobs[0].costIsEstimated).toBe(true);
    expect(report.estimatedCostJobCount).toBe(1);
  });

  it("drops a job with no completion timestamp rather than dating it today", () => {
    expect(buildServiceProfitReport([job({ completed_at: null })]).jobCount).toBe(0);
  });

  it("sorts jobs newest-completed first", () => {
    const report = buildServiceProfitReport([
      job({ id: "old", job_number: "SJ-000001", completed_at: EARLIER }),
      job({ id: "new", job_number: "SJ-000002", completed_at: AT }),
    ]);

    expect(report.jobs.map((j) => j.id)).toEqual(["new", "old"]);
    expect(report.jobCount).toBe(2);
  });

  it("adds up a mixed period the way the summary cards read it", () => {
    const report = buildServiceProfitReport([
      job({ id: "a" }),
      job({ id: "b", subtotal: 400, inventory_total: 0, grand_total: 400, service_inventory_usage: [] }),
      job({ id: "c", payment_status: "FREE_SERVICE", service_inventory_usage: [{ cost_total: 500, cost_is_estimated: false }] }),
    ]);

    expect(report.jobCount).toBe(3);
    expect(report.labourRevenue).toBe(1200); // 800 + 400 + 0 (free)
    expect(report.partsRevenue).toBe(3200);
    expect(report.partsCost).toBe(2400); // 1900 + 0 + 500
    expect(report.partsProfit).toBe(800);
    expect(report.totalProfit).toBe(2000); // 1200 + 800
    expect(report.freeServiceCost).toBe(500);
  });

  it("returns an empty report for a period with no completed jobs", () => {
    const report = buildServiceProfitReport([]);

    expect(report.jobCount).toBe(0);
    expect(report.totalProfit).toBe(0);
    expect(report.jobs).toEqual([]);
  });
});
