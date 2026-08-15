"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BrandRow, InventoryItemRow, ItemDetailsInput } from "@/services/inventory";
import type {
  NewItemWithPurchaseInput,
  PurchaseEntryEditInput,
  PurchaseEntryInput,
  PurchaseEntryRow,
  PurchaseEntrySort,
  PurchaseReturnInput,
  PurchaseStats,
} from "@/services/purchases";
import type { ItemType } from "@/types/database.types";

import {
  createBrandAction,
  createInventoryItemWithPurchaseAction,
  deleteOrDeactivateInventoryItemAction,
  fetchActiveItemsForPickerAction,
  fetchActiveTrackTyreItemAction,
  fetchCustomTypeLabelsAction,
  fetchInventoryItemByIdAction,
  fetchLatestPurchaseSupplierAction,
  fetchPurchaseEntriesAction,
  fetchPurchaseStatsAction,
  recordPurchaseEntryAction,
  recordPurchaseReturnAction,
  updateInventoryItemDetailsAction,
  updatePurchaseEntryAction,
} from "@/app/(app)/purchases/actions";

import { PURCHASE_SORT_OPTIONS } from "./constants";
import { DeleteItemDialog } from "./delete-item-dialog";
import { EditItemDetailsDialog } from "./edit-item-details-dialog";
import { EditPurchaseEntryDialog } from "./edit-purchase-entry-dialog";
import { PurchaseEntriesTable } from "./purchase-entries-table";
import { PurchaseFilters } from "./purchase-filters";
import { PurchaseReturnDialog } from "./purchase-return-dialog";
import { PurchaseStatsCards } from "./purchase-stats";
import { RecordPurchaseDialog } from "./record-purchase-dialog";

// itemTypes/brandIds are multi-select (match-ANY), empty means "no filter".
// dateFrom/dateTo are plain <input type="date"> strings (yyyy-mm-dd) or "".
export interface PurchaseFilterState {
  search: string;
  itemTypes: ItemType[];
  brandIds: string[];
  dateFrom: string;
  dateTo: string;
}

const DEFAULT_FILTERS: PurchaseFilterState = {
  search: "",
  itemTypes: [],
  brandIds: [],
  dateFrom: "",
  dateTo: "",
};

const PAGE_SIZE = 20;

export function PurchasePageClient({
  initialEntries,
  initialTotal,
  brands: initialBrands,
  initialStats,
  initialItems,
}: {
  initialEntries: PurchaseEntryRow[];
  initialTotal: number;
  brands: BrandRow[];
  initialStats: PurchaseStats;
  initialItems: InventoryItemRow[];
}) {
  const [filters, setFilters] = useState<PurchaseFilterState>(DEFAULT_FILTERS);
  const [sortBy, setSortBy] = useState<PurchaseEntrySort>("newest");
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState(initialEntries);
  const [total, setTotal] = useState(initialTotal);
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState(initialStats);
  const [items, setItems] = useState(initialItems);
  const [brands, setBrands] = useState(initialBrands);
  const [customTypeLabels, setCustomTypeLabels] = useState<string[]>([]);

  const [recordDialogOpen, setRecordDialogOpen] = useState(false);
  // entry.remainingQuantity is already live/authoritative on every row
  // (purchase_entries.remaining_quantity) — no separate fetch needed before
  // opening the dialog anymore (see doc/purchase-batch-fifo-scope.md §2).
  const [returnDialog, setReturnDialog] = useState<{ open: boolean; entry: PurchaseEntryRow | null }>({
    open: false,
    entry: null,
  });
  const [editDialog, setEditDialog] = useState<{ open: boolean; item: InventoryItemRow | null }>({
    open: false,
    item: null,
  });
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: InventoryItemRow | null }>({
    open: false,
    item: null,
  });
  const [editPurchaseDialog, setEditPurchaseDialog] = useState<{ open: boolean; entry: PurchaseEntryRow | null }>({
    open: false,
    entry: null,
  });

  /** Item id deep-linked from Inventory's reorder cards (?itemId=…). */
  const [preselectItemId, setPreselectItemId] = useState<string | null>(null);

  const isTextChangeRef = useRef(false);
  const hasMountedRef = useRef(false);

  const router = useRouter();
  const searchParams = useSearchParams();

  // Dashboard's "New Purchase Entry" quick action links here with
  // ?action=new (doc/dashboard-scope.md §3a) — Purchases has no dedicated
  // /purchases/new route, entries are created via this dialog on the list
  // page itself, so the shortcut opens the dialog directly instead. The
  // param is stripped right after so a refresh doesn't re-open it.
  useEffect(() => {
    if (searchParams.get("action") !== "new") return;
    // Inventory's reorder cards add &itemId=<id> so the dialog opens already
    // pointed at the item that's out of stock — read it before router.replace
    // strips the params below.
    setPreselectItemId(searchParams.get("itemId"));
    setRecordDialogOpen(true);
    router.replace("/purchases", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    const result = await fetchPurchaseEntriesAction({
      search: filters.search || undefined,
      itemTypes: filters.itemTypes.length ? filters.itemTypes : undefined,
      brandIds: filters.brandIds.length ? filters.brandIds : undefined,
      dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
      dateTo: filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999`) : undefined,
      sortBy,
      page,
      pageSize: PAGE_SIZE,
    });
    setIsLoading(false);

    if (result.success) {
      setEntries(result.data.entries);
      setTotal(result.data.total);
    } else {
      toast.error(result.error);
    }
  }, [filters, sortBy, page]);

  // Mirrors whatever the list is currently filtered to — no filters means
  // the usual "this month" default (getPurchaseStats' own fallback); any
  // active filter narrows the cards to match the filtered set exactly, so
  // they never disagree with what's showing in the table below them.
  const refreshStats = useCallback(async () => {
    const result = await fetchPurchaseStatsAction({
      search: filters.search || undefined,
      itemTypes: filters.itemTypes.length ? filters.itemTypes : undefined,
      brandIds: filters.brandIds.length ? filters.brandIds : undefined,
      from: filters.dateFrom || undefined,
      to: filters.dateTo ? `${filters.dateTo}T23:59:59.999` : undefined,
    });
    if (result.success) setStats(result.data);
  }, [filters]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    const delay = isTextChangeRef.current ? 300 : 0;
    const handle = setTimeout(() => {
      refetch();
      refreshStats();
    }, delay);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sortBy, page]);

  function handleFilterChange(next: Partial<PurchaseFilterState>) {
    isTextChangeRef.current = Object.prototype.hasOwnProperty.call(next, "search");
    setFilters((prev) => ({ ...prev, ...next }));
    setPage(1);
  }

  function handleResetFilters() {
    isTextChangeRef.current = false;
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  }

  function handlePageChange(nextPage: number) {
    isTextChangeRef.current = false;
    setPage(nextPage);
  }

  function handleSortChange(nextSort: PurchaseEntrySort) {
    isTextChangeRef.current = false;
    setSortBy(nextSort);
    setPage(1);
  }

  const hasActiveFilters =
    filters.search !== "" ||
    filters.itemTypes.length > 0 ||
    filters.brandIds.length > 0 ||
    filters.dateFrom !== "" ||
    filters.dateTo !== "";

  // Item stock/reference-price figures shown in the Record Purchase picker
  // go stale after a purchase — refresh alongside the table instead of on
  // every filter/page change.
  const refreshItems = useCallback(async () => {
    const result = await fetchActiveItemsForPickerAction();
    if (result.success) setItems(result.data);
  }, []);

  const refreshCustomTypeLabels = useCallback(async () => {
    const result = await fetchCustomTypeLabelsAction();
    if (result.success) setCustomTypeLabels(result.data);
  }, []);

  useEffect(() => {
    void refreshCustomTypeLabels();
  }, [refreshCustomTypeLabels]);

  async function handleRecordExisting(input: PurchaseEntryInput) {
    const result = await recordPurchaseEntryAction(input);
    if (result.success) {
      toast.success("Purchase recorded.");
      await Promise.all([refetch(), refreshStats(), refreshItems()]);
    } else {
      toast.error(result.error);
    }
    return result;
  }

  async function handleRecordNewItem(input: NewItemWithPurchaseInput) {
    const result = await createInventoryItemWithPurchaseAction(input);
    if (result.success) {
      toast.success("Item created and purchase recorded.");
      await Promise.all([refetch(), refreshStats(), refreshItems(), refreshCustomTypeLabels()]);
    } else {
      toast.error(result.error);
    }
    return result;
  }

  async function handleCreateBrand(name: string, itemType: ItemType) {
    const result = await createBrandAction(name, itemType);
    if (result.success) {
      setBrands((prev) => [...prev, result.data].sort((a, b) => a.name.localeCompare(b.name)));
    }
    return result;
  }

  function openReturnDialog(entry: PurchaseEntryRow) {
    setReturnDialog({ open: true, entry });
  }

  async function handleReturnSubmit(input: PurchaseReturnInput) {
    const result = await recordPurchaseReturnAction(input);
    if (result.success) {
      toast.success("Return recorded.");
      await Promise.all([refetch(), refreshStats(), refreshItems()]);
    } else {
      toast.error(result.error);
    }
    return result;
  }

  // Fetched fresh by id (not reused from `items`, which is active-only) so
  // Edit/Remove still works for a purchase entry whose item has since been
  // deactivated.
  async function openEditDialog(entry: PurchaseEntryRow) {
    const result = await fetchInventoryItemByIdAction(entry.inventoryItemId);
    if (result.success) {
      setEditDialog({ open: true, item: result.data });
    } else {
      toast.error(result.error);
    }
  }

  async function openDeleteDialog(entry: PurchaseEntryRow) {
    const result = await fetchInventoryItemByIdAction(entry.inventoryItemId);
    if (result.success) {
      setDeleteDialog({ open: true, item: result.data });
    } else {
      toast.error(result.error);
    }
  }

  async function handleEditSubmit(id: string, input: ItemDetailsInput) {
    const result = await updateInventoryItemDetailsAction(id, input);
    if (result.success) {
      toast.success("Item updated.");
      await Promise.all([refetch(), refreshItems(), refreshCustomTypeLabels()]);
    } else {
      toast.error(result.error);
    }
    return result;
  }

  function openEditPurchaseDialog(entry: PurchaseEntryRow) {
    setEditPurchaseDialog({ open: true, entry });
  }

  async function handleEditPurchaseSubmit(entryId: string, input: PurchaseEntryEditInput) {
    const result = await updatePurchaseEntryAction(entryId, input);
    if (result.success) {
      toast.success("Purchase updated.");
      await Promise.all([refetch(), refreshStats(), refreshItems()]);
    } else {
      toast.error(result.error);
    }
    return result;
  }

  async function handleDeleteConfirm() {
    if (!deleteDialog.item) return { success: false, error: "No item selected." };
    const result = await deleteOrDeactivateInventoryItemAction(deleteDialog.item.id);

    if (result.success) {
      toast.success(result.data.action === "deleted" ? "Item deleted." : "Item deactivated.");
      await Promise.all([refetch(), refreshItems(), refreshCustomTypeLabels()]);
    } else {
      toast.error(result.error);
    }
    return result;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">Purchases</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Record stock bought from suppliers and track purchase history.
          </p>
        </div>
        <div className="flex gap-2">
          <Button className="rounded-[10px] bg-danger hover:bg-danger/90" onClick={() => setRecordDialogOpen(true)}>
            <ShoppingCart className="size-4" />
            Record Purchase
          </Button>
        </div>
      </div>

      <PurchaseStatsCards stats={stats} isFiltered={hasActiveFilters} />

      <PurchaseFilters filters={filters} brands={brands} onChange={handleFilterChange} onReset={handleResetFilters} />

      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-neutral-900">
          Purchase History <span className="font-normal text-neutral-400">({total.toLocaleString("en-IN")})</span>
        </p>
        <Select value={sortBy} onValueChange={(value) => handleSortChange(value as PurchaseEntrySort)}>
          <SelectTrigger size="sm" className="w-[190px] rounded-[10px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PURCHASE_SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                Sort by: {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <PurchaseEntriesTable
        entries={entries}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        isLoading={isLoading}
        hasActiveFilters={hasActiveFilters}
        onPageChange={handlePageChange}
        onReturn={openReturnDialog}
        onEditItem={openEditDialog}
        onEditPurchase={openEditPurchaseDialog}
        onRemoveItem={openDeleteDialog}
        onRecordPurchase={() => setRecordDialogOpen(true)}
      />

      <RecordPurchaseDialog
        open={recordDialogOpen}
        onOpenChange={(open) => {
          setRecordDialogOpen(open);
          // Clear the deep-linked item on close, so opening the dialog again
          // from the page's own button starts blank rather than silently
          // reusing whatever Inventory sent over.
          if (!open) setPreselectItemId(null);
        }}
        items={items}
        brands={brands}
        customTypeLabels={customTypeLabels}
        preselectItemId={preselectItemId}
        onCreateBrand={handleCreateBrand}
        onFetchActiveTrackTyreItem={async (productName: string) => {
          const result = await fetchActiveTrackTyreItemAction(productName);
          return result.success ? result.data : null;
        }}
        onFetchLatestSupplier={async (inventoryItemId: string) => {
          const result = await fetchLatestPurchaseSupplierAction(inventoryItemId);
          return result.success ? result.data : null;
        }}
        onSubmitExisting={handleRecordExisting}
        onSubmitNewItem={handleRecordNewItem}
      />

      <PurchaseReturnDialog
        open={returnDialog.open}
        onOpenChange={(open) => setReturnDialog((prev) => ({ ...prev, open }))}
        entry={returnDialog.entry}
        onSubmit={handleReturnSubmit}
      />

      <EditItemDetailsDialog
        open={editDialog.open}
        onOpenChange={(open) => setEditDialog((prev) => ({ ...prev, open }))}
        item={editDialog.item}
        brands={brands}
        customTypeLabels={customTypeLabels}
        onCreateBrand={handleCreateBrand}
        onSubmit={handleEditSubmit}
      />

      <DeleteItemDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog((prev) => ({ ...prev, open }))}
        item={deleteDialog.item}
        onConfirm={handleDeleteConfirm}
      />

      <EditPurchaseEntryDialog
        open={editPurchaseDialog.open}
        onOpenChange={(open) => setEditPurchaseDialog((prev) => ({ ...prev, open }))}
        entry={editPurchaseDialog.entry}
        onSubmit={handleEditPurchaseSubmit}
      />
    </div>
  );
}
