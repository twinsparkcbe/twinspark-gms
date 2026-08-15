import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cache } from "react";

import { requireCustomersAccess } from "@/lib/auth/require-customers-access";
import { getCustomerVehicleVisibility } from "@/lib/auth/customer-vehicle-visibility";
import { createClient } from "@/lib/supabase/server";
import { CustomerNotFoundError, getCustomerById, listSalesForCustomer } from "@/services/sales";
import { listServiceJobsForCustomer, listVehiclesForCustomer } from "@/services/service";

import { CustomerDetailClient } from "@/components/customers/customer-detail-client";

type Params = { id: string };

const getCachedCustomer = cache((id: string) => createClient().then((supabase) => getCustomerById(supabase, id)));

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const customer = await getCachedCustomer(id);
    return { title: customer.name };
  } catch {
    return { title: "Customer" };
  }
}

export default async function CustomerDetailPage({ params }: { params: Promise<Params> }) {
  const { role } = await requireCustomersAccess();
  const visibility = getCustomerVehicleVisibility(role);
  const { id } = await params;
  const supabase = await createClient();

  const customer = await getCachedCustomer(id).catch((error) => {
    if (error instanceof CustomerNotFoundError) notFound();
    throw error;
  });

  const [sales, vehicles, serviceJobs] = await Promise.all([
    listSalesForCustomer(supabase, id),
    visibility.vehiclesSection ? listVehiclesForCustomer(supabase, id) : Promise.resolve([]),
    visibility.serviceHistory ? listServiceJobsForCustomer(supabase, id) : Promise.resolve([]),
  ]);

  return (
    <CustomerDetailClient customer={customer} sales={sales} vehicles={vehicles} serviceJobs={serviceJobs} visibility={visibility} />
  );
}
