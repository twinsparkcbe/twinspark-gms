import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cache } from "react";

import { requireServiceAccess } from "@/lib/auth/require-service-access";
import { createClient } from "@/lib/supabase/server";
import { VehicleNotFoundError, getVehicleWithOwner, listServiceJobsForVehicle } from "@/services/service";

import { VehicleDetailClient } from "@/components/customers/vehicle-detail-client";

type Params = { id: string };

const getCachedVehicle = cache((id: string) => createClient().then((supabase) => getVehicleWithOwner(supabase, id)));

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const vehicle = await getCachedVehicle(id);
    return { title: vehicle.vehicleNumber };
  } catch {
    return { title: "Vehicle" };
  }
}

// Guarded with requireServiceAccess(), not requireCustomersAccess(): Vehicle
// Management is tied to Service, which Sales Person cannot access at all
// (spec §6, doc/customer-vehicle-scope.md §3). Mechanic can — they are
// exactly the staff who need a bike's history (doc/mechanic-role-scope.md §2).
export default async function VehicleDetailPage({ params }: { params: Promise<Params> }) {
  await requireServiceAccess();
  const { id } = await params;
  const supabase = await createClient();

  const vehicle = await getCachedVehicle(id).catch((error) => {
    if (error instanceof VehicleNotFoundError) notFound();
    throw error;
  });

  const serviceJobs = await listServiceJobsForVehicle(supabase, id);

  return <VehicleDetailClient vehicle={vehicle} serviceJobs={serviceJobs} />;
}
