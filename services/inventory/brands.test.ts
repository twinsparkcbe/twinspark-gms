import { describe, expect, it } from "vitest";

import { createQueryBuilderMock, createSupabaseMock } from "../../test/supabase-query-mock";
import { BrandInUseError, createBrand, deleteBrand, DuplicateBrandError } from "./brands";

describe("createBrand", () => {
  // INV-025: create brand succeeds.
  it("creates a brand scoped to an item type", async () => {
    const builder = createQueryBuilderMock({
      data: { id: "brand-1", name: "Pirelli", item_type: "BRAND_NEW_TYRE" },
      error: null,
    });
    const supabase = createSupabaseMock(builder);

    const result = await createBrand(supabase, { name: "Pirelli", itemType: "BRAND_NEW_TYRE" });

    expect(result).toEqual({ id: "brand-1", name: "Pirelli", itemType: "BRAND_NEW_TYRE" });
  });

  it("throws DuplicateBrandError on a unique-constraint violation", async () => {
    const builder = createQueryBuilderMock({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    const supabase = createSupabaseMock(builder);

    await expect(
      createBrand(supabase, { name: "Pirelli", itemType: "BRAND_NEW_TYRE" })
    ).rejects.toBeInstanceOf(DuplicateBrandError);
  });
});

describe("deleteBrand", () => {
  // INV-029: delete unused brand succeeds.
  it("deletes an unused brand", async () => {
    const builder = createQueryBuilderMock({ data: { id: "brand-1" }, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(deleteBrand(supabase, "brand-1")).resolves.toBeUndefined();
  });

  // INV-030: delete blocked when the brand is referenced by an item.
  it("throws BrandInUseError when referenced by an inventory item", async () => {
    const builder = createQueryBuilderMock({
      data: null,
      error: { code: "23503", message: "foreign key constraint" },
    });
    const supabase = createSupabaseMock(builder);

    await expect(deleteBrand(supabase, "brand-1")).rejects.toBeInstanceOf(BrandInUseError);
  });
});
