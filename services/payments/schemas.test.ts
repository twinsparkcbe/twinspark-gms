import { describe, expect, it } from "vitest";

import { paymentQrConfigInputSchema, upiIdSchema } from "./schemas";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    label: "Twinspark GPay",
    upiId: "twinspark@okhdfcbank",
    payeeName: "Twinspark Tyres And Bike Garage",
    qrImagePath: "abc123.png",
    ...overrides,
  };
}

// SVC-1: upiIdSchema validates name@handle.
describe("upiIdSchema", () => {
  it.each([
    "twinspark@okhdfcbank",
    "9876543210@ybl",
    "merchant.name@upi",
    "a1@yb",
  ])("accepts %s", (value) => {
    expect(upiIdSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ["merchant", "missing @handle"],
    ["@handle", "missing name portion"],
    ["name@", "missing handle portion"],
    ["", "empty string"],
    ["   ", "whitespace only"],
  ])("rejects %s (%s)", (value) => {
    expect(upiIdSchema.safeParse(value).success).toBe(false);
  });

  it("trims surrounding whitespace before validating", () => {
    const result = upiIdSchema.safeParse("  twinspark@okhdfcbank  ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("twinspark@okhdfcbank");
  });
});

// SVC-2/SVC-3: paymentQrConfigInputSchema happy path + validation failures.
describe("paymentQrConfigInputSchema", () => {
  it("accepts a valid config", () => {
    expect(paymentQrConfigInputSchema.safeParse(baseInput()).success).toBe(true);
  });

  it("rejects a blank label", () => {
    expect(paymentQrConfigInputSchema.safeParse(baseInput({ label: "  " })).success).toBe(false);
  });

  it("rejects an invalid UPI ID", () => {
    expect(paymentQrConfigInputSchema.safeParse(baseInput({ upiId: "not-a-upi-id" })).success).toBe(false);
  });

  it("rejects a blank payee name", () => {
    expect(paymentQrConfigInputSchema.safeParse(baseInput({ payeeName: "" })).success).toBe(false);
  });

  it("rejects a missing QR image path", () => {
    expect(paymentQrConfigInputSchema.safeParse(baseInput({ qrImagePath: "" })).success).toBe(false);
  });
});
