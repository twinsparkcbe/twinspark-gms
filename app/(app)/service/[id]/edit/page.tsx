import { notFound, redirect } from "next/navigation";

import { canSetServicePaymentStatus } from "@/lib/auth/permissions";
import { requireServiceAccess } from "@/lib/auth/require-service-access";
import { createClient } from "@/lib/supabase/server";
import { listSellableCombos } from "@/services/combos";
import { listAllInventoryItemsForExport } from "@/services/inventory";
import { listAllCustomersForPicker } from "@/services/sales";
import {
  getPickerUsageCounts,
  getServiceJob,
  listAllVehiclesForPicker,
  listGeneralServicePackages,
  listSpecificServices,
  ServiceJobNotFoundError,
} from "@/services/service";
import { getRowActions } from "@/services/service/row-actions";
import { listActiveMechanics } from "@/services/users";

import { ServiceJobFormClient } from "@/components/service/service-job-form-client";

type Params = { id: string };

// Who may open this screen (doc/service-edit-undo-scope.md §2):
//   DRAFT / IN_PROGRESS / READY_FOR_DELIVERY — anyone with service access,
//     the ordinary edit. Saves through update_service_job().
//   COMPLETED — Administrators only, and it saves through
//     edit_completed_service_job() instead, which keeps the invoice number and
//     reconciles stock.
//   CANCELLED — nobody; there's nothing left to correct.
// getRowActions() is the single source of that rule, shared with the list row
// so a visible Edit icon can never lead to a redirect.
export default async function EditServiceJobPage({ params }: { params: Promise<Params> }) {
  const { role } = await requireServiceAccess();
  const { id } = await params;
  const supabase = await createClient();

  const job = await getServiceJob(supabase, id).catch((error) => {
    if (error instanceof ServiceJobNotFoundError) notFound();
    throw error;
  });

  const isAdmin = role === "admin";
  if (getRowActions(job, { isAdmin }).edit === null) {
    redirect(`/service/${id}`);
  }

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

  const usageCounts = await getPickerUsageCounts(supabase, { packages, specificServices });

  return (
    <ServiceJobFormClient
      existingJob={job}
      customers={customers}
      vehicles={vehicles}
      items={items}
      packages={packages}
      specificServices={specificServices}
      combos={combos}
      usageCounts={usageCounts}
      mechanics={mechanics}
      canRecordPayment={canSetServicePaymentStatus(role)}
    />
  );
}
