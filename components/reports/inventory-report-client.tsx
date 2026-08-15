"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Boxes, IndianRupee, PackageX, Search } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ITEM_TYPE_BADGE_CLASS, ITEM_TYPE_OPTIONS, STOCK_STATUS_LABELS, getItemTypeBadgeText } from "@/components/inventory/constants";
import type { InventoryItemRow, InventoryStats } from "@/services/inventory";
import type { ItemType } from "@/types/database.types";
import { downloadXlsx, todayForFilename, type XlsxColumn } from "@/lib/xlsx-export";

import { fetchInventoryReportAction, type InventoryReportFilters } from "@/app/(app)/reports/actions";

import { BackToReports } from "./back-to-reports";
import { DownloadXlsxButton } from "./download-xlsx-button";

const STAT_CARD_CLASS = "rounded-xl border border-neutral-200 bg-white p-5 shadow-sm";

function StatCard({ icon: Icon, iconClassName, label, value }: { icon: React.ComponentType<{ className?: string }>; iconClassName: string; label: string; value: string }) {
  return (
    <div className={STAT_CARD_CLASS}>
      <div className="flex items-center gap-2">
        <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", iconClassName)}>
          <Icon className="size-4" />
        </div>
        <p className="text-sm font-medium text-neutral-500">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight text-neutral-900">{value}</p>
    </div>
  );
}

const ROW_GRID_CLASS = "grid grid-cols-[minmax(180px,1fr)_140px_120px_110px_120px_110px] gap-3";

export function InventoryReportClient({
  initialItems,
  initialTotal,
  stats,
  ageingItemIds,
}: {
  initialItems: InventoryItemRow[];
  initialTotal: number;
  stats: InventoryStats;
  ageingItemIds: string[];
}) {
  const [search, setSearch] = useState("");
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [stockStatus, setStockStatus] = useState<InventoryItemRow["stockStatus"] | "all">("all");
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [isLoading, setIsLoading] = useState(false);

  const hasMountedRef = useRef(false);
  const ageingSet = new Set(ageingItemIds);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    const filters: InventoryReportFilters = {
      search: search || undefined,
      itemTypes: itemTypes.length ? itemTypes : undefined,
      stockStatus: stockStatus === "all" ? undefined : stockStatus,
    };
    const result = await fetchInventoryReportAction(filters);
    setIsLoading(false);

    if (result.success) {
      setItems(result.data.items);
      setTotal(result.data.total);
    } else {
      toast.error(result.error);
    }
  }, [search, itemTypes, stockStatus]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    const handle = setTimeout(refetch, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, itemTypes, stockStatus]);

  const hasActiveFilters = search !== "" || itemTypes.length > 0 || stockStatus !== "all";

  const INVENTORY_COLUMNS: XlsxColumn<InventoryItemRow>[] = [
    { header: "Item", accessor: (item) => item.productName },
    { header: "SKU", accessor: (item) => item.skuCode },
    { header: "Type", accessor: (item) => getItemTypeBadgeText(item) },
    { header: "Brand", accessor: (item) => item.brandName },
    { header: "Stock", accessor: (item) => item.availableQuantity },
    { header: "Stock Status", accessor: (item) => STOCK_STATUS_LABELS[item.stockStatus] },
    { header: "Value (Cost)", accessor: (item) => item.purchasePrice * item.availableQuantity },
    { header: "Ageing", accessor: (item) => (ageingSet.has(item.id) ? "Yes" : "No") },
  ];

  function handleDownload() {
    downloadXlsx(`twinspark-inventory-report-${todayForFilename()}`, "Inventory", INVENTORY_COLUMNS, items);
  }

  return (
    <div className="space-y-6">
      <BackToReports />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">Inventory Report</h1>
          <p className="mt-1 text-sm text-neutral-500">Current stock, low/out-of-stock flags, and ageing items.</p>
        </div>
        <DownloadXlsxButton onClick={handleDownload} disabled={items.length === 0} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Boxes} iconClassName="bg-indigo-50 text-indigo-600" label="Total Products" value={stats.totalProducts.toLocaleString("en-IN")} />
        <StatCard icon={AlertTriangle} iconClassName="bg-warning/10 text-warning" label="Low Stock" value={stats.lowStock.toLocaleString("en-IN")} />
        <StatCard icon={PackageX} iconClassName="bg-danger-bg text-danger" label="Out of Stock" value={stats.outOfStock.toLocaleString("en-IN")} />
        <StatCard icon={IndianRupee} iconClassName="bg-success-bg text-success" label="Inventory Value (Cost)" value={formatINR(stats.inventoryValueCost)} />
      </div>

      <div className="flex flex-col gap-2 rounded-[14px] border border-neutral-200 bg-white p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 flex-1 sm:min-w-[220px]">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-400" />
          <Input placeholder="Search by name or SKU..." className="h-9 rounded-[10px] pl-9 text-sm" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <MultiSelect
          options={ITEM_TYPE_OPTIONS}
          values={itemTypes}
          onChange={(v) => setItemTypes(v as ItemType[])}
          placeholder="All types"
          className="w-full sm:w-[180px]"
        />
        <Select value={stockStatus} onValueChange={(v) => setStockStatus(v as typeof stockStatus)}>
          <SelectTrigger size="sm" className="w-full rounded-[10px] sm:w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stock statuses</SelectItem>
            {Object.entries(STOCK_STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto">
        <div role="table" aria-label="Inventory Report" aria-busy={isLoading} className="min-w-[900px]">
          <div role="row" className={cn(ROW_GRID_CLASS, "px-4 py-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase")}>
            <span>Item</span>
            <span>Type</span>
            <span>Brand</span>
            <span>Stock</span>
            <span>Value (Cost)</span>
            <span className="text-right">Flags</span>
          </div>

          <div className={cn("flex flex-col gap-2", isLoading && "opacity-60 transition-opacity")}>
            {items.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <Boxes className="size-10 text-neutral-300" />
                <p className="text-sm text-neutral-500">{hasActiveFilters ? "No items match the current filters." : "No inventory items yet."}</p>
              </div>
            )}

            {items.map((item) => {
              const isAgeing = ageingSet.has(item.id);
              return (
                <div key={item.id} role="row" className={cn(ROW_GRID_CLASS, "items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm")}>
                  <div role="cell" aria-label="Item" className="min-w-0">
                    <div className="truncate font-semibold text-neutral-900">{item.productName}</div>
                    <div className="truncate font-mono text-[11px] text-neutral-500">{item.skuCode}</div>
                  </div>
                  <div role="cell" aria-label="Type" className="min-w-0">
                    <Badge className={cn("border-none", ITEM_TYPE_BADGE_CLASS[item.itemType])}>{getItemTypeBadgeText(item)}</Badge>
                  </div>
                  <div role="cell" aria-label="Brand" className="min-w-0 truncate text-sm text-neutral-700">
                    {item.brandName ?? "—"}
                  </div>
                  <div role="cell" aria-label="Stock" className="min-w-0">
                    <span className="text-sm font-semibold text-neutral-900">{item.availableQuantity.toLocaleString("en-IN")}</span>
                    {item.stockStatus !== "in_stock" && (
                      <Badge variant={item.stockStatus === "out_of_stock" ? "danger" : "warning"} className="ml-1.5">
                        {STOCK_STATUS_LABELS[item.stockStatus]}
                      </Badge>
                    )}
                  </div>
                  <div role="cell" aria-label="Value" className="min-w-0 text-sm text-neutral-700">
                    {formatINR(item.purchasePrice * item.availableQuantity)}
                  </div>
                  <div role="cell" aria-label="Flags" className="flex justify-end">
                    {isAgeing && (
                      <Badge variant="warning" title="Oldest unsold batch is 6+ months old">
                        Ageing
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {total > items.length && <p className="text-center text-xs text-neutral-400">Showing the first {items.length.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")} items.</p>}
    </div>
  );
}
