import { requireServiceAccess } from "@/lib/auth/require-service-access";
import { toISTDateInput } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { listSellableCombos } from "@/services/combos";
import { listAllInventoryItemsForExport } from "@/services/inventory";
import { listAllCustomersForPicker } from "@/services/sales";
import { getPickerUsageCounts, listAllVehiclesForPicker, listGeneralServicePackages, listSpecificServices } from "@/services/service";
import { listActiveMechanics } from "@/services/users";

import { ServiceJobFormClient } from "@/components/service/service-job-form-client";

// Administrator + Mechanic (doc/mechanic-role-scope.md §4) — Sales Person
// still has zero Service access.
export default async function NewServiceJobPage() {
  const { userId, role } = await requireServiceAccess();
  const supabase = await createClient();

  const [customers, vehicles, items, packages, specificServices, mechanics] = await Promise.all([
    listAllCustomersForPicker(supabase),
    listAllVehiclesForPicker(supabase),
    listAllInventoryItemsForExport(supabase, {}),
    listGeneralServicePackages(supabase, true),
    listSpecificServices(supabase, true),
    listActiveMechanics(supabase),
  ]);

  // Active *and* inside its offer window. Filtered here rather than in the
  // picker so the client render never depends on the clock.
  const combos = await listSellableCombos(supabase);

  // Depends on the catalogs above, so it can't join the parallel batch.
  const usageCounts = await getPickerUsageCounts(supabase, { packages, specificServices });

  return (
    <ServiceJobFormClient
      customers={customers}
      vehicles={vehicles}
      items={items}
      packages={packages}
      specificServices={specificServices}
      combos={combos}
      usageCounts={usageCounts}
      mechanics={mechanics}
      defaultAssignedMechanicId={role === "mechanic" ? userId : undefined}
      defaultExpectedDeliveryDate={toISTDateInput(new Date().toISOString())}
    />
  );
}
