import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { firstDayOfMonth, getEmployeeAttendanceReport, istTodayYMD } from "@/services/attendance";

import { EmployeeReportClient } from "@/components/attendance/employee-report-client";

/**
 * Individual employee attendance report. Defaults to the current IST month
 * to date — the range the garage owner checks most often.
 *
 * Reads the employee directly rather than through the active roster, so the
 * report still opens for someone who has since been deactivated (Rule 6).
 */
export default async function EmployeeAttendanceReportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const supabase = await createClient();

  const { id } = await params;
  const to = istTodayYMD();
  const from = firstDayOfMonth(to);

  const { employee, records } = await getEmployeeAttendanceReport(supabase, id, from, to);

  return <EmployeeReportClient employee={employee} initialRecords={records} initialFrom={from} initialTo={to} />;
}
