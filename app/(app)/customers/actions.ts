"use server";

import { requireCustomersAccess } from "@/lib/auth/require-customers-access";
import { createClient } from "@/lib/supabase/server";
import { listCustomers, type CustomerFilters, type CustomerRow } from "@/services/sales";

type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

function toErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Every action re-checks access server-side — never trust the client.
 * Customer Management is available to both Administrator and Sales Person
 * (doc/customer-vehicle-scope.md §3). */
async function customersClient() {
  await requireCustomersAccess();
  return createClient();
}

// Powers the Customers tab's search + pagination (doc/customer-vehicle-
// scope.md §2a). The Vehicles tab deliberately has no equivalent action —
// it fetches everything once at page load and filters client-side, same
// picker pattern as Sales/Service (see listVehiclesWithOwner's own comment).
export async function fetchCustomersAction(
  filters: CustomerFilters
): Promise<ActionResult<{ customers: CustomerRow[]; total: number }>> {
  try {
    const supabase = await customersClient();
    const data = await listCustomers(supabase, filters);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load customers.") };
  }
}
