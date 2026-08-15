import { describe, expect, it } from "vitest";

import { canReturnQuantity } from "./rules";

describe("canReturnQuantity", () => {
  // PUR-014: rejects a return quantity greater than what's remaining.
  it("allows a return within the remaining balance", () => {
    expect(canReturnQuantity(5, 7)).toBe(true);
  });

  it("allows a return exactly equal to the remaining balance", () => {
    expect(canReturnQuantity(7, 7)).toBe(true);
  });

  it("rejects a return greater than the remaining balance", () => {
    expect(canReturnQuantity(8, 7)).toBe(false);
  });

  // PUR-017: rejects quantity <= 0.
  it("rejects a zero or negative requested quantity", () => {
    expect(canReturnQuantity(0, 10)).toBe(false);
    expect(canReturnQuantity(-1, 10)).toBe(false);
  });

  // FIFO-010: remaining already accounts for anything sold out of the
  // batch, not just prior returns — nothing left means nothing returnable.
  it("rejects any return once nothing remains (sold out or fully returned)", () => {
    expect(canReturnQuantity(1, 0)).toBe(false);
  });
});
