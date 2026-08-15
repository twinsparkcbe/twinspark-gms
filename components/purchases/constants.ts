import type { PurchaseEntrySort } from "@/services/purchases";

export const PURCHASE_SORT_LABELS: Record<PurchaseEntrySort, string> = {
  newest: "Newest",
  name: "Item Name (A-Z)",
  amount: "Amount (High to Low)",
};

export const PURCHASE_SORT_OPTIONS: { value: PurchaseEntrySort; label: string }[] = (
  Object.entries(PURCHASE_SORT_LABELS) as [PurchaseEntrySort, string][]
).map(([value, label]) => ({ value, label }));
