import { describe, expect, it } from "vitest";

import { comboCoversFitting, resolveCombo } from "./resolve";
import type { ComboComponentRow, ComboRow } from "./types";

const COMBO_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PKG = "11111111-1111-4111-8111-111111111101";
const SVC = "22222222-2222-4222-8222-222222222201";
const TYRE = "33333333-3333-4333-8333-333333333301";
const OIL = "33333333-3333-4333-8333-333333333302";

const NOW = new Date("2026-08-15T06:30:00.000Z"); // midday IST

let position = 0;

function component(overrides: Partial<ComboComponentRow> = {}): ComboComponentRow {
  return {
    id: `component-${position}`,
    position: position++,
    componentType: "ITEM",
    generalServicePackageId: null,
    specificServiceId: null,
    inventoryItemId: OIL,
    quantity: 1,
    pricing: "INCLUDED",
    name: "Engine Oil 1L",
    unitPrice: 450,
    unitPurchasePrice: 300,
    availableQuantity: 10,
    ...overrides,
  };
}

function combo(overrides: Partial<ComboRow> = {}): ComboRow {
  position = 0;
  return {
    id: COMBO_ID,
    name: "₹7,499 Combo",
    description: null,
    comboPrice: 7499,
    validFrom: null,
    validTo: null,
    isActive: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    components: [component()],
    ...overrides,
  };
}

function resolved(input: ComboRow, quantity = 1) {
  const result = resolveCombo(input, { quantity, now: NOW });
  if (!result.ok) throw new Error(`expected resolution, got: ${result.reason}`);
  return result.resolution;
}

describe("resolveCombo — the charge line", () => {
  it("adds exactly one charge line for the combo itself", () => {
    const { charges } = resolved(combo());

    expect(charges).toHaveLength(1);
    expect(charges[0].source).toBe("COMBO");
  });

  it("prices that line at the combo price, not the sum of its contents", () => {
    expect(resolved(combo()).charges[0].rate).toBe(7499);
  });

  it("describes the line with the combo name, snapshotted", () => {
    expect(resolved(combo()).charges[0].description).toBe("₹7,499 Combo");
  });

  it("carries the combo id, so reports can group by offer", () => {
    expect(resolved(combo()).charges[0].comboId).toBe(COMBO_ID);
  });
});

describe("resolveCombo — included contents", () => {
  it("turns an included item into a part row priced at zero", () => {
    const { parts } = resolved(combo());

    expect(parts).toEqual([{ comboId: COMBO_ID, inventoryItemId: OIL, quantity: 1, unitPrice: 0, includedInCombo: true }]);
  });

  it("still records the item, so stock moves and COGS is answerable", () => {
    expect(resolved(combo()).parts[0].inventoryItemId).toBe(OIL);
  });

  it("raises no separate charge for an included package", () => {
    const withPackage = combo({
      components: [component({ componentType: "PACKAGE", generalServicePackageId: PKG, inventoryItemId: null, name: "General Service", unitPrice: 850 })],
    });

    expect(resolved(withPackage).charges).toHaveLength(1); // the combo line only
  });

  it("lists an included package in the printed breakdown", () => {
    const withPackage = combo({
      components: [component({ componentType: "PACKAGE", generalServicePackageId: PKG, inventoryItemId: null, name: "General Service", unitPrice: 850 })],
    });

    expect(resolved(withPackage).contents).toEqual([{ label: "General Service", quantity: 1 }]);
  });

  it("lists an included specific service in the breakdown", () => {
    const withWash = combo({
      components: [component({ componentType: "SPECIFIC", specificServiceId: SVC, inventoryItemId: null, name: "Water Wash", unitPrice: 150 })],
    });

    expect(resolved(withWash).contents).toEqual([{ label: "Water Wash", quantity: 1 }]);
  });

  it("lists included items in the breakdown too", () => {
    expect(resolved(combo()).contents).toEqual([{ label: "Engine Oil 1L", quantity: 1 }]);
  });
});

describe("resolveCombo — EXTRA contents", () => {
  it("prices an extra item at its own selling price", () => {
    const withExtra = combo({ components: [component({ pricing: "EXTRA" })] });

    expect(resolved(withExtra).parts[0]).toMatchObject({ unitPrice: 450, includedInCombo: false });
  });

  it("raises a separate charge line for an extra specific service", () => {
    const withExtra = combo({
      components: [component({ componentType: "SPECIFIC", specificServiceId: SVC, inventoryItemId: null, name: "Fork Oil Change", unitPrice: 600, pricing: "EXTRA" })],
    });

    const { charges } = resolved(withExtra);
    expect(charges).toHaveLength(2);
    expect(charges[1]).toMatchObject({ source: "EXTRA_SPECIFIC", description: "Fork Oil Change", rate: 600 });
  });

  it("keeps extra contents out of the unpriced breakdown — they show their own price", () => {
    const withExtra = combo({ components: [component({ pricing: "EXTRA" })] });

    expect(resolved(withExtra).contents).toEqual([]);
  });
});

describe("resolveCombo — quantity", () => {
  it("multiplies the combo line quantity", () => {
    expect(resolved(combo(), 2).charges[0].quantity).toBe(2);
  });

  it("multiplies every content — two combos means two sets of parts out of stock", () => {
    const twoTyres = combo({ components: [component({ inventoryItemId: TYRE, name: "Tyre", quantity: 2 })] });

    expect(resolved(twoTyres, 2).parts[0].quantity).toBe(4);
  });

  it("multiplies the breakdown quantities to match", () => {
    expect(resolved(combo(), 3).contents[0].quantity).toBe(3);
  });

  it("rejects a zero or negative quantity", () => {
    expect(resolveCombo(combo(), { quantity: 0, now: NOW }).ok).toBe(false);
  });
});

describe("resolveCombo — availability", () => {
  it("refuses a switched-off combo with a readable reason", () => {
    const result = resolveCombo(combo({ isActive: false }), { quantity: 1, now: NOW });

    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("switched off") });
  });

  it("refuses an expired combo", () => {
    const result = resolveCombo(combo({ validTo: "2026-08-01" }), { quantity: 1, now: NOW });

    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("has ended") });
  });

  it("refuses a combo whose offer hasn't started", () => {
    const result = resolveCombo(combo({ validFrom: "2026-09-01" }), { quantity: 1, now: NOW });

    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("hasn't started") });
  });

  it("refuses an empty combo rather than billing a price for nothing", () => {
    const result = resolveCombo(combo({ components: [] }), { quantity: 1, now: NOW });

    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("nothing in it") });
  });
});

describe("resolveCombo — the poster combo end to end", () => {
  const poster = combo({
    components: [
      component({ inventoryItemId: TYRE, name: "Front Tyre", quantity: 1, unitPrice: 2800, unitPurchasePrice: 1900 }),
      component({ inventoryItemId: OIL, name: "Rear Tyre", quantity: 1, unitPrice: 3000, unitPurchasePrice: 2000 }),
      component({ componentType: "PACKAGE", generalServicePackageId: PKG, inventoryItemId: null, name: "General Service", unitPrice: 850 }),
      component({ componentType: "SPECIFIC", specificServiceId: SVC, inventoryItemId: null, name: "Water Wash", unitPrice: 150 }),
    ],
  });

  it("bills one line at ₹7,499", () => {
    const { charges } = resolved(poster);

    expect(charges).toHaveLength(1);
    expect(charges[0].rate).toBe(7499);
  });

  it("moves both tyres out of stock at ₹0", () => {
    const { parts } = resolved(poster);

    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.unitPrice === 0 && p.includedInCombo)).toBe(true);
  });

  it("lists all four contents in the printed breakdown", () => {
    expect(resolved(poster).contents.map((c) => c.label)).toEqual(["Front Tyre", "Rear Tyre", "General Service", "Water Wash"]);
  });
});

describe("comboCoversFitting", () => {
  const isTyre = (id: string) => id === TYRE;

  it("is true when the combo contains a tyre", () => {
    const withTyre = combo({ components: [component({ inventoryItemId: TYRE, name: "Front Tyre" })] });

    expect(comboCoversFitting(withTyre, isTyre)).toBe(true);
  });

  it("is false for a service-only combo", () => {
    const serviceOnly = combo({
      components: [component({ componentType: "SPECIFIC", specificServiceId: SVC, inventoryItemId: null, name: "Water Wash" })],
    });

    expect(comboCoversFitting(serviceOnly, isTyre)).toBe(false);
  });

  it("is false when the only parts are non-tyre consumables", () => {
    expect(comboCoversFitting(combo(), isTyre)).toBe(false);
  });
});
