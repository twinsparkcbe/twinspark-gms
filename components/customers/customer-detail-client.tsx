"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bike, Eye, Receipt, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatDate, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CustomerRow, SaleRow } from "@/services/sales";
import type { ServiceJobRow, VehicleRow } from "@/services/service";
import type { CustomerVehicleVisibility } from "@/lib/auth/customer-vehicle-visibility";

import { EmptyRow, HISTORY_PAGE_SIZE, SectionHeading, SectionSearch, ShowMoreButton, TableHeaderRow } from "./detail-section";
import { ServiceHistorySection } from "./service-history-section";

// Vehicle Number | Model | Latest Odometer | Actions
const VEHICLES_GRID_CLASS = "grid grid-cols-[160px_minmax(160px,1fr)_150px_70px]";
// Date | Invoice # | Items | Amount | Actions
const SALES_GRID_CLASS = "grid grid-cols-[110px_140px_minmax(200px,1fr)_120px_70px]";

function saleItemsSummary(sale: SaleRow): string {
  const productLines = sale.lineItems.filter((l) => l.lineType === "PRODUCT");
  if (productLines.length === 0) return "—";
  const first = productLines[0];
  const extra = productLines.length - 1;
  const firstLabel = `${first.itemName ?? "Item"}${first.quantity ? ` x${first.quantity}` : ""}`;
  return extra > 0 ? `${firstLabel} +${extra} more` : firstLabel;
}

function matchesSaleSearch(sale: SaleRow, term: string): boolean {
  const haystack = [
    sale.invoiceNumber,
    saleItemsSummary(sale),
    sale.lineItems.map((l) => l.itemName ?? "").join(" "),
    formatDate(sale.saleDate),
    String(sale.grandTotal),
    formatINR(sale.grandTotal),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(term);
}

function VehiclesSection({ vehicles }: { vehicles: VehicleRow[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return vehicles;
    return vehicles.filter(
      (v) =>
        v.vehicleNumber.toLowerCase().includes(term) ||
        v.vehicleModel.toLowerCase().includes(term) ||
        (v.latestOdometerReading?.toString() ?? "").includes(term)
    );
  }, [vehicles, search]);

  return (
    <div className="space-y-3">
      <SectionHeading title="Vehicles" icon={Bike} count={vehicles.length} />

      {vehicles.length === 0 ? (
        <EmptyRow icon={Bike} text="No vehicles registered yet — vehicles are added the first time this customer books a Service Job." />
      ) : (
        <>
          <SectionSearch placeholder="Search by vehicle number or model..." value={search} onChange={setSearch} />

          <div className="overflow-x-auto">
            <div role="table" aria-label="Vehicles" className="min-w-[700px]">
              <TableHeaderRow gridClass={VEHICLES_GRID_CLASS} columns={["Vehicle Number", "Model", "Latest Odometer", "Actions"]} />

              <div className="flex flex-col gap-2">
                {filtered.length === 0 && <EmptyRow icon={Bike} text="No vehicles match the current search." />}

                {filtered.map((vehicle) => (
                  <div
                    key={vehicle.id}
                    role="row"
                    className={cn(VEHICLES_GRID_CLASS, "items-center gap-3 rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-neutral-50")}
                  >
                    <div role="cell" aria-label="Vehicle number" className="min-w-0">
                      <Link href={`/customers/vehicles/${vehicle.id}`} className="truncate font-mono text-sm font-semibold text-primary hover:underline">
                        {vehicle.vehicleNumber}
                      </Link>
                    </div>
                    <div role="cell" aria-label="Model" className="min-w-0 truncate text-sm text-neutral-700">
                      {vehicle.vehicleModel}
                    </div>
                    <div role="cell" aria-label="Latest odometer" className="min-w-0 text-sm text-neutral-700">
                      {vehicle.latestOdometerReading !== null ? `${vehicle.latestOdometerReading.toLocaleString("en-IN")} km` : "—"}
                    </div>
                    <div role="cell" aria-label="Actions" className="flex justify-end gap-1">
                      <Button asChild variant="ghost" size="icon" aria-label="View vehicle" title="View" className="size-9 rounded-[10px] text-neutral-500 hover:text-neutral-900">
                        <Link href={`/customers/vehicles/${vehicle.id}`}>
                          <Eye className="size-4" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SalesHistorySection({ sales }: { sales: SaleRow[] }) {
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return sales;
    return sales.filter((sale) => matchesSaleSearch(sale, term));
  }, [sales, search]);

  const visible = filtered.slice(0, visibleCount);
  const hasActiveSearch = search.trim() !== "";

  function handleSearchChange(value: string) {
    setSearch(value);
    setVisibleCount(HISTORY_PAGE_SIZE);
  }

  return (
    <div className="space-y-3">
      <SectionHeading title="Sales History" icon={Receipt} count={sales.length} />

      {sales.length === 0 ? (
        <EmptyRow icon={Receipt} text="No sales recorded for this customer yet." />
      ) : (
        <>
          <SectionSearch placeholder="Search by invoice #, item name, date, or amount..." value={search} onChange={handleSearchChange} />

          <div className="overflow-x-auto">
            <div role="table" aria-label="Sales History" className="min-w-[800px]">
              <TableHeaderRow gridClass={SALES_GRID_CLASS} columns={["Date", "Invoice #", "Items", "Amount", "Actions"]} />

              <div className="flex flex-col gap-2">
                {visible.length === 0 && <EmptyRow icon={Receipt} text="No sales match the current search." />}

                {visible.map((sale) => (
                  <div
                    key={sale.id}
                    role="row"
                    className={cn(SALES_GRID_CLASS, "items-center gap-3 rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-neutral-50")}
                  >
                    <div role="cell" aria-label="Date" className="min-w-0 text-sm text-neutral-700">
                      {formatDate(sale.saleDate)}
                    </div>
                    <div role="cell" aria-label="Invoice number" className="min-w-0 truncate font-mono text-sm text-neutral-700">
                      {sale.invoiceNumber}
                    </div>
                    <div role="cell" aria-label="Items" className="min-w-0 truncate text-sm text-neutral-700">
                      {saleItemsSummary(sale)}
                    </div>
                    <div role="cell" aria-label="Amount" className="min-w-0 text-sm font-semibold text-neutral-900">
                      {formatINR(sale.grandTotal)}
                    </div>
                    <div role="cell" aria-label="Actions" className="flex justify-end gap-1">
                      <Button asChild variant="ghost" size="icon" aria-label="View invoice" title="View invoice" className="size-9 rounded-[10px] text-neutral-500 hover:text-neutral-900">
                        <Link href={`/sales/${sale.id}/invoice`}>
                          <Receipt className="size-4" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {visibleCount < filtered.length && <ShowMoreButton remaining={filtered.length - visibleCount} onClick={() => setVisibleCount((c) => c + HISTORY_PAGE_SIZE)} />}
          {hasActiveSearch && (
            <p className="text-xs text-neutral-400">
              {filtered.length} of {sales.length} shown
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function CustomerDetailClient({
  customer,
  sales,
  vehicles,
  serviceJobs,
  visibility,
}: {
  customer: CustomerRow;
  sales: SaleRow[];
  vehicles: VehicleRow[];
  serviceJobs: ServiceJobRow[];
  visibility: CustomerVehicleVisibility;
}) {
  return (
    <div className="space-y-6">
      <Button asChild variant="secondary" size="sm" className="rounded-[10px]">
        <Link href="/customers">
          <ArrowLeft className="size-4" />
          Back to Customers
        </Link>
      </Button>

      <div className="flex items-start gap-2.5">
        <User className="mt-1 size-6 shrink-0 text-primary" />
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">{customer.name}</h1>
          <p className="mt-1 text-sm text-neutral-500">Customer since {formatDate(customer.createdAt)}</p>
        </div>
      </div>

      <div className="grid gap-4 rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Mobile Number</p>
          <p className="mt-1 font-mono text-sm text-neutral-900">{customer.mobileNumber}</p>
        </div>
        <div>
          <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Address</p>
          <p className="mt-1 text-sm text-neutral-900">{customer.address ?? "—"}</p>
        </div>
      </div>

      {visibility.vehiclesSection && <VehiclesSection vehicles={vehicles} />}

      <SalesHistorySection sales={sales} />

      {visibility.serviceHistory && <ServiceHistorySection serviceJobs={serviceJobs} />}
    </div>
  );
}
