import { requireCustomersAccess } from "@/lib/auth/require-customers-access";
import { getCustomerVehicleVisibility } from "@/lib/auth/customer-vehicle-visibility";
import { createClient } from "@/lib/supabase/server";
import { listCustomers } from "@/services/sales";
import { listVehiclesWithOwner } from "@/services/service";

import { CustomersPageClient } from "@/components/customers/customers-page-client";

// Both Administrator and Sales Person can access this page (doc/customer-
// vehicle-scope.md §3) — Customer Management is unblocked for Sales Person
// today (lib/auth/permissions.ts), unlike Inventory/Purchases/Reports. Which
// *sections* render is a separate, finer-grained rule (see
// getCustomerVehicleVisibility) — the Vehicles tab and its data are never
// even fetched for a Sales Person, not just hidden client-side.
export default async function CustomersPage() {
  const { role } = await requireCustomersAccess();
  const visibility = getCustomerVehicleVisibility(role);
  const supabase = await createClient();

  const [{ customers, total }, vehicles] = await Promise.all([
    listCustomers(supabase, { page: 1, pageSize: 20 }),
    visibility.vehiclesTab ? listVehiclesWithOwner(supabase) : Promise.resolve([]),
  ]);

  return (
    <CustomersPageClient
      initialCustomers={customers}
      initialTotal={total}
      initialVehicles={vehicles}
      visibility={visibility}
    />
  );
}
