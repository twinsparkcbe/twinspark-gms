import { requireAdmin } from "@/lib/auth/require-admin";

import { AttendanceTabs } from "@/components/attendance/attendance-tabs";

/**
 * Attendance Management — a standalone module (doc/attendance-module-scope.md).
 *
 * Admin-only, gated here at the layout so every route underneath inherits it;
 * each page and every server action re-checks with its own requireAdmin()
 * rather than trusting the layout ran (same defense-in-depth stance as
 * app/(app)/layout.tsx).
 *
 * This module shares the app's authentication, shell and design system, and
 * nothing else. It reads from and writes to no other module.
 */
export default async function AttendanceLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">Attendance</h1>
        <p className="mt-1 text-sm text-neutral-500">Mark daily staff attendance and review working hours.</p>
      </div>

      <AttendanceTabs />

      {children}
    </div>
  );
}
