"use client";

import Link from "next/link";
import { ArrowLeft, Bike } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ServiceJobRow, VehicleWithOwnerRow } from "@/services/service";

import { ServiceHistorySection } from "./service-history-section";

export function VehicleDetailClient({
  vehicle,
  serviceJobs,
}: {
  vehicle: VehicleWithOwnerRow;
  serviceJobs: ServiceJobRow[];
}) {
  return (
    <div className="space-y-6">
      <Button asChild variant="secondary" size="sm" className="rounded-[10px]">
        <Link href="/customers">
          <ArrowLeft className="size-4" />
          Back to Customers & Vehicles
        </Link>
      </Button>

      <div className="flex items-start gap-2.5">
        <Bike className="mt-1 size-6 shrink-0 text-primary" />
        <div>
          <h1 className="font-mono text-3xl font-extrabold tracking-tight text-neutral-900">{vehicle.vehicleNumber}</h1>
          <p className="mt-1 text-sm text-neutral-500">{vehicle.vehicleModel}</p>
        </div>
      </div>

      <div className="grid gap-4 rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Latest Odometer</p>
          <p className="mt-1 text-sm text-neutral-900">
            {vehicle.latestOdometerReading !== null ? `${vehicle.latestOdometerReading.toLocaleString("en-IN")} km` : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Owner</p>
          <Link href={`/customers/${vehicle.customerId}`} className="mt-1 block text-sm font-semibold text-primary hover:underline">
            {vehicle.customerName}
          </Link>
          <p className="font-mono text-sm text-neutral-500">{vehicle.customerMobile}</p>
        </div>
      </div>

      <ServiceHistorySection serviceJobs={serviceJobs} showVehicle={false} />
    </div>
  );
}
