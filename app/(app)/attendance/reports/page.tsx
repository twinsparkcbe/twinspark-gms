import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { firstDayOfMonth, istTodayYMD, listAttendanceEmployees, listAttendanceRecords } from "@/services/attendance";

import { AttendanceReportsClient } from "@/components/attendance/attendance-reports-client";

/**
 * Attendance Reports — date-range summary plus the monthly view.
 *
 * Opens on the current IST month to date, so the page is useful before any
 * filter is touched. The employee list is the *full* roster (not just active
 * staff): a report can cover a period worked by someone who has since been
 * deactivated, and the filter has to be able to name them.
 */
export default async function AttendanceReportsPage() {
  await requireAdmin();
  const supabase = await createClient();

  const to = istTodayYMD();
  const from = firstDayOfMonth(to);

  const [employees, records] = await Promise.all([
    listAttendanceEmployees(supabase),
    listAttendanceRecords(supabase, { from, to }),
  ]);

  return (
    <AttendanceReportsClient employees={employees} initialRecords={records} initialFrom={from} initialTo={to} />
  );
}
