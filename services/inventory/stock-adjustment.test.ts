import { describe, expect, it, vi } from "vitest";

import * as sharedStock from "@/services/shared/stock";

import { adjustInventoryStock } from "./stock-adjustment";

const baseInput = {
  itemId: "11111111-1111-1111-1111-111111111111",
  delta: -2,
  reasonLabel: "Damaged" as const,
  note: "2 units damaged in transit",
};

describe("adjustInventoryStock", () => {
  // doc/inventory-purchase-simplification-scope.md §2.2: Damaged,
  // Manufacturing Defect, and Lost/Missing all map to the DAMAGE reason.
  it.each(["Damaged", "Manufacturing Defect", "Lost/Missing"] as const)(
    "maps '%s' to the DAMAGE reason",
    async (reasonLabel) => {
      const spy = vi.spyOn(sharedStock, "adjustStock").mockResolvedValue(8);

      await adjustInventoryStock({} as never, { ...baseInput, reasonLabel });

      expect(spy).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ reason: "DAMAGE", sourceModule: "inventory" })
      );
      spy.mockRestore();
    }
  );

  // Customer Return, Supplier Return, Manual Correction, and Other all map
  // to MANUAL_CORRECTION.
  it.each(["Customer Return", "Supplier Return", "Manual Correction"] as const)(
    "maps '%s' to the MANUAL_CORRECTION reason",
    async (reasonLabel) => {
      const spy = vi.spyOn(sharedStock, "adjustStock").mockResolvedValue(13);

      await adjustInventoryStock({} as never, { ...baseInput, reasonLabel, delta: 3 });

      expect(spy).toHaveBeenCalledWith({}, expect.objectContaining({ reason: "MANUAL_CORRECTION" }));
      spy.mockRestore();
    }
  );

  it("includes the reason label and note in the logged note text", async () => {
    const spy = vi.spyOn(sharedStock, "adjustStock").mockResolvedValue(8);

    await adjustInventoryStock({} as never, baseInput);

    expect(spy).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ note: "Damaged: 2 units damaged in transit" })
    );
    spy.mockRestore();
  });

  // INV-040/041: note is optional now. When omitted, the reason label alone
  // is logged (so the audit trail still records why), and the call proceeds.
  it("allows a missing note and logs the reason label alone", async () => {
    const spy = vi.spyOn(sharedStock, "adjustStock").mockResolvedValue(8);

    await expect(adjustInventoryStock({} as never, { ...baseInput, note: "" })).resolves.toBe(8);
    expect(spy).toHaveBeenCalledWith({}, expect.objectContaining({ note: "Damaged" }));
    spy.mockRestore();
  });

  // FIFO batch tracking (0010_purchase_batch_fifo.sql): a positive
  // adjustment's unitCost is forwarded so the shared service can seed a
  // synthetic batch at that cost.
  it("forwards unitCost for a positive adjustment", async () => {
    const spy = vi.spyOn(sharedStock, "adjustStock").mockResolvedValue(120);

    await adjustInventoryStock({} as never, {
      itemId: "11111111-1111-1111-1111-111111111111",
      delta: 100,
      reasonLabel: "Manual Correction",
      note: "Found extra stock during audit",
      unitCost: 950,
    });

    expect(spy).toHaveBeenCalledWith({}, expect.objectContaining({ unitCost: 950 }));
    spy.mockRestore();
  });

  // unitCost is optional — omitting it lets the DB function fall back to
  // the item's most recent batch cost.
  it("passes unitCost through as undefined when not given", async () => {
    const spy = vi.spyOn(sharedStock, "adjustStock").mockResolvedValue(120);

    await adjustInventoryStock({} as never, {
      itemId: "11111111-1111-1111-1111-111111111111",
      delta: 100,
      reasonLabel: "Manual Correction",
      note: "Found extra stock during audit",
    });

    expect(spy).toHaveBeenCalledWith({}, expect.objectContaining({ unitCost: undefined }));
    spy.mockRestore();
  });

  // "Other" logs the user's own customReason text as the label instead of
  // the literal word "Other", so the audit trail/reporting shows what it
  // actually was (e.g. "Vendor return") rather than a generic bucket name.
  it("uses customReason as the logged label for 'Other'", async () => {
    const spy = vi.spyOn(sharedStock, "adjustStock").mockResolvedValue(5);

    await adjustInventoryStock({} as never, {
      itemId: "11111111-1111-1111-1111-111111111111",
      delta: -1,
      reasonLabel: "Other",
      customReason: "Vendor return",
      note: "Returned a defective unit to the vendor",
    });

    expect(spy).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        reason: "MANUAL_CORRECTION",
        note: "Vendor return: Returned a defective unit to the vendor",
      })
    );
    spy.mockRestore();
  });
});
