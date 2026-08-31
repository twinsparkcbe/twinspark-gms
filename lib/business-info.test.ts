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

  // These print on every bill a customer takes away, so a digit dropped in a
  // refactor would be found by the customer who cannot get through, not by us.
  it("carries the four contact lines that print on every bill", () => {
    expect(BUSINESS_INFO.contacts).toEqual([
      { label: "Office", numbers: ["7200351766"] },
      { label: "Online", numbers: ["7418847085", "8438907759"] },
      { label: "Customer care", numbers: ["9361017105"] },
    ]);
  });

  it("every contact number is a plain 10-digit Indian mobile", () => {
    const numbers = (BUSINESS_INFO.contacts ?? []).flatMap((c) => c.numbers);
    expect(numbers).toHaveLength(4);
    for (const n of numbers) expect(n).toMatch(/^[6-9][0-9]{9}$/);
  });
});
