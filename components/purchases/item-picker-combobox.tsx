"use client";

import { useMemo } from "react";

import { Combobox } from "@/components/ui/combobox";
import type { InventoryItemRow } from "@/services/inventory";

/**
 * Searchable picker over Inventory's existing active items (name/SKU) — no
 * "create" affordance, unlike BrandCombobox: Purchase never creates catalog
 * items, it only records a transaction against one that already exists
 * (scope doc §2).
 */
export function ItemPickerCombobox({
  items,
  value,
  onChange,
  disabled,
  hasError,
}: {
  items: InventoryItemRow[];
  value: string | null;
  onChange: (itemId: string) => void;
  disabled?: boolean;
  hasError?: boolean;
}) {
  const options = useMemo(
    () => items.map((item) => ({ value: item.id, label: `${item.productName} · ${item.skuCode}` })),
    [items]
  );

  return (
    <Combobox
      options={options}
      value={value}
      onChange={onChange}
      placeholder="Search item by name or SKU..."
      emptyText="No active items match."
      disabled={disabled}
      hasError={hasError}
    />
  );
}
