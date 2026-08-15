import { describe, expect, it } from "vitest";

import { BUSINESS_INFO } from "./business-info";

describe("BUSINESS_INFO", () => {
  it("BILL-040: exports the confirmed business name and address lines", () => {
    expect(BUSINESS_INFO.name).toBe("Twinspark Tyres And Bike Garage");
    expect(BUSINESS_INFO.addressLines.join(", ")).toContain("Coimbatore");
  });

  it("BILL-041: phone is unset until a real value is supplied", () => {
    expect(BUSINESS_INFO.phone).toBeUndefined();
  });

  it("BILL-042: exports the garage's registered GSTIN in the 15-character GSTIN format", () => {
    expect(BUSINESS_INFO.gstin).toBe("33FUWPP1730B1ZM");
    expect(BUSINESS_INFO.gstin).toMatch(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/);
  });
});
