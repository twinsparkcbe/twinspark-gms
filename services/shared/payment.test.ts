import { describe, expect, it } from "vitest";

import {
  balanceDueFor,
  derivePaymentStatus,
  draftFromPayment,
  draftToPaymentInput,
  editPaymentField,
  fillBalance,
  formatPaidByLabel,
  initialPaymentDraft,
  normalizePayment,
  recalcForTotal,
  resolveDraft,
  roundPaise,
  selectPaymentOption,
  validatePayment,
  type PaymentDraft,
} from "./payment";

const TOTAL = 2000;

describe("derivePaymentStatus", () => {
  it("PAY-001: nothing collected on a ₹2,000 bill is PENDING", () => {
    expect(derivePaymentStatus(0, 0, TOTAL)).toBe("PENDING");
  });

  it("PAY-002: cash + UPI equal to the grand total is PAID", () => {
    expect(derivePaymentStatus(1000, 1000, TOTAL)).toBe("PAID");
  });

  it("PAY-003: some but not all of the grand total is PARTIAL", () => {
    expect(derivePaymentStatus(1000, 500, TOTAL)).toBe("PARTIAL");
  });

  it("PAY-004: a zero-value bill is PAID, not PENDING", () => {
    expect(derivePaymentStatus(0, 0, 0)).toBe("PAID");
  });

  it("PAY-005: an exact paise-level settlement is PAID with no float drift", () => {
    expect(derivePaymentStatus(333.33, 666.66, 999.99)).toBe("PAID");
    expect(roundPaise(333.33 + 666.66)).toBe(999.99);
  });

  it("PAY-006: a paise short of the total is still PARTIAL", () => {
    expect(derivePaymentStatus(1999.99, 0, TOTAL)).toBe("PARTIAL");
  });

  it("PAY-007: over-collection resolves to PAID rather than an impossible state", () => {
    expect(derivePaymentStatus(2500, 0, TOTAL)).toBe("PAID");
  });
});

describe("normalizePayment", () => {
  it("PAY-010: SPLIT with no UPI is stored as CASH", () => {
    const result = normalizePayment({ mode: "SPLIT", cashAmount: 2000, upiAmount: 0 }, TOTAL);
    expect(result.mode).toBe("CASH");
    expect(result.cashAmount).toBe(2000);
  });

  it("PAY-011: SPLIT with no cash is stored as UPI", () => {
    const result = normalizePayment({ mode: "SPLIT", cashAmount: 0, upiAmount: 2000 }, TOTAL);
    expect(result.mode).toBe("UPI");
    expect(result.upiAmount).toBe(2000);
  });

  it("PAY-012: SPLIT with both sides zero stores no mode and reads as PENDING", () => {
    const result = normalizePayment({ mode: "SPLIT", cashAmount: 0, upiAmount: 0 }, TOTAL);
    expect(result.mode).toBeNull();
    expect(result.status).toBe("PENDING");
  });

  it("PAY-013: CASH forces the UPI amount to zero", () => {
    const result = normalizePayment({ mode: "CASH", cashAmount: 2000, upiAmount: 750 }, TOTAL);
    expect(result.upiAmount).toBe(0);
    expect(result.mode).toBe("CASH");
  });

  it("PAY-014: UPI forces the cash amount to zero", () => {
    const result = normalizePayment({ mode: "UPI", cashAmount: 750, upiAmount: 2000 }, TOTAL);
    expect(result.cashAmount).toBe(0);
    expect(result.mode).toBe("UPI");
  });

  it("PAY-015: a null mode zeroes both amounts", () => {
    const result = normalizePayment({ mode: null, cashAmount: 900, upiAmount: 900 }, TOTAL);
    expect(result).toMatchObject({ mode: null, cashAmount: 0, upiAmount: 0, status: "PENDING" });
  });

  it("PAY-016: free service stores no mode, no amounts, and its own status", () => {
    const result = normalizePayment({ mode: null, cashAmount: 0, upiAmount: 0, freeService: true }, TOTAL);
    expect(result).toMatchObject({ mode: null, cashAmount: 0, upiAmount: 0, status: "FREE_SERVICE", balanceDue: 0 });
  });

  it("PAY-017: free service discards any amounts passed alongside it", () => {
    const result = normalizePayment({ mode: "SPLIT", cashAmount: 500, upiAmount: 500, freeService: true }, TOTAL);
    expect(result.cashAmount).toBe(0);
    expect(result.upiAmount).toBe(0);
    expect(result.status).toBe("FREE_SERVICE");
  });

  it("PAY-018: reports the balance still owing on a part payment", () => {
    const result = normalizePayment({ mode: "SPLIT", cashAmount: 500, upiAmount: 1000 }, TOTAL);
    expect(result.status).toBe("PARTIAL");
    expect(result.balanceDue).toBe(500);
  });

  it("PAY-019: balance due is zero, never negative, when over-collected", () => {
    expect(normalizePayment({ mode: "CASH", cashAmount: 2500, upiAmount: 0 }, TOTAL).balanceDue).toBe(0);
  });
});

describe("validatePayment", () => {
  it("PAY-020: rejects a negative cash amount", () => {
    expect(validatePayment({ mode: "CASH", cashAmount: -1, upiAmount: 0 }, TOTAL).cash).toBeTruthy();
  });

  it("PAY-021: rejects a negative UPI amount", () => {
    expect(validatePayment({ mode: "UPI", cashAmount: 0, upiAmount: -1 }, TOTAL).upi).toBeTruthy();
  });

  it("PAY-022: rejects cash + UPI over the grand total, naming both figures", () => {
    const errors = validatePayment({ mode: "SPLIT", cashAmount: 1500, upiAmount: 1000 }, TOTAL);
    expect(errors.form).toContain("2,500");
    expect(errors.form).toContain("2,000");
  });

  it("PAY-023: accepts cash + UPI exactly equal to the grand total", () => {
    expect(validatePayment({ mode: "SPLIT", cashAmount: 1000, upiAmount: 1000 }, TOTAL)).toEqual({});
  });

  it("PAY-024: rejects a non-numeric amount rather than silently reading it as zero", () => {
    expect(validatePayment({ mode: "SPLIT", cashAmount: Number.NaN, upiAmount: 0 }, TOTAL).cash).toBeTruthy();
  });

  it("PAY-025: free service skips amount validation entirely", () => {
    expect(validatePayment({ mode: null, cashAmount: 0, upiAmount: 0, freeService: true }, TOTAL)).toEqual({});
  });
});

describe("payment draft — auto-fill", () => {
  function splitDraft(): PaymentDraft {
    return initialPaymentDraft(TOTAL, "SPLIT");
  }

  it("PAY-030: typing UPI while cash is untouched fills cash with the remainder", () => {
    const next = editPaymentField(splitDraft(), "upi", "1000", TOTAL);
    expect(next.upi).toBe("1000");
    expect(next.cash).toBe("1000");
  });

  it("PAY-031: typing cash while UPI is untouched fills UPI with the remainder", () => {
    const next = editPaymentField(splitDraft(), "cash", "1200", TOTAL);
    expect(next.upi).toBe("800");
  });

  it("PAY-032: an entered amount that still fits is left alone when the other side is edited", () => {
    let draft = editPaymentField(splitDraft(), "cash", "500", TOTAL);
    draft = editPaymentField(draft, "upi", "1000", TOTAL);
    expect(draft.cash).toBe("500");
    expect(draft.upi).toBe("1000");
  });

  it("PAY-032b: an entered amount that would overshoot is trimmed to the remainder", () => {
    // Cash 2,000 already fills the bill; typing 1,500 on UPI has to pull cash
    // down to 500 rather than record 3,500 against a ₹2,000 bill.
    let draft = editPaymentField(splitDraft(), "cash", "2000", TOTAL);
    draft = editPaymentField(draft, "upi", "1500", TOTAL);
    expect(draft.cash).toBe("500");
    expect(draft.upi).toBe("1500");
  });

  it("PAY-032c: re-clearing a field re-arms its auto-fill — the reported bug", () => {
    // Previously a "touched" flag made this permanent: clear cash once and it
    // stayed blank no matter what was typed into UPI.
    let draft = editPaymentField(splitDraft(), "cash", "2000", TOTAL);
    draft = editPaymentField(draft, "cash", "", TOTAL);
    draft = editPaymentField(draft, "upi", "1500", TOTAL);
    expect(draft.cash).toBe("500");
  });

  it("PAY-033: ₹2,000 bill — UPI 1000 auto-fills cash 1000, overwriting cash to 500 leaves ₹500 owing", () => {
    let draft = editPaymentField(splitDraft(), "upi", "1000", TOTAL);
    expect(draft.cash).toBe("1000");

    draft = editPaymentField(draft, "cash", "500", TOTAL);
    const resolved = resolveDraft(draft, TOTAL);

    expect(resolved.mode).toBe("SPLIT");
    expect(resolved.cashAmount).toBe(500);
    expect(resolved.upiAmount).toBe(1000);
    expect(resolved.status).toBe("PARTIAL");
    expect(resolved.balanceDue).toBe(500);
  });

  it("PAY-033b: ₹5,000 bill — typing ₹3,000 on UPI fills cash with the ₹2,000 balance", () => {
    const draft = editPaymentField(initialPaymentDraft(5000, "SPLIT"), "upi", "3000", 5000);
    expect(draft.cash).toBe("2000");
    expect(resolveDraft(draft, 5000)).toMatchObject({ status: "PAID", balanceDue: 0 });
  });

  it("PAY-033c: and the same the other way — typing ₹2,000 cash fills UPI with ₹3,000", () => {
    const draft = editPaymentField(initialPaymentDraft(5000, "SPLIT"), "cash", "2000", 5000);
    expect(draft.upi).toBe("3000");
  });

  it("PAY-034: a UPI amount above the total fills cash with zero, never a negative", () => {
    const next = editPaymentField(splitDraft(), "upi", "2500", TOTAL);
    expect(next.cash).toBe("0");
  });

  it("PAY-035: Fill balance sets the field to whatever is still owing", () => {
    let draft = editPaymentField(splitDraft(), "upi", "1000", TOTAL);
    draft = editPaymentField(draft, "cash", "100", TOTAL);
    draft = fillBalance(draft, "cash", TOTAL);

    expect(draft.cash).toBe("1000");
  });

  it("PAY-036: a typed 0 means 'nothing came in this way' and leaves a balance owing", () => {
    let draft = editPaymentField(splitDraft(), "upi", "3000", 5000);
    draft = editPaymentField(draft, "cash", "0", 5000);

    const resolved = resolveDraft(draft, 5000);
    expect(resolved.upiAmount).toBe(3000);
    expect(resolved.cashAmount).toBe(0);
    expect(resolved.balanceDue).toBe(2000);
    expect(resolved.status).toBe("PARTIAL");
  });

  it("PAY-037: amount edits are ignored outside Split mode", () => {
    const cashOnly = initialPaymentDraft(TOTAL, "CASH");
    expect(editPaymentField(cashOnly, "upi", "500", TOTAL)).toEqual(cashOnly);
  });

  it("PAY-038: switching option resets both fields to that option's shape", () => {
    let draft = editPaymentField(splitDraft(), "upi", "1000", TOTAL);
    draft = selectPaymentOption(draft, "UPI", TOTAL);

    expect(draft).toMatchObject({ option: "UPI", cash: "", upi: "2000" });
  });

  it("PAY-038b: Split opens with both sides blank, so the first figure typed fills the other", () => {
    expect(splitDraft()).toMatchObject({ option: "SPLIT", cash: "", upi: "" });
  });

  it("PAY-039: Not paid yet clears both amounts", () => {
    const draft = selectPaymentOption(splitDraft(), "UNPAID", TOTAL);
    expect(resolveDraft(draft, TOTAL)).toMatchObject({ mode: null, status: "PENDING" });
  });
});

describe("payment draft — recalculating when the bill total moves", () => {
  it("PAY-040: Full Cash follows the new total", () => {
    const draft = recalcForTotal(initialPaymentDraft(TOTAL, "CASH"), 2500);
    expect(draft.cash).toBe("2500");
  });

  it("PAY-041: Full UPI follows the new total", () => {
    const draft = recalcForTotal(initialPaymentDraft(TOTAL, "UPI"), 2500);
    expect(draft.upi).toBe("2500");
  });

  it("PAY-042: a Split whose amounts exceed a reduced total is clamped, never over-collected", () => {
    let draft = editPaymentField(initialPaymentDraft(TOTAL, "SPLIT"), "upi", "1000", TOTAL);
    draft = editPaymentField(draft, "cash", "500", TOTAL);
    draft = recalcForTotal(draft, 1200);

    const resolved = resolveDraft(draft, 1200);
    expect(resolved.upiAmount).toBe(1000);
    expect(resolved.cashAmount).toBe(200);
    expect(resolved.cashAmount + resolved.upiAmount).toBeLessThanOrEqual(1200);
  });

  it("PAY-043: amounts that still fit a larger total are left exactly as entered", () => {
    // Growing the bill must not quietly inflate what the customer handed
    // over — it grows the balance owing instead.
    let draft = editPaymentField(initialPaymentDraft(TOTAL, "SPLIT"), "upi", "800", TOTAL);
    draft = recalcForTotal(draft, 3000);

    expect(draft.upi).toBe("800");
    expect(draft.cash).toBe("1200");
    expect(resolveDraft(draft, 3000).balanceDue).toBe(1000);
  });

  it("PAY-043b: a blank Split field stays blank when the total moves", () => {
    const draft = recalcForTotal(initialPaymentDraft(TOTAL, "SPLIT"), 3000);
    expect(draft).toMatchObject({ cash: "", upi: "" });
  });

  it("PAY-044: Not paid yet and free service are unaffected by a total change", () => {
    expect(recalcForTotal(initialPaymentDraft(TOTAL, "UNPAID"), 5000)).toMatchObject({ cash: "", upi: "" });
    expect(recalcForTotal(initialPaymentDraft(TOTAL, "FREE_SERVICE"), 5000)).toMatchObject({ cash: "", upi: "" });
  });

  it("PAY-045: a total falling to zero zeroes the amounts and reads as PAID", () => {
    const draft = recalcForTotal(initialPaymentDraft(TOTAL, "CASH"), 0);
    expect(resolveDraft(draft, 0)).toMatchObject({ cashAmount: 0, upiAmount: 0, status: "PAID" });
  });
});

describe("formatPaidByLabel", () => {
  it("PAY-050: renders a split as both tenders", () => {
    expect(formatPaidByLabel({ mode: "SPLIT", cashAmount: 1000, upiAmount: 1000 })).toBe("Cash ₹1,000.00 · UPI ₹1,000.00");
  });

  it("PAY-051: renders a cash-only payment", () => {
    expect(formatPaidByLabel({ mode: "CASH", cashAmount: 2000, upiAmount: 0 })).toBe("Cash ₹2,000.00");
  });

  it("PAY-052: renders a UPI-only payment", () => {
    expect(formatPaidByLabel({ mode: "UPI", cashAmount: 0, upiAmount: 2000 })).toBe("UPI ₹2,000.00");
  });

  it("PAY-053: renders nothing when no mode was recorded", () => {
    expect(formatPaidByLabel({ mode: null, cashAmount: 0, upiAmount: 0 })).toBeNull();
  });
});

describe("draftToPaymentInput / draftFromPayment", () => {
  it("PAY-055: free service round-trips as its own option", () => {
    expect(draftToPaymentInput(initialPaymentDraft(TOTAL, "FREE_SERVICE"))).toMatchObject({ freeService: true });
    expect(draftFromPayment({ mode: null, cashAmount: 0, upiAmount: 0, freeService: true }, TOTAL).option).toBe("FREE_SERVICE");
  });

  it("PAY-056: an unpaid bill reopens on the Not paid yet option", () => {
    expect(draftFromPayment({ mode: null, cashAmount: 0, upiAmount: 0 }, TOTAL).option).toBe("UNPAID");
  });

  it("PAY-057: a settled cash bill reopens on Full — Cash", () => {
    expect(draftFromPayment({ mode: "CASH", cashAmount: 2000, upiAmount: 0 }, TOTAL).option).toBe("CASH");
  });

  it("PAY-058: a part payment reopens as Split with both sides manual, preserving the shortfall", () => {
    const draft = draftFromPayment({ mode: "CASH", cashAmount: 500, upiAmount: 0 }, TOTAL);

    expect(draft).toMatchObject({ option: "SPLIT", cash: "500", upi: "0" });
    expect(resolveDraft(draft, TOTAL).balanceDue).toBe(1500);
  });

  it("PAY-059: a split payment reopens with both stored amounts intact", () => {
    const draft = draftFromPayment({ mode: "SPLIT", cashAmount: 1000, upiAmount: 1000 }, TOTAL);
    expect(draft).toMatchObject({ option: "SPLIT", cash: "1000", upi: "1000" });
  });
});

describe("balanceDueFor", () => {
  it("PAY-060: a bill settled before tender was tracked owes nothing, despite zero recorded amounts", () => {
    expect(
      balanceDueFor({ paymentStatus: "PAID", mode: null, cashAmount: 0, upiAmount: 0, grandTotal: 3600 })
    ).toBe(0);
  });

  it("PAY-061: a free service owes nothing", () => {
    expect(
      balanceDueFor({ paymentStatus: "FREE_SERVICE", mode: null, cashAmount: 0, upiAmount: 0, grandTotal: 1150 })
    ).toBe(0);
  });

  it("PAY-062: an unpaid bill owes the full amount", () => {
    expect(
      balanceDueFor({ paymentStatus: "PENDING", mode: null, cashAmount: 0, upiAmount: 0, grandTotal: 2000 })
    ).toBe(2000);
  });

  it("PAY-063: a part payment owes the remainder", () => {
    expect(
      balanceDueFor({ paymentStatus: "PARTIAL", mode: "SPLIT", cashAmount: 500, upiAmount: 1000, grandTotal: 2000 })
    ).toBe(500);
  });
});
