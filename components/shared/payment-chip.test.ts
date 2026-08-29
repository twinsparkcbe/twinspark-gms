import { describe, expect, it } from "vitest";

import { paymentChipFor } from "./payment-chip";

describe("paymentChipFor", () => {
  it("PAY-120: a settled cash bill shows a Cash chip", () => {
    expect(paymentChipFor({ paymentStatus: "PAID", paymentMode: "CASH", balanceDue: 0 })).toMatchObject({
      label: "Cash",
      variant: "success",
    });
  });

  it("PAY-121: a settled UPI bill shows a UPI chip in the UPI channel colour", () => {
    expect(paymentChipFor({ paymentStatus: "PAID", paymentMode: "UPI", balanceDue: 0 })).toMatchObject({
      label: "UPI",
      variant: "info",
    });
  });

  it("PAY-121b: a settled split bill shows a Split chip explaining itself on hover", () => {
    const chip = paymentChipFor({ paymentStatus: "PAID", paymentMode: "SPLIT", balanceDue: 0 });
    expect(chip).toMatchObject({ label: "Split", variant: "channel" });
    expect(chip.title).toContain("cash");
  });

  it("PAY-122: a part payment warns and carries the balance in its title", () => {
    const chip = paymentChipFor({ paymentStatus: "PARTIAL", paymentMode: "SPLIT", balanceDue: 500 });
    expect(chip).toMatchObject({ label: "Partial", variant: "warning" });
    expect(chip.title).toContain("500");
  });

  it("PAY-123: an unpaid bill shows a danger chip with the amount outstanding", () => {
    const chip = paymentChipFor({ paymentStatus: "PENDING", paymentMode: null, balanceDue: 2000 });
    expect(chip).toMatchObject({ label: "Pending", variant: "danger" });
    expect(chip.title).toContain("2,000");
  });

  it("PAY-124: a bill settled before tender was tracked shows a dash, never a guessed Cash", () => {
    const chip = paymentChipFor({ paymentStatus: "PAID", paymentMode: null, balanceDue: 0 });
    expect(chip).toMatchObject({ label: "—", variant: "neutral" });
    expect(chip.title).toContain("not recorded");
  });

  it("PAY-125: a free service is neutral, not a debt", () => {
    expect(paymentChipFor({ paymentStatus: "FREE_SERVICE", paymentMode: null, balanceDue: 0 })).toMatchObject({
      label: "Free",
      variant: "neutral",
    });
  });
});
