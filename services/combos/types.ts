/**
 * Combo row shapes, shared by the data layer and the pure modules.
 *
 * Kept in their own file with no `server-only` marker so client components
 * and pure logic can import them without dragging the Supabase data layer
 * into the browser bundle.
 */

import type { ComboComponentPricing, ComboComponentType } from "./schemas";

export interface ComboComponentRow {
  id: string;
  position: number;
  componentType: ComboComponentType;
  generalServicePackageId: string | null;
  specificServiceId: string | null;
  inventoryItemId: string | null;
  quantity: number;
  pricing: ComboComponentPricing;
  /** Resolved at read time for display: package/service/item name. Falls
   * back to "Deleted item" when the referenced row has gone. */
  name: string;
  /** Current catalog price of one unit. `null` for a specific service with
   * no suggested charge. */
  unitPrice: number | null;
  /** Items only — cost basis for the builder's margin readout. Never
   * reaches a customer-facing document. */
  unitPurchasePrice: number | null;
  /** Items only — advisory stock display in the builder. */
  availableQuantity: number | null;
}

export interface ComboRow {
  id: string;
  name: string;
  description: string | null;
  comboPrice: number;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
  createdAt: string;
  components: ComboComponentRow[];
}
