import { requireServiceAccess } from "@/lib/auth/require-service-access";
import { createClient } from "@/lib/supabase/server";
import { listAllCustomersForPicker } from "@/services/sales";
import { listAllVehiclesForPicker } from "@/services/service";

import { ServiceIntakeFormClient } from "@/components/service/service-intake-form-client";

// Quick Intake (doc §21) — Administrator + Mechanic, same as the rest of the
// Service Job lifecycle.
//
// UNREACHABLE FROM THE UI as of 2026-08-14. The Service list's "Accept
// Vehicle" button was its only entry point and was removed at the client's
// request; "New Service" (/service/new) now covers both intake styles.
//
// Kept deliberately, not dead code to delete on sight: this is the
// Service-First, Billing-Later flow the PRD describes, and re-exposing it is
// a one-line <Link> in components/service/service-page-client.tsx. The route
// still works if navigated to directly.
export default async function ServiceIntakePage() {
  await requireServiceAccess();
  const supabase = await createClient();

  const [customers, vehicles] = await Promise.all([listAllCustomersForPicker(supabase), listAllVehiclesForPicker(supabase)]);

  return <ServiceIntakeFormClient customers={customers} vehicles={vehicles} />;
}
