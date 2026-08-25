import { describe, expect, it } from "vitest";

import { maskAmountInput, maskMobileInput } from "./input-masks";

describe("maskMobileInput", () => {
  it("drops letters and punctuation as they are typed", () => {
    expect(maskMobileInput("abc")).toBe("");
    expect(maskMobileInput("98765abc43")).toBe("9876543");
    expect(maskMobileInput("98765-43210")).toBe("9876543210");
    expect(maskMobileInput("98765 43210")).toBe("9876543210");
  });

  it("caps at ten digits", () => {
    expect(maskMobileInput("98765432109999")).toBe("9876543210");
  });

  /** Both come straight off a phone's contact card. */
  it("strips a +91 or leading-0 prefix rather than truncating the wrong end", () => {
    expect(maskMobileInput("+91 98765 43210")).toBe("9876543210");
    expect(maskMobileInput("919876543210")).toBe("9876543210");
    expect(maskMobileInput("09876543210")).toBe("9876543210");
  });

  it("leaves a partially typed number alone", () => {
    expect(maskMobileInput("987")).toBe("987");
    expect(maskMobileInput("")).toBe("");
  });

  /** A real 10-digit number starting 91 must survive untouched — the prefix
   * rule only fires at 12 digits. */
  it("does not mistake a genuine 91-prefixed 10-digit number for a country code", () => {
    expect(maskMobileInput("9187654321")).toBe("9187654321");
  });
});

describe("maskAmountInput", () => {
  it("drops letters", () => {
    expect(maskAmountInput("600abc")).toBe("600");
    expect(maskAmountInput("Rs 600")).toBe("600");
  });

  it("allows one decimal point with two places", () => {
    expect(maskAmountInput("600.50")).toBe("600.50");
    expect(maskAmountInput("600.5")).toBe("600.5");
    expect(maskAmountInput("600.555")).toBe("600.55");
  });

  it("collapses extra decimal points instead of rejecting the value", () => {
    expect(maskAmountInput("6.0.0")).toBe("6.00");
  });

  it("caps the rupee part at seven digits", () => {
    expect(maskAmountInput("123456789")).toBe("1234567");
  });

  it("leaves a half-typed value usable", () => {
    expect(maskAmountInput("")).toBe("");
    expect(maskAmountInput("6")).toBe("6");
    expect(maskAmountInput("600.")).toBe("600.");
  });
});
