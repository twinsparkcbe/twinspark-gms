import { describe, expect, it } from "vitest";

import { getSaleRowActions, saleHasReturn } from "./sale-row-actions";

const CAN_CORRECT = { canCorrect: true };
const CANNOT = { canCorrect: false };

const NORMAL = { voidedAt: null, hasReturn: false };
const VOIDED = { voidedAt: "2026-08-15T04:00:00.000Z", hasReturn: false };
const RETURNED = { voidedAt: null, hasReturn: true };

describe("getSaleRowActions", () => {
  it("offers edit and void on an ordinary sale", () => {
    const actions = getSaleRowActions(NORMAL, CAN_CORRECT);
    expect(actions.edit).not.toBeNull();
    expect(actions.void).not.toBeNull();
    expect(actions.blockedReason).toBeNull();
  });

  it("offers neither on a voided sale, and says why", () => {
    const actions = getSaleRowActions(VOIDED, CAN_CORRECT);
    expect(actions.edit).toBeNull();
    expect(actions.void).toBeNull();
    expect(actions.blockedReason).toBe("VOIDED");
    expect(actions.blockedMessage).toMatch(/voided/i);
  });

  // The database enforces this too (sale_returns.sale_item_id is ON DELETE
  // RESTRICT), so this is about explaining it before they click, not about
  // being the only guard.
  it("offers neither on a sale with a return, and points at undoing it", () => {
    const actions = getSaleRowActions(RETURNED, CAN_CORRECT);
    expect(actions.edit).toBeNull();
    expect(actions.void).toBeNull();
    expect(actions.blockedReason).toBe("HAS_RETURN");
    expect(actions.blockedMessage).toMatch(/undo the return first/i);
  });

  it("prefers the voided reason when a sale is both voided and returned", () => {
    expect(getSaleRowActions({ voidedAt: "2026-08-15T04:00:00.000Z", hasReturn: true }, CAN_CORRECT).blockedReason).toBe("VOIDED");
  });

  it("offers nothing to a viewer who can't correct sales", () => {
    const actions = getSaleRowActions(NORMAL, CANNOT);
    expect(actions.edit).toBeNull();
    expect(actions.void).toBeNull();
  });

  // A Mechanic doesn't need a tooltip explaining they're a Mechanic — only a
  // block that comes from the sale's own state gets explained.
  it("does not explain a permission-based absence", () => {
    expect(getSaleRowActions(NORMAL, CANNOT).blockedMessage).toBeNull();
  });

  it("still explains a state-based block to a viewer who couldn't act anyway", () => {
    expect(getSaleRowActions(VOIDED, CANNOT).blockedReason).toBe("VOIDED");
  });

  it("gives edit and void distinct labels", () => {
    const actions = getSaleRowActions(NORMAL, CAN_CORRECT);
    expect(actions.edit!.label).not.toBe(actions.void!.label);
  });
});

describe("saleHasReturn", () => {
  it("is false when nothing was returned", () => {
    expect(saleHasReturn({ lineItems: [{ returnedQuantity: 0 }, { returnedQuantity: 0 }] })).toBe(false);
  });

  it("is true when any line carries a return", () => {
    expect(saleHasReturn({ lineItems: [{ returnedQuantity: 0 }, { returnedQuantity: 2 }] })).toBe(true);
  });

  it("treats a missing count as no return", () => {
    expect(saleHasReturn({ lineItems: [{}, { returnedQuantity: null }] })).toBe(false);
  });
});
