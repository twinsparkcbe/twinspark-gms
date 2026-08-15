import { describe, expect, it } from "vitest";

import { createQueryBuilderMock, createSupabaseMock } from "../../test/supabase-query-mock";
import {
  CatalogEntryNotFoundError,
  createGeneralServicePackage,
  createSpecificService,
  DuplicateCatalogEntryError,
  listGeneralServicePackages,
  setGeneralServicePackageActive,
  setSpecificServiceActive,
  updateGeneralServicePackage,
  updateSpecificService,
} from "./catalog";

/**
 * Package/service create+update moved from direct table insert/update to
 * SECURITY DEFINER RPC calls (create_general_service_package etc. —
 * migration 0017) so that writing the base row and linking its Default
 * Items (doc §3, Revision 3) happens atomically. So these tests mock
 * `supabase.rpc` for the write, then the query builder for the re-fetch
 * every create/update does afterward (getGeneralServicePackage /
 * getSpecificService) to return the joined, mapped row.
 */

const packageRow = {
  id: "11111111-1111-4111-8111-111111111101",
  name: "Standard Service",
  included_items: ["Oil Change", "Water Wash"],
  service_charge: 650,
  is_active: true,
  created_at: "2026-07-16T10:00:00.000Z",
  general_service_package_items: [
    { inventory_item_id: "33333333-3333-4333-8333-333333333301", default_quantity: 1, inventory_items: { product_name: "Engine Oil 1L" } },
    { inventory_item_id: "33333333-3333-4333-8333-333333333302", default_quantity: 2, inventory_items: { product_name: "Oil Filter" } },
  ],
};

const specificRow = {
  id: "22222222-2222-4222-8222-222222222201",
  name: "Water Wash",
  default_charge: 150,
  is_active: true,
  created_at: "2026-07-16T10:00:00.000Z",
  specific_service_items: [{ inventory_item_id: "33333333-3333-4333-8333-333333333303", default_quantity: 1, inventory_items: { product_name: "Wash Soap" } }],
};

describe("createGeneralServicePackage", () => {
  it("calls create_general_service_package with mapped RPC params, then returns the re-fetched, mapped row", async () => {
    const builder = createQueryBuilderMock({ data: packageRow, error: null });
    const supabase = createSupabaseMock(builder, { data: "11111111-1111-4111-8111-111111111101", error: null });

    const result = await createGeneralServicePackage(supabase, {
      name: "Standard Service",
      includedItems: ["Oil Change", "Water Wash"],
      serviceCharge: 650,
      defaultItems: [
        { inventoryItemId: "33333333-3333-4333-8333-333333333301", defaultQuantity: 1 },
        { inventoryItemId: "33333333-3333-4333-8333-333333333302", defaultQuantity: 2 },
      ],
    });

    expect(supabase.rpc).toHaveBeenCalledWith("create_general_service_package", {
      p_name: "Standard Service",
      p_included_items: ["Oil Change", "Water Wash"],
      p_service_charge: 650,
      p_items: [
        { inventory_item_id: "33333333-3333-4333-8333-333333333301", default_quantity: 1 },
        { inventory_item_id: "33333333-3333-4333-8333-333333333302", default_quantity: 2 },
      ],
    });
    expect(result.name).toBe("Standard Service");
    expect(result.serviceCharge).toBe(650);
    expect(result.isActive).toBe(true);
    expect(result.defaultItems).toEqual([
      { inventoryItemId: "33333333-3333-4333-8333-333333333301", itemName: "Engine Oil 1L", defaultQuantity: 1 },
      { inventoryItemId: "33333333-3333-4333-8333-333333333302", itemName: "Oil Filter", defaultQuantity: 2 },
    ]);
  });

  it("defaults to an empty item list when defaultItems is omitted", async () => {
    const builder = createQueryBuilderMock({ data: { ...packageRow, general_service_package_items: [] }, error: null });
    const supabase = createSupabaseMock(builder, { data: "11111111-1111-4111-8111-111111111101", error: null });

    await createGeneralServicePackage(supabase, { name: "Standard Service", includedItems: [], serviceCharge: 650 });

    expect(supabase.rpc).toHaveBeenCalledWith("create_general_service_package", expect.objectContaining({ p_items: [] }));
  });

  it("throws DuplicateCatalogEntryError on a unique constraint violation (23505)", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "23505", message: "duplicate" } });

    await expect(
      createGeneralServicePackage(supabase, { name: "Standard Service", includedItems: [], serviceCharge: 650 })
    ).rejects.toBeInstanceOf(DuplicateCatalogEntryError);
  });
});

describe("updateGeneralServicePackage", () => {
  it("calls update_general_service_package with mapped RPC params, then returns the re-fetched, mapped row", async () => {
    const builder = createQueryBuilderMock({ data: packageRow, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    const result = await updateGeneralServicePackage(supabase, "11111111-1111-4111-8111-111111111101", {
      name: "Standard Service",
      includedItems: ["Oil Change", "Water Wash"],
      serviceCharge: 650,
      defaultItems: [{ inventoryItemId: "33333333-3333-4333-8333-333333333301", defaultQuantity: 1 }],
    });

    expect(supabase.rpc).toHaveBeenCalledWith("update_general_service_package", {
      p_id: "11111111-1111-4111-8111-111111111101",
      p_name: "Standard Service",
      p_included_items: ["Oil Change", "Water Wash"],
      p_service_charge: 650,
      p_items: [{ inventory_item_id: "33333333-3333-4333-8333-333333333301", default_quantity: 1 }],
    });
    expect(result.defaultItems).toHaveLength(2);
  });

  it("throws CatalogEntryNotFoundError when the RPC reports the package doesn't exist (P0002)", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "P0002", message: "not found" } });

    await expect(
      updateGeneralServicePackage(supabase, "missing", { name: "X", includedItems: [], serviceCharge: 0 })
    ).rejects.toBeInstanceOf(CatalogEntryNotFoundError);
  });

  it("throws DuplicateCatalogEntryError on a unique constraint violation (23505)", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "23505", message: "duplicate" } });

    await expect(
      updateGeneralServicePackage(supabase, "11111111-1111-4111-8111-111111111101", { name: "Standard Service", includedItems: [], serviceCharge: 650 })
    ).rejects.toBeInstanceOf(DuplicateCatalogEntryError);
  });
});

describe("createSpecificService", () => {
  it("calls create_specific_service with mapped RPC params, then returns the re-fetched, mapped row", async () => {
    const builder = createQueryBuilderMock({ data: specificRow, error: null });
    const supabase = createSupabaseMock(builder, { data: "22222222-2222-4222-8222-222222222201", error: null });

    const result = await createSpecificService(supabase, {
      name: "Water Wash",
      defaultCharge: 150,
      defaultItems: [{ inventoryItemId: "33333333-3333-4333-8333-333333333303", defaultQuantity: 1 }],
    });

    expect(supabase.rpc).toHaveBeenCalledWith("create_specific_service", {
      p_name: "Water Wash",
      p_default_charge: 150,
      p_items: [{ inventory_item_id: "33333333-3333-4333-8333-333333333303", default_quantity: 1 }],
    });
    expect(result.defaultItems).toEqual([{ inventoryItemId: "33333333-3333-4333-8333-333333333303", itemName: "Wash Soap", defaultQuantity: 1 }]);
  });

  it("sends null default_charge when omitted (a suggested price is optional)", async () => {
    const builder = createQueryBuilderMock({ data: { ...specificRow, default_charge: null }, error: null });
    const supabase = createSupabaseMock(builder, { data: "22222222-2222-4222-8222-222222222201", error: null });

    await createSpecificService(supabase, { name: "Chain Cleaning" });

    expect(supabase.rpc).toHaveBeenCalledWith("create_specific_service", expect.objectContaining({ p_default_charge: null }));
  });

  it("throws DuplicateCatalogEntryError on a unique constraint violation (23505)", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "23505", message: "duplicate" } });

    await expect(createSpecificService(supabase, { name: "Chain Cleaning" })).rejects.toBeInstanceOf(DuplicateCatalogEntryError);
  });
});

describe("updateSpecificService", () => {
  it("calls update_specific_service with mapped RPC params, then returns the re-fetched, mapped row", async () => {
    const builder = createQueryBuilderMock({ data: specificRow, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    const result = await updateSpecificService(supabase, "22222222-2222-4222-8222-222222222201", {
      name: "Water Wash",
      defaultCharge: 150,
      defaultItems: [{ inventoryItemId: "33333333-3333-4333-8333-333333333303", defaultQuantity: 1 }],
    });

    expect(supabase.rpc).toHaveBeenCalledWith("update_specific_service", {
      p_id: "22222222-2222-4222-8222-222222222201",
      p_name: "Water Wash",
      p_default_charge: 150,
      p_items: [{ inventory_item_id: "33333333-3333-4333-8333-333333333303", default_quantity: 1 }],
    });
    expect(result.name).toBe("Water Wash");
  });

  it("throws CatalogEntryNotFoundError when the RPC reports the service doesn't exist (P0002)", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "P0002", message: "not found" } });

    await expect(updateSpecificService(supabase, "missing", { name: "X" })).rejects.toBeInstanceOf(CatalogEntryNotFoundError);
  });
});

describe("listGeneralServicePackages", () => {
  it("filters to active-only when requested (picker use)", async () => {
    const builder = createQueryBuilderMock({ data: [packageRow], error: null });
    const supabase = createSupabaseMock(builder);

    await listGeneralServicePackages(supabase, true);

    expect(builder.eq).toHaveBeenCalledWith("is_active", true);
  });

  it("returns every entry, active and inactive, when activeOnly is false (Manage Catalog screen)", async () => {
    const builder = createQueryBuilderMock({ data: [packageRow, { ...packageRow, id: "11111111-1111-4111-8111-111111111102", is_active: false }], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listGeneralServicePackages(supabase, false);

    expect(result).toHaveLength(2);
    expect(builder.eq).not.toHaveBeenCalled();
  });

  it("maps each package's joined default items, falling back to 'Deleted item' when the inventory row is gone", async () => {
    const rowWithDeletedItem = {
      ...packageRow,
      general_service_package_items: [{ inventory_item_id: "33333333-3333-4333-8333-333333333309", default_quantity: 3, inventory_items: null }],
    };
    const builder = createQueryBuilderMock({ data: [rowWithDeletedItem], error: null });
    const supabase = createSupabaseMock(builder);

    const [result] = await listGeneralServicePackages(supabase, false);

    expect(result.defaultItems).toEqual([{ inventoryItemId: "33333333-3333-4333-8333-333333333309", itemName: "Deleted item", defaultQuantity: 3 }]);
  });
});

describe("setGeneralServicePackageActive / setSpecificServiceActive", () => {
  it("deactivates a package without deleting it (doc §16 — never hard-deleted)", async () => {
    const builder = createQueryBuilderMock({ data: { ...packageRow, is_active: false }, error: null });
    const supabase = createSupabaseMock(builder);

    const result = await setGeneralServicePackageActive(supabase, "11111111-1111-4111-8111-111111111101", false);

    expect(builder.update).toHaveBeenCalledWith({ is_active: false });
    expect(result.isActive).toBe(false);
  });

  it("deactivates a specific service the same way", async () => {
    const builder = createQueryBuilderMock({ data: { ...specificRow, is_active: false }, error: null });
    const supabase = createSupabaseMock(builder);

    const result = await setSpecificServiceActive(supabase, "22222222-2222-4222-8222-222222222201", false);

    expect(result.isActive).toBe(false);
  });
});
