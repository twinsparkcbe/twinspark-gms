import { describe, expect, it } from "vitest";

import { StockAdjustmentAuthError, StockAdjustmentValidationError } from "@/services/shared/stock";

import { createQueryBuilderMock, createSupabaseMock } from "../../test/supabase-query-mock";
import { createInventoryItemWithPurchase, DuplicateInventoryItemError } from "./item-creation";

const validInput = {
  itemType: "TRACK_TYRE" as const,
  productName: "MRF Nylogrip Zapper 100/90-17",
  skuCode: "MRF-ZAP-100-90-17",
  brandId: "b1111111-1111-1111-1111-111111111111",
  lowStockThreshold: 5,
  imageUrl: null,
  customTypeLabel: null,
  quantity: 50,
  unitPrice: 1000,
  sellingPrice: 1400,
  purchaseDate: new Date("2026-07-01T10:00:00.000Z"),
  supplierName: "ABC Tyre Distributors",
  note: "First stock-in",
};

const itemRow = {
  id: "item-1",
  item_type: "TRACK_TYRE",
  product_name: validInput.productName,
  sku_code: validInput.skuCode,
  brand_id: validInput.brandId,
  purchase_price: 1000,
  selling_price: 1400,
  available_quantity: 50,
  low_stock_threshold: 5,
  stock_status: "in_stock",
  is_active: true,
  image_url: null,
  custom_type_label: null,
  brands: null,
};

// NEW-01/03/05: happy path — creates the item + opening batch atomically via
// create_inventory_item_with_purchase(), returns the full mapped item.
describe("createInventoryItemWithPurchase", () => {
  it("calls create_inventory_item_with_purchase with the right params and returns the mapped item", async () => {
    const builder = createQueryBuilderMock({ data: itemRow, error: null });
    const supabase = createSupabaseMock(builder, { data: "item-1", error: null });

    const result = await createInventoryItemWithPurchase(supabase, validInput);

    expect(supabase.rpc).toHaveBeenCalledWith("create_inventory_item_with_purchase", {
      p_item_type: "TRACK_TYRE",
      p_product_name: validInput.productName,
      p_sku_code: validInput.skuCode,
      p_brand_id: validInput.brandId,
      p_low_stock_threshold: 5,
      p_custom_type_label: null,
      p_image_url: null,
      p_quantity: 50,
      p_unit_price: 1000,
      p_selling_price: 1400,
      p_purchase_date: validInput.purchaseDate.toISOString(),
      p_supplier_name: "ABC Tyre Distributors",
      p_note: "First stock-in",
    });
    expect(result.id).toBe("item-1");
    expect(result.availableQuantity).toBe(50);
  });

  // NEW-03: blank SKU is sent as null so the DB auto-generates one.
  it("sends null sku_code when left blank", async () => {
    const builder = createQueryBuilderMock({ data: itemRow, error: null });
    const supabase = createSupabaseMock(builder, { data: "item-1", error: null });

    await createInventoryItemWithPurchase(supabase, { ...validInput, skuCode: "" });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_inventory_item_with_purchase",
      expect.objectContaining({ p_sku_code: null })
    );
  });

  it("sends custom_type_label only for Other Spare Part", async () => {
    const builder = createQueryBuilderMock({ data: itemRow, error: null });
    const supabase = createSupabaseMock(builder, { data: "item-1", error: null });

    await createInventoryItemWithPurchase(supabase, {
      ...validInput,
      itemType: "OTHER_SPARE_PART",
      customTypeLabel: "Helmet Lock",
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_inventory_item_with_purchase",
      expect.objectContaining({ p_custom_type_label: "Helmet Lock" })
    );
  });

  // NEW-02: schema-level validation (quantity/prices <= 0, missing brand,
  // missing product name) is rejected before ever calling Supabase.
  it("throws a validation error for a non-positive quantity without calling Supabase", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(
      createInventoryItemWithPurchase(supabase, { ...validInput, quantity: 0 })
    ).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("throws a validation error when brandId is missing", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);
    const { brandId: _brandId, ...withoutBrand } = validInput;

    await expect(
      createInventoryItemWithPurchase(supabase, withoutBrand as unknown as typeof validInput)
    ).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  // NEW-04: duplicate SKU/name surfaces as the same friendly error Inventory
  // used to raise directly.
  it("throws DuplicateInventoryItemError for a duplicate SKU", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, {
      data: null,
      error: { code: "23505", message: 'duplicate key value violates unique constraint "inventory_items_sku_code_key"' },
    });

    await expect(createInventoryItemWithPurchase(supabase, validInput)).rejects.toBeInstanceOf(
      DuplicateInventoryItemError
    );
  });

  // NEW-05: non-admin caller is rejected (create_inventory_item_with_purchase
  // checks the role itself before writing anything).
  it("throws StockAdjustmentAuthError on DB error code 42501", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "42501", message: "not authorized" } });

    await expect(createInventoryItemWithPurchase(supabase, validInput)).rejects.toBeInstanceOf(
      StockAdjustmentAuthError
    );
  });

  it("throws StockAdjustmentValidationError on DB error code 22023", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "22023", message: "bad input" } });

    await expect(createInventoryItemWithPurchase(supabase, validInput)).rejects.toBeInstanceOf(
      StockAdjustmentValidationError
    );
  });
});
