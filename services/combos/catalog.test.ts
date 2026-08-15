import { describe, expect, it } from "vitest";

import { createQueryBuilderMock, createSupabaseMock } from "../../test/supabase-query-mock";

import {
  ComboAuthError,
  ComboInUseError,
  ComboValidationError,
  DuplicateComboError,
  createCombo,
  deleteCombo,
  duplicateCombo,
  listCombos,
  listSellableCombos,
  setComboActive,
  updateCombo,
} from "./catalog";

const COMBO_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PKG = "11111111-1111-4111-8111-111111111101";
const SVC = "22222222-2222-4222-8222-222222222201";
const ITEM = "33333333-3333-4333-8333-333333333301";

const comboRow = {
  id: COMBO_ID,
  name: "₹7,499 Combo",
  description: "Tyres + general service + wash",
  combo_price: 7499,
  valid_from: "2026-08-01",
  valid_to: "2026-08-31",
  is_active: true,
  created_at: "2026-08-01T00:00:00.000Z",
  combo_components: [
    {
      id: "component-2",
      position: 1,
      component_type: "PACKAGE",
      general_service_package_id: PKG,
      specific_service_id: null,
      inventory_item_id: null,
      quantity: 1,
      pricing: "INCLUDED",
      general_service_packages: { name: "General Service", service_charge: 850 },
      specific_services: null,
      inventory_items: null,
    },
    {
      id: "component-1",
      position: 0,
      component_type: "ITEM",
      general_service_package_id: null,
      specific_service_id: null,
      inventory_item_id: ITEM,
      quantity: 2,
      pricing: "INCLUDED",
      general_service_packages: null,
      specific_services: null,
      inventory_items: { product_name: "Front Tyre", selling_price: 3200, purchase_price: 1900, available_quantity: 6 },
    },
  ],
};

const validInput = {
  name: "₹7,499 Combo",
  comboPrice: 7499,
  components: [{ componentType: "ITEM" as const, inventoryItemId: ITEM, quantity: 2, pricing: "INCLUDED" as const }],
};

describe("createCombo", () => {
  it("calls create_combo with mapped RPC params, then returns the re-fetched combo", async () => {
    const builder = createQueryBuilderMock({ data: comboRow, error: null });
    const supabase = createSupabaseMock(builder, { data: COMBO_ID, error: null });

    const result = await createCombo(supabase, { ...validInput, description: "Tyres", validFrom: "2026-08-01", validTo: "2026-08-31" });

    expect(supabase.rpc).toHaveBeenCalledWith("create_combo", {
      p_name: "₹7,499 Combo",
      p_description: "Tyres",
      p_combo_price: 7499,
      p_valid_from: "2026-08-01",
      p_valid_to: "2026-08-31",
      p_components: [
        { component_type: "ITEM", general_service_package_id: null, specific_service_id: null, inventory_item_id: ITEM, quantity: 2, pricing: "INCLUDED" },
      ],
    });
    expect(result.id).toBe(COMBO_ID);
  });

  it("sends null for omitted description and dates", async () => {
    const builder = createQueryBuilderMock({ data: comboRow, error: null });
    const supabase = createSupabaseMock(builder, { data: COMBO_ID, error: null });

    await createCombo(supabase, validInput);

    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_combo",
      expect.objectContaining({ p_description: null, p_valid_from: null, p_valid_to: null })
    );
  });

  it("merges a repeated product before sending, so the unique index can't reject it", async () => {
    const builder = createQueryBuilderMock({ data: comboRow, error: null });
    const supabase = createSupabaseMock(builder, { data: COMBO_ID, error: null });

    await createCombo(supabase, {
      ...validInput,
      components: [
        { componentType: "ITEM", inventoryItemId: ITEM, quantity: 1, pricing: "INCLUDED" },
        { componentType: "ITEM", inventoryItemId: ITEM, quantity: 1, pricing: "INCLUDED" },
      ],
    });

    const sent = (supabase.rpc as unknown as { mock: { calls: [string, { p_components: unknown[] }][] } }).mock.calls[0][1];
    expect(sent.p_components).toHaveLength(1);
    expect(sent.p_components[0]).toMatchObject({ quantity: 2 });
  });

  it("rejects an empty combo before it reaches the database", async () => {
    const supabase = createSupabaseMock(createQueryBuilderMock({ data: null, error: null }));

    await expect(createCombo(supabase, { ...validInput, components: [] })).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("throws DuplicateComboError on a unique constraint violation (23505)", async () => {
    const supabase = createSupabaseMock(createQueryBuilderMock({ data: null, error: null }), { data: null, error: { code: "23505", message: "duplicate" } });

    await expect(createCombo(supabase, validInput)).rejects.toBeInstanceOf(DuplicateComboError);
  });

  it("throws ComboAuthError when a non-admin tries to define a combo (42501)", async () => {
    const supabase = createSupabaseMock(createQueryBuilderMock({ data: null, error: null }), { data: null, error: { code: "42501", message: "denied" } });

    await expect(createCombo(supabase, validInput)).rejects.toBeInstanceOf(ComboAuthError);
  });

  it("throws ComboValidationError on a server-side check failure (22023)", async () => {
    const supabase = createSupabaseMock(createQueryBuilderMock({ data: null, error: null }), {
      data: null,
      error: { code: "22023", message: "A combo needs at least one component" },
    });

    await expect(createCombo(supabase, validInput)).rejects.toBeInstanceOf(ComboValidationError);
  });
});

describe("updateCombo", () => {
  it("calls update_combo with the id and a full-replace component list", async () => {
    const builder = createQueryBuilderMock({ data: comboRow, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    await updateCombo(supabase, COMBO_ID, validInput);

    expect(supabase.rpc).toHaveBeenCalledWith("update_combo", expect.objectContaining({ p_id: COMBO_ID, p_combo_price: 7499 }));
  });

  it("throws ComboValidationError when the combo no longer exists (P0002)", async () => {
    const supabase = createSupabaseMock(createQueryBuilderMock({ data: null, error: null }), { data: null, error: { code: "P0002", message: "not found" } });

    await expect(updateCombo(supabase, COMBO_ID, validInput)).rejects.toBeInstanceOf(ComboValidationError);
  });
});

describe("duplicateCombo", () => {
  it("calls duplicate_combo with the source id and the new name", async () => {
    const builder = createQueryBuilderMock({ data: comboRow, error: null });
    const supabase = createSupabaseMock(builder, { data: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", error: null });

    await duplicateCombo(supabase, COMBO_ID, "₹7,499 Combo — Apache");

    expect(supabase.rpc).toHaveBeenCalledWith("duplicate_combo", { p_id: COMBO_ID, p_new_name: "₹7,499 Combo — Apache" });
  });

  it("rejects a blank new name before calling the database", async () => {
    const supabase = createSupabaseMock(createQueryBuilderMock({ data: null, error: null }));

    await expect(duplicateCombo(supabase, COMBO_ID, "   ")).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("setComboActive", () => {
  it("switches a combo off without deleting it", async () => {
    const builder = createQueryBuilderMock({ data: { ...comboRow, is_active: false }, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    const result = await setComboActive(supabase, COMBO_ID, false);

    expect(supabase.rpc).toHaveBeenCalledWith("set_combo_active", { p_id: COMBO_ID, p_is_active: false });
    expect(result.isActive).toBe(false);
  });
});

describe("listCombos", () => {
  it("maps a joined combo, sorting components by position", async () => {
    const builder = createQueryBuilderMock({ data: [comboRow], error: null });
    const supabase = createSupabaseMock(builder);

    const [combo] = await listCombos(supabase);

    expect(combo.components.map((c) => c.name)).toEqual(["Front Tyre", "General Service"]);
  });

  it("resolves each component's display name and unit price from its join", async () => {
    const supabase = createSupabaseMock(createQueryBuilderMock({ data: [comboRow], error: null }));

    const [combo] = await listCombos(supabase);

    expect(combo.components[0]).toMatchObject({ name: "Front Tyre", unitPrice: 3200, unitPurchasePrice: 1900, availableQuantity: 6 });
    expect(combo.components[1]).toMatchObject({ name: "General Service", unitPrice: 850, unitPurchasePrice: null });
  });

  it("falls back to 'Deleted item' when a referenced row has gone", async () => {
    const orphaned = {
      ...comboRow,
      combo_components: [{ ...comboRow.combo_components[1], inventory_items: null }],
    };
    const supabase = createSupabaseMock(createQueryBuilderMock({ data: [orphaned], error: null }));

    const [combo] = await listCombos(supabase);

    expect(combo.components[0].name).toBe("Deleted item");
  });

  it("filters to active combos only when asked (picker use)", async () => {
    const builder = createQueryBuilderMock({ data: [comboRow], error: null });
    const supabase = createSupabaseMock(builder);

    await listCombos(supabase, true);

    expect(builder.eq).toHaveBeenCalledWith("is_active", true);
  });

  it("returns switched-off combos too for the management screen", async () => {
    const builder = createQueryBuilderMock({ data: [comboRow], error: null });
    const supabase = createSupabaseMock(builder);

    await listCombos(supabase, false);

    expect(builder.eq).not.toHaveBeenCalled();
  });

  it("returns an empty list before any combo exists", async () => {
    const supabase = createSupabaseMock(createQueryBuilderMock({ data: [], error: null }));

    expect(await listCombos(supabase)).toEqual([]);
  });

  it("unwraps an array-shaped join the same as a single object", async () => {
    const arrayShaped = {
      ...comboRow,
      combo_components: [{ ...comboRow.combo_components[1], inventory_items: [{ product_name: "Front Tyre", selling_price: 3200, purchase_price: 1900, available_quantity: 6 }] }],
    };
    const supabase = createSupabaseMock(createQueryBuilderMock({ data: [arrayShaped], error: null }));

    const [combo] = await listCombos(supabase);

    expect(combo.components[0].name).toBe("Front Tyre");
  });
});

describe("deleteCombo", () => {
  it("calls delete_combo for a combo nothing references", async () => {
    const supabase = createSupabaseMock(createQueryBuilderMock({ data: null, error: null }), { data: null, error: null });

    await deleteCombo(supabase, COMBO_ID);

    expect(supabase.rpc).toHaveBeenCalledWith("delete_combo", { p_id: COMBO_ID });
  });

  it("throws ComboInUseError when the combo has history behind it (23503)", async () => {
    const supabase = createSupabaseMock(createQueryBuilderMock({ data: null, error: null }), {
      data: null,
      error: { code: "23503", message: "This combo has been used on 3 job(s) and 1 sale(s)" },
    });

    await expect(deleteCombo(supabase, COMBO_ID)).rejects.toBeInstanceOf(ComboInUseError);
  });

  it("surfaces the server's message verbatim, since it names the actual counts", async () => {
    const supabase = createSupabaseMock(createQueryBuilderMock({ data: null, error: null }), {
      data: null,
      error: { code: "23503", message: "This combo has been used on 3 job(s) and 1 sale(s)" },
    });

    await expect(deleteCombo(supabase, COMBO_ID)).rejects.toThrow("3 job(s) and 1 sale(s)");
  });

  it("throws ComboAuthError when a non-admin attempts it", async () => {
    const supabase = createSupabaseMock(createQueryBuilderMock({ data: null, error: null }), {
      data: null,
      error: { code: "42501", message: "denied" },
    });

    await expect(deleteCombo(supabase, COMBO_ID)).rejects.toBeInstanceOf(ComboAuthError);
  });

  it("reports a missing combo rather than silently succeeding", async () => {
    const supabase = createSupabaseMock(createQueryBuilderMock({ data: null, error: null }), {
      data: null,
      error: { code: "P0002", message: "not found" },
    });

    await expect(deleteCombo(supabase, COMBO_ID)).rejects.toBeInstanceOf(ComboValidationError);
  });
});

describe("listSellableCombos", () => {
  const NOW = new Date("2026-08-15T06:30:00.000Z"); // midday IST on 15 Aug

  function withWindow(validFrom: string | null, validTo: string | null, isActive = true) {
    return createSupabaseMock(createQueryBuilderMock({ data: [{ ...comboRow, valid_from: validFrom, valid_to: validTo, is_active: isActive }], error: null }));
  }

  it("asks the database for active combos only", async () => {
    const builder = createQueryBuilderMock({ data: [comboRow], error: null });
    const supabase = createSupabaseMock(builder);

    await listSellableCombos(supabase, NOW);

    expect(builder.eq).toHaveBeenCalledWith("is_active", true);
  });

  it("keeps a combo inside its offer window", async () => {
    expect(await listSellableCombos(withWindow("2026-08-01", "2026-08-31"), NOW)).toHaveLength(1);
  });

  it("keeps a combo with no dates at all", async () => {
    expect(await listSellableCombos(withWindow(null, null), NOW)).toHaveLength(1);
  });

  it("keeps a combo on the first and last day of its window", async () => {
    expect(await listSellableCombos(withWindow("2026-08-15", "2026-08-15"), NOW)).toHaveLength(1);
  });

  it("drops a combo whose offer has ended", async () => {
    expect(await listSellableCombos(withWindow(null, "2026-08-14"), NOW)).toEqual([]);
  });

  it("drops a combo whose offer hasn't started", async () => {
    expect(await listSellableCombos(withWindow("2026-09-01", null), NOW)).toEqual([]);
  });

  it("returns nothing when no combos exist", async () => {
    expect(await listSellableCombos(createSupabaseMock(createQueryBuilderMock({ data: [], error: null })), NOW)).toEqual([]);
  });
});
