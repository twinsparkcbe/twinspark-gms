import { describe, expect, it } from "vitest";

import type { BusinessInfo } from "@/services/shared/invoice";

import { buildJobCardView } from "./job-card";
import type { ServiceJobRow } from "./jobs";

const BUSINESS: BusinessInfo = {
  name: "Twinspark Tyres And Bike Garage",
  addressLines: ["Coimbatore, Tamil Nadu"],
};

function baseJob(overrides: Partial<ServiceJobRow> = {}): ServiceJobRow {
  return {
    id: "job-1",
    jobNumber: "SJ-000001",
    invoiceNumber: null,
    customerId: "cust-1",
    customerName: "Arun Kumar",
    customerMobile: "9876543210",
    customerAddress: "Coimbatore",
    vehicleId: "veh-1",
    vehicleNumber: "TN37AB1234",
    vehicleModel: "KTM Duke 390",
    odometerReading: 12000,
    status: "DRAFT",
    complaintNotes: "Engine Noise",
    mechanicNotes: "Fork seal leaking — replace next visit",
    expectedDeliveryAt: null,
    completedAt: null,
    deliveredAt: null,
    paymentStatus: null,
    paymentMode: null,
    cashAmount: 0,
    upiAmount: 0,
    deliveryStatus: null,
    gstApplicable: false,
    gstAmount: 0,
    discountApplicable: false,
    discountAmount: 0,
    subtotal: 800,
    inventoryTotal: 350,
    grandTotal: 1150,
    createdAt: "2026-07-16T10:00:00.000Z",
    lines: [
      { id: "l1", position: 1, lineType: "PACKAGE", generalServicePackageId: "pkg-1", specificServiceId: null, comboId: null, comboContents: [], comboListValue: null, description: "Standard Service", quantity: 1, rate: 650, amount: 650 },
      { id: "l2", position: 2, lineType: "SPECIFIC", generalServicePackageId: null, specificServiceId: "spec-1", comboId: null, comboContents: [], comboListValue: null, description: "Chain Cleaning", quantity: 1, rate: 150, amount: 150 },
    ],
    usage: [{ id: "u1", inventoryItemId: "item-1", itemName: "Engine Oil 20W40", quantityUsed: 1, unitPrice: 350, lineTotal: 350, comboId: null, includedInCombo: false }],
    events: [],
    images: [],
    assignedMechanicId: null,
    assignedMechanicName: null,
    ...overrides,
  };
}

describe("buildJobCardView", () => {
  it("is available for a DRAFT job (printable before completion, doc §17)", () => {
    const view = buildJobCardView(baseJob({ status: "DRAFT" }), BUSINESS);
    expect(view.statusLabel).toBe("Draft");
  });

  it("is available for a CANCELLED job too", () => {
    const view = buildJobCardView(baseJob({ status: "CANCELLED" }), BUSINESS);
    expect(view.statusLabel).toBe("Cancelled");
  });

  it("includes complaint notes", () => {
    const view = buildJobCardView(baseJob(), BUSINESS);
    expect(view.complaintNotes).toBe("Engine Noise");
  });

  it("never includes mechanic notes — the view shape has no such field", () => {
    const view = buildJobCardView(baseJob(), BUSINESS);
    expect(view).not.toHaveProperty("mechanicNotes");
    expect(JSON.stringify(view)).not.toContain("Fork seal");
  });

  it("total is the sum of line amounts only — no GST/Discount breakdown (that belongs to the invoice)", () => {
    const view = buildJobCardView(baseJob({ gstApplicable: true, gstAmount: 100 }), BUSINESS);
    expect(view.totalLabel).toBe("₹800.00"); // 650 + 150, GST excluded
  });

  it("renders lines in position order with No | Description | Qty | Rate | Amount", () => {
    const view = buildJobCardView(baseJob(), BUSINESS);
    expect(view.lines.map((l) => l.slNo)).toEqual([1, 2]);
    expect(view.lines[0].description).toBe("Standard Service");
    expect(view.lines[0].amountLabel).toBe("₹650.00");
  });
});

describe("buildJobCardView — assigned mechanic", () => {
  it("includes the assigned mechanic's name", () => {
    const view = buildJobCardView(baseJob({ assignedMechanicName: "Anand", assignedMechanicId: "m1" }), BUSINESS);
    expect(view.assignedMechanicName).toBe("Anand");
  });

  it("omits the field entirely when nobody is assigned", () => {
    const view = buildJobCardView(baseJob(), BUSINESS);
    expect(view.assignedMechanicName).toBeUndefined();
  });

  // doc §14 — the internal note must never reach a customer-facing print,
  // assignment work notwithstanding.
  it("still keeps mechanicNotes out of the job card shape", () => {
    const view = buildJobCardView(baseJob({ mechanicNotes: "Check fork seal", assignedMechanicName: "Anand" }), BUSINESS);
    expect(JSON.stringify(view)).not.toContain("fork seal");
  });
});
