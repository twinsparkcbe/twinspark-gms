import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { listAttendanceEmployees } from "@/services/attendance";

import { EmployeesPageClient } from "@/components/attendance/employees-page-client";

// Server-side Admin gate on the page itself, not just the module layout —
// same defense-in-depth stance as every other Admin-only page.
export default async function AttendanceEmployeesPage() {
  await requireAdmin();
  const supabase = await createClient();

  const employees = await listAttendanceEmployees(supabase);

  return <EmployeesPageClient initialEmployees={employees} />;
}
