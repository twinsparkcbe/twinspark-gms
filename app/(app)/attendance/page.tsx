import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { getDailyAttendance, istTodayYMD } from "@/services/attendance";

import { DailyAttendanceClient } from "@/components/attendance/daily-attendance-client";

/**
 * Daily Attendance — the module's landing tab.
 *
 * Defaults to today in IST (the garage's timezone), not the server's, so a
 * page opened after 6:30pm local doesn't come up on tomorrow's date. The
 * date is a searchParam so a specific day can be linked to and refreshed.
 */
export default async function DailyAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireAdmin();
  const supabase = await createClient();

  const { date } = await searchParams;
  const attendanceDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : istTodayYMD();

  const rows = await getDailyAttendance(supabase, attendanceDate);

  return <DailyAttendanceClient initialDate={attendanceDate} initialRows={rows} />;
}
