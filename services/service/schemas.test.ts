import { describe, expect, it } from "vitest";

import {
  generalServicePackageInputSchema,
  serviceInventoryUsageInputSchema,
  serviceJobInputSchema,
  serviceJobLineInputSchema,
  specificServiceInputSchema,
} from "./schemas";

describe("serviceJobLineInputSchema", () => {
  it("accepts a PACKAGE line with generalServicePackageId", () => {
    const result = serviceJobLineInputSchema.safeParse({
      lineType: "PACKAGE",
      generalServicePackageId: "11111111-1111-1111-1111-111111111111",
      quantity: 1,
      rate: 450,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a PACKAGE line missing generalServicePackageId", () => {
    const result = serviceJobLineInputSchema.safeParse({ lineType: "PACKAGE", quantity: 1, rate: 450 });
    expect(result.success).toBe(false);
  });

  it("rejects a SPECIFIC line missing specificServiceId", () => {
    const result = serviceJobLineInputSchema.safeParse({ lineType: "SPECIFIC", quantity: 1, rate: 150 });
    expect(result.success).toBe(false);
  });

  it("rejects a CUSTOM line missing description", () => {
    const result = serviceJobLineInputSchema.safeParse({ lineType: "CUSTOM", quantity: 1, rate: 200 });
    expect(result.success).toBe(false);
  });

  it("accepts a CUSTOM line with description, quantity, and rate", () => {
    const result = serviceJobLineInputSchema.safeParse({
      lineType: "CUSTOM",
      description: "Fork seal replacement",
      quantity: 1,
      rate: 350,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative rate", () => {
    const result = serviceJobLineInputSchema.safeParse({
      lineType: "CUSTOM",
      description: "Test",
      quantity: 1,
      rate: -10,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a zero or negative quantity", () => {
    const result = serviceJobLineInputSchema.safeParse({
      lineType: "CUSTOM",
      description: "Test",
      quantity: 0,
      rate: 10,
    });
    expect(result.success).toBe(false);
  });
});

describe("serviceInventoryUsageInputSchema", () => {
  it("rejects a zero or negative quantityUsed", () => {
    const result = serviceInventoryUsageInputSchema.safeParse({
      inventoryItemId: "11111111-1111-1111-1111-111111111111",
      quantityUsed: 0,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a positive quantityUsed", () => {
    const result = serviceInventoryUsageInputSchema.safeParse({
      inventoryItemId: "11111111-1111-1111-1111-111111111111",
      quantityUsed: 2,
    });
    expect(result.success).toBe(true);
  });
});

describe("serviceJobInputSchema", () => {
  const base = {
    customerName: "Arun Kumar",
    customerMobile: "9876543210",
    vehicleNumber: "TN37AB1234",
    vehicleModel: "KTM Duke 390",
    odometerReading: 12000,
  };

  it("rejects when customer mobile number is missing", () => {
    const result = serviceJobInputSchema.safeParse({ ...base, customerMobile: "" });
    expect(result.success).toBe(false);
  });

  it("rejects when vehicle number is missing", () => {
    const result = serviceJobInputSchema.safeParse({ ...base, vehicleNumber: "" });
    expect(result.success).toBe(false);
  });

  it("rejects when vehicle model is missing", () => {
    const result = serviceJobInputSchema.safeParse({ ...base, vehicleModel: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a negative odometer reading", () => {
    const result = serviceJobInputSchema.safeParse({ ...base, odometerReading: -5 });
    expect(result.success).toBe(false);
  });

  it("accepts a job with zero lines and zero usage — valid for a Draft (doc §4)", () => {
    const result = serviceJobInputSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lines).toEqual([]);
      expect(result.data.usage).toEqual([]);
    }
  });

  it("accepts a mixed job — one PACKAGE + multiple SPECIFIC + one CUSTOM line, matching the review's example", () => {
    const result = serviceJobInputSchema.safeParse({
      ...base,
      lines: [
        { lineType: "PACKAGE", generalServicePackageId: "11111111-1111-1111-1111-111111111111", quantity: 1, rate: 450 },
        { lineType: "SPECIFIC", specificServiceId: "22222222-2222-2222-2222-222222222222", quantity: 1, rate: 150 },
        { lineType: "SPECIFIC", specificServiceId: "33333333-3333-3333-3333-333333333333", quantity: 1, rate: 200 },
        { lineType: "CUSTOM", description: "Clutch Adjustment", quantity: 1, rate: 100 },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.lines).toHaveLength(4);
  });
});

describe("generalServicePackageInputSchema", () => {
  it("rejects a negative service charge", () => {
    const result = generalServicePackageInputSchema.safeParse({ name: "Standard Service", serviceCharge: -1 });
    expect(result.success).toBe(false);
  });

  it("accepts a valid package with included items", () => {
    const result = generalServicePackageInputSchema.safeParse({
      name: "Standard Service",
      includedItems: ["Oil Change", "Water Wash"],
      serviceCharge: 450,
    });
    expect(result.success).toBe(true);
  });
});

describe("specificServiceInputSchema", () => {
  it("accepts a service with no defaultCharge (typed fresh every time)", () => {
    const result = specificServiceInputSchema.safeParse({ name: "Chain Cleaning" });
    expect(result.success).toBe(true);
  });

  it("rejects a negative defaultCharge", () => {
    const result = specificServiceInputSchema.safeParse({ name: "Chain Cleaning", defaultCharge: -1 });
    expect(result.success).toBe(false);
  });
});

describe("serviceJobInputSchema — assigned mechanic", () => {
  const base = {
    customerName: "Arun",
    customerMobile: "9876543210",
    vehicleNumber: "TN37AB1234",
    vehicleModel: "KTM Duke 390",
    odometerReading: 12000,
    lines: [],
    usage: [],
  };

  it("accepts a mechanic uuid", () => {
    const parsed = serviceJobInputSchema.parse({ ...base, assignedMechanicId: "44444444-4444-4444-8444-444444444401" });
    expect(parsed.assignedMechanicId).toBe("44444444-4444-4444-8444-444444444401");
  });

  it.each([undefined, null, ""])("treats %p as Unassigned", (value) => {
    const parsed = serviceJobInputSchema.parse({ ...base, assignedMechanicId: value });
    expect(parsed.assignedMechanicId).toBeUndefined();
  });

  it("rejects a non-uuid mechanic id", () => {
    expect(() => serviceJobInputSchema.parse({ ...base, assignedMechanicId: "anand" })).toThrow();
  });
});
