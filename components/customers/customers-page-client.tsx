"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGlobalLoader } from "@/components/shared/global-loader";
import type { CustomerRow } from "@/services/sales";
import type { VehicleWithOwnerRow } from "@/services/service";
import type { CustomerVehicleVisibility } from "@/lib/auth/customer-vehicle-visibility";

import { fetchCustomersAction } from "@/app/(app)/customers/actions";

import { CustomersTable } from "./customers-table";
import { VehiclesTab } from "./vehicles-tab";

const PAGE_SIZE = 20;

export function CustomersPageClient({
  initialCustomers,
  initialTotal,
  initialVehicles,
  visibility,
}: {
  initialCustomers: CustomerRow[];
  initialTotal: number;
  /** Empty when the viewer can't see the Vehicles tab (doc/customer-vehicle-scope.md §3) — never fetched server-side in that case. */
  initialVehicles: VehicleWithOwnerRow[];
  visibility: CustomerVehicleVisibility;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [customers, setCustomers] = useState(initialCustomers);
  const [total, setTotal] = useState(initialTotal);
  const [isLoading, setIsLoading] = useState(false);

  const hasMountedRef = useRef(false);
  const { runWithLoader } = useGlobalLoader();

  const refetch = useCallback(async () => {
    setIsLoading(true);
    const result = await runWithLoader(() =>
      fetchCustomersAction({ search: search || undefined, page, pageSize: PAGE_SIZE })
    );
    setIsLoading(false);

    if (result.success) {
      setCustomers(result.data.customers);
      setTotal(result.data.total);
    } else {
      toast.error(result.error);
    }
  }, [search, page, runWithLoader]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    const handle = setTimeout(refetch, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, page]);

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1);
  }

  const hasActiveFilters = search !== "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">Customers & Vehicles</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Look up a customer or a vehicle by plate number — contact details, every vehicle, and full sales
          {visibility.serviceHistory ? " and service" : ""} history, all in one place.
        </p>
      </div>

      <Tabs defaultValue="customers">
        <TabsList>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          {visibility.vehiclesTab && <TabsTrigger value="vehicles">Vehicles</TabsTrigger>}
        </TabsList>

        <TabsContent value="customers" className="space-y-4 pt-2">
          <div className="relative min-w-0 sm:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-400" />
            <Input
              placeholder="Search by name or mobile number..."
              className="h-9 rounded-[10px] pl-9 text-sm"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>

          <CustomersTable
            customers={customers}
            total={total}
            page={page}
            pageSize={PAGE_SIZE}
            isLoading={isLoading}
            hasActiveFilters={hasActiveFilters}
            onPageChange={setPage}
          />
        </TabsContent>

        {visibility.vehiclesTab && (
          <TabsContent value="vehicles" className="pt-2">
            <VehiclesTab vehicles={initialVehicles} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
