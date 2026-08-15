import { describe, expect, it } from "vitest";

import { onlineOrderFiltersSchema, rejectOnlineOrderInputSchema, submitOnlineOrderInputSchema } from "./schemas";

const VALID_ORDER_ID = "11111111-1111-1111-1111-111111111111";

function baseSubmitInput(overrides: Record<string, unknown> = {}) {
  return {
    customerName: "Ravi Kumar",
    mobileNumber: "9876543210",
    address: "12 Race Course Road, Coimbatore",
    pinCode: "641018",
    quantityFront: 1,
    quantityBack: 0,
    paymentScreenshotPath: "abc123.jpg",
    ...overrides,
  };
}

// ORD-001: happy path.
describe("submitOnlineOrderInputSchema", () => {
  it("accepts a valid order with only a Front quantity", () => {
    expect(submitOnlineOrderInputSchema.safeParse(baseSubmitInput()).success).toBe(true);
  });

  it("accepts a valid order with only a Back quantity", () => {
    expect(
      submitOnlineOrderInputSchema.safeParse(baseSubmitInput({ quantityFront: 0, quantityBack: 2 })).success
    ).toBe(true);
  });

  it("accepts a valid order with both Front and Back quantities", () => {
    expect(
      submitOnlineOrderInputSchema.safeParse(baseSubmitInput({ quantityFront: 1, quantityBack: 1 })).success
    ).toBe(true);
  });

  // ORD-002: both quantities zero is rejected — must order at least one tyre.
  it("rejects an order with both Front and Back quantities zero", () => {
    const result = submitOnlineOrderInputSchema.safeParse(
      baseSubmitInput({ quantityFront: 0, quantityBack: 0 })
    );
    expect(result.success).toBe(false);
  });

  it.each([-1, -5])("rejects a negative Front quantity (%i)", (quantityFront) => {
    expect(submitOnlineOrderInputSchema.safeParse(baseSubmitInput({ quantityFront })).success).toBe(false);
  });

  it("rejects a non-integer quantity", () => {
    expect(submitOnlineOrderInputSchema.safeParse(baseSubmitInput({ quantityFront: 1.5 })).success).toBe(false);
  });

  it("rejects a missing customer name", () => {
    const { customerName: _omit, ...rest } = baseSubmitInput();
    expect(submitOnlineOrderInputSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a blank address", () => {
    expect(submitOnlineOrderInputSchema.safeParse(baseSubmitInput({ address: "   " })).success).toBe(false);
  });

  // ORD-003: PIN code must be exactly 6 digits (India).
  it.each(["64101", "6410188", "ABCDEF", "641 018"])("rejects an invalid PIN code (%s)", (pinCode) => {
    expect(submitOnlineOrderInputSchema.safeParse(baseSubmitInput({ pinCode })).success).toBe(false);
  });

  it("accepts a valid 6-digit PIN code", () => {
    expect(submitOnlineOrderInputSchema.safeParse(baseSubmitInput({ pinCode: "641018" })).success).toBe(true);
  });

  // ORD-004: screenshot path is required — proof of payment can't be skipped.
  it("rejects a missing payment screenshot path", () => {
    const { paymentScreenshotPath: _omit, ...rest } = baseSubmitInput();
    expect(submitOnlineOrderInputSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a too-short mobile number", () => {
    expect(submitOnlineOrderInputSchema.safeParse(baseSubmitInput({ mobileNumber: "12345" })).success).toBe(false);
  });

  // ORD-006: exactly 10 digits, first digit 6-9 (Indian mobile numbers) —
  // tightened from a bare length check, which let non-numeric characters
  // and invalid prefixes through. Surrounding whitespace is NOT a rejection
  // case: the schema trims before matching, so " 9876543210 " is stored as a
  // clean number rather than bounced back at a customer who pasted it.
  it.each(["987654321", "98765432100", "98765-43210"])(
    "rejects a mobile number with the wrong digit count or non-digit characters (%s)",
    (mobileNumber) => {
      expect(submitOnlineOrderInputSchema.safeParse(baseSubmitInput({ mobileNumber })).success).toBe(false);
    }
  );

  it.each(["1234567890", "5876543210", "0876543210"])(
    "rejects a 10-digit mobile number that doesn't start with 6-9 (%s)",
    (mobileNumber) => {
      expect(submitOnlineOrderInputSchema.safeParse(baseSubmitInput({ mobileNumber })).success).toBe(false);
    }
  );

  it.each(["6876543210", "7876543210", "8876543210", "9876543210"])(
    "accepts a valid 10-digit mobile number starting with 6-9 (%s)",
    (mobileNumber) => {
      expect(submitOnlineOrderInputSchema.safeParse(baseSubmitInput({ mobileNumber })).success).toBe(true);
    }
  );
});

describe("rejectOnlineOrderInputSchema", () => {
  it("accepts a valid reject input", () => {
    expect(
      rejectOnlineOrderInputSchema.safeParse({ orderId: VALID_ORDER_ID, reason: "Screenshot unreadable" }).success
    ).toBe(true);
  });

  // ORD-005: a reason is required to reject, same convention as every other
  // stock/state-correcting action in this system.
  it("rejects a blank reason", () => {
    expect(rejectOnlineOrderInputSchema.safeParse({ orderId: VALID_ORDER_ID, reason: "   " }).success).toBe(false);
  });

  it("rejects an invalid orderId", () => {
    expect(rejectOnlineOrderInputSchema.safeParse({ orderId: "not-a-uuid", reason: "x" }).success).toBe(false);
  });
});

describe("onlineOrderFiltersSchema", () => {
  it("defaults page/pageSize when omitted", () => {
    const result = onlineOrderFiltersSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it("accepts a status filter array", () => {
    const result = onlineOrderFiltersSchema.safeParse({ statuses: ["SUBMITTED", "PAYMENT_VERIFIED"] });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown status value", () => {
    const result = onlineOrderFiltersSchema.safeParse({ statuses: ["NOT_A_STATUS"] });
    expect(result.success).toBe(false);
  });

  it("rejects a pageSize over 100", () => {
    expect(onlineOrderFiltersSchema.safeParse({ pageSize: 101 }).success).toBe(false);
  });
});
