"use client";

import { useMemo } from "react";

import { Combobox } from "@/components/ui/combobox";
import type { BrandRow } from "@/services/inventory";

type CreateBrandResult = { success: boolean; data?: BrandRow; error?: string };

/**
 * Brand is required on every item type now (Category was removed entirely —
 * see 0004_remove_category_universal_brand.sql). Rather than force the user
 * out to a separate "Manage Brands" screen before they can pick a brand
 * that doesn't exist yet, this combobox lets them search existing brands
 * (fetched from the DB via the `brands` prop) and, if nothing matches,
 * create the brand inline without leaving the item form.
 *
 * This is a thin, brand-specific wrapper around the reusable {@link Combobox}
 * primitive — it only maps BrandRow[] to options and adapts the create result.
 */
export function BrandCombobox({
  brands,
  value,
  onChange,
  onCreateBrand,
  disabled,
  hasError,
}: {
  brands: BrandRow[];
  value: string | null;
  onChange: (brandId: string) => void;
  onCreateBrand: (name: string) => Promise<CreateBrandResult>;
  disabled?: boolean;
  hasError?: boolean;
}) {
  const options = useMemo(
    () => brands.map((b) => ({ value: b.id, label: b.name })),
    [brands]
  );

  return (
    <Combobox
      options={options}
      value={value}
      onChange={onChange}
      onCreate={async (name) => {
        const result = await onCreateBrand(name);
        return { success: result.success, value: result.data?.id };
      }}
      placeholder="Search or create a brand..."
      emptyText="No brands found."
      createLabel={(query) => `Create "${query}"`}
      disabled={disabled}
      hasError={hasError}
    />
  );
}
