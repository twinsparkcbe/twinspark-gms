"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ItemPickerCombobox } from "@/components/purchases/item-picker-combobox";
import type { InventoryItemRow } from "@/services/inventory";

export interface CatalogItemDraft {
  id: string;
  inventoryItemId: string | null;
  defaultQuantity: string;
}

/**
 * Default Inventory Items editor for a catalog entry (General Service
 * Package or Specific Service — doc §3, Revision 3). These items
 * auto-populate Parts Used whenever this package/service is picked on a
 * Service Job, so staff aren't re-adding the same oil/filter every time a
 * "Standard Service" is booked. Deliberately reuses ItemPickerCombobox
 * (same picker Purchases/Sales/Service Parts Used already use) rather than
 * a new component.
 */
export function CatalogItemPicker({
  items,
  rows,
  disabled,
  onAdd,
  onUpdate,
  onRemove,
}: {
  items: InventoryItemRow[];
  rows: CatalogItemDraft[];
  disabled?: boolean;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<CatalogItemDraft>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Default Items (optional)</Label>
        <Button type="button" variant="secondary" size="sm" className="rounded-[10px]" disabled={disabled} onClick={onAdd}>
          <Plus className="size-4" />
          Add Item
        </Button>
      </div>
      <p className="text-xs text-neutral-500">Auto-added to Parts Used whenever this is picked on a Service Job — staff can still edit or remove them per job.</p>

      {rows.length > 0 && (
        <div className="space-y-2 rounded-[10px] border border-neutral-200 p-2">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <ItemPickerCombobox items={items} value={row.inventoryItemId} onChange={(itemId) => onUpdate(row.id, { inventoryItemId: itemId })} disabled={disabled} />
              </div>
              <Input
                type="number"
                min={1}
                step="1"
                inputMode="numeric"
                value={row.defaultQuantity}
                disabled={disabled}
                onChange={(e) => onUpdate(row.id, { defaultQuantity: e.target.value })}
                className="h-9 w-20 text-center"
                aria-label="Default quantity"
              />
              <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Remove item" disabled={disabled} onClick={() => onRemove(row.id)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
