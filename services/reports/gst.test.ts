import { describe, expect, it } from "vitest";

import { createQueryBuilderMock } from "../../test/supabase-query-mock";
import { getGstReport } from "./gst";

const RANGE = { from: new Date("2026-08-01T00:00:00.000Z"), to: new Date("2026-08-31T23:59:59.000Z") };
const AT = "2026-08-14T06:00:00.000Z";

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

function saleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sale-1",
    sale_date: AT,
    invoice_number: "INV-001",
    subtotal: 10000,
    installation_total: 0,
    gst_amount: 1800,
    grand_total: 11800,
    customers: { name: "Ravi Kumar" },
    ...overrides,
  };
}

function serviceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    completed_at: AT,
    invoice_number: "SRV-001",
    subtotal: 2000,
    inventory_total: 500,
    gst_amount: 450,
    grand_total: 2950,
    payment_status: "PAID",
    customers: { name: "Meena Devi" },
    ...overrides,
  };
}

describe("getGstReport", () => {
  it("GST-01: includes a GST-applicable sale with its taxable value and derived rate", async () => {
    const supabase = mockTwoQueries([saleRow()], []);
    const report = await getGstReport(supabase, RANGE);

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      type: "SALE",
      invoiceNumber: "INV-001",
      customerName: "Ravi Kumar",
      taxableValue: 10000,
      gstAmount: 1800,
      gstRate: 18,
      grandTotal: 11800,
    });
  });

  it("GST-02: includes a GST-applicable completed Service Job, taxable value = labour + parts", async () => {
    const supabase = mockTwoQueries([], [serviceRow()]);
    const report = await getGstReport(supabase, RANGE);

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      type: "SERVICE",
      invoiceNumber: "SRV-001",
      customerName: "Meena Devi",
      taxableValue: 2500,
      gstAmount: 450,
      gstRate: 18,
      grandTotal: 2950,
    });
  });

  it("GST-03: combines Sales and Service into one list, sorted newest first", async () => {
    const supabase = mockTwoQueries(
      [saleRow({ sale_date: "2026-08-02T06:00:00.000Z" })],
      [serviceRow({ completed_at: "2026-08-20T06:00:00.000Z" })]
    );
    const report = await getGstReport(supabase, RANGE);

    expect(report.rows.map((r) => r.type)).toEqual(["SERVICE", "SALE"]);
  });

  it("GST-04: excludes a FREE_SERVICE job even if gst_applicable was set", async () => {
    const supabase = mockTwoQueries([], [serviceRow({ payment_status: "FREE_SERVICE" })]);
    const report = await getGstReport(supabase, RANGE);

    expect(report.rows).toHaveLength(0);
    expect(report.gstAmount).toBe(0);
  });

  it("GST-05: sums taxableValue, gstAmount, and totalInvoiceValue across both sources", async () => {
    const supabase = mockTwoQueries([saleRow()], [serviceRow()]);
    const report = await getGstReport(supabase, RANGE);

    expect(report.taxableValue).toBe(12500); // 10000 + 2500
    expect(report.gstAmount).toBe(2250); // 1800 + 450
    expect(report.totalInvoiceValue).toBe(14750); // 11800 + 2950
    expect(report.billCount).toBe(2);
  });

  it("GST-06: gstRate is null when there is no taxable value to divide by, not Infinity/NaN", async () => {
    const supabase = mockTwoQueries([saleRow({ subtotal: 0, installation_total: 0, gst_amount: 0 })], []);
    const report = await getGstReport(supabase, RANGE);

    expect(report.rows[0].gstRate).toBeNull();
  });

  it("GST-07: an empty range returns zeros and no rows rather than throwing", async () => {
    const supabase = mockTwoQueries([], []);
    const report = await getGstReport(supabase, RANGE);

    expect(report).toMatchObject({ taxableValue: 0, gstAmount: 0, totalInvoiceValue: 0, billCount: 0 });
    expect(report.rows).toEqual([]);
  });

  it("GST-08: propagates a sales query error", async () => {
    const supabase = mockTwoQueries([], [], { sales: "boom" });
    await expect(getGstReport(supabase, RANGE)).rejects.toThrow("boom");
  });

  it("GST-09: propagates a service query error", async () => {
    const supabase = mockTwoQueries([], [], { service: "kaboom" });
    await expect(getGstReport(supabase, RANGE)).rejects.toThrow("kaboom");
  });

  it("GST-10: falls back to 'Unknown customer' when the customer join is missing", async () => {
    const supabase = mockTwoQueries([saleRow({ customers: null })], []);
    const report = await getGstReport(supabase, RANGE);
    expect(report.rows[0].customerName).toBe("Unknown customer");
  });

  it("GST-11: handles the embedded customers relationship as an array (defensive, mirrors firstOrSelf elsewhere)", async () => {
    const supabase = mockTwoQueries([saleRow({ customers: [{ name: "Array Customer" }] })], []);
    const report = await getGstReport(supabase, RANGE);
    expect(report.rows[0].customerName).toBe("Array Customer");
  });
});
