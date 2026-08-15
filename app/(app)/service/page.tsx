import { requireServiceAccess } from "@/lib/auth/require-service-access";
import { createClient } from "@/lib/supabase/server";
import { getServiceStats, listServiceJobs } from "@/services/service";
import { listActiveMechanics } from "@/services/users";

import { ServicePageClient } from "@/components/service/service-page-client";

// Administrator + Mechanic (doc/mechanic-role-scope.md §4) — Sales Person
// still gets zero access here, unlike Sales.
export default async function ServicePage() {
  const { userId, role } = await requireServiceAccess();
  const supabase = await createClient();

  // A Mechanic's list opens on their own jobs. Applied here as well as in
  // the client's default filter state, so the server render and the first
  // client refetch agree and the list doesn't visibly re-filter on mount.
  const assignedMechanicId = role === "mechanic" ? userId : undefined;

  const [{ jobs, total }, stats, mechanics] = await Promise.all([
    listServiceJobs(supabase, { page: 1, pageSize: 10, assignedMechanicId }),
    getServiceStats(supabase),
    listActiveMechanics(supabase),
  ]);

  return (
    <ServicePageClient
      initialJobs={jobs}
      initialTotal={total}
      initialStats={stats}
      mechanics={mechanics}
      currentUser={{ id: userId, role }}
    />
  );
}
