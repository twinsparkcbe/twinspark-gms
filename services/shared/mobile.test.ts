import { describe, expect, it } from "vitest";

import { isValidMobileNumber, mobileNumberSchema, sanitizeMobileNumber } from "./mobile";

describe("sanitizeMobileNumber", () => {
  it("strips non-digit characters", () => {
    expect(sanitizeMobileNumber("98765-43210")).toBe("9876543210");
  });

  it("caps the value at 10 digits", () => {
    expect(sanitizeMobileNumber("79247297924749274972947292")).toBe("7924729792");
  });

  it("drops a pasted +91 country code instead of truncating the real number", () => {
    expect(sanitizeMobileNumber("+91 98765 43210")).toBe("9876543210");
  });

  it("drops a pasted leading 0 trunk prefix", () => {
    expect(sanitizeMobileNumber("09876543210")).toBe("9876543210");
  });

  it("keeps a valid number that happens to start with 91", () => {
    expect(sanitizeMobileNumber("9198765432")).toBe("9198765432");
  });

  it("leaves a valid number untouched", () => {
    expect(sanitizeMobileNumber("9876543210")).toBe("9876543210");
  });

  it("returns an empty string for input with no digits", () => {
    expect(sanitizeMobileNumber("abc")).toBe("");
  });
});

describe("isValidMobileNumber", () => {
  it("accepts exactly 10 digits starting 6-9", () => {
    expect(isValidMobileNumber("9876543210")).toBe(true);
    expect(isValidMobileNumber("6012345678")).toBe(true);
  });

  it("accepts a number with surrounding whitespace", () => {
    expect(isValidMobileNumber("  9876543210  ")).toBe(true);
  });

  it("rejects fewer than 10 digits", () => {
    expect(isValidMobileNumber("98765432")).toBe(false);
  });

  it("rejects more than 10 digits", () => {
    expect(isValidMobileNumber("98765432109")).toBe(false);
  });

  it("rejects a first digit below 6", () => {
    expect(isValidMobileNumber("1234567890")).toBe(false);
  });

  it("rejects non-digit characters", () => {
    expect(isValidMobileNumber("98765-4321")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidMobileNumber("")).toBe(false);
  });
});

describe("mobileNumberSchema", () => {
  it("parses a valid number", () => {
    expect(mobileNumberSchema.parse(" 9876543210 ")).toBe("9876543210");
  });

  it("fails an over-length number with the shared message", () => {
    const result = mobileNumberSchema.safeParse("79247297924749274972947292");
    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0]?.message).toBe("Enter a valid 10-digit mobile number.");
  });
});
