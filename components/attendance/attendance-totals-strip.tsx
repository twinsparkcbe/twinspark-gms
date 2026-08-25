import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatPayableDays } from "@/services/attendance/salary";
import { formatTotalHours } from "@/services/attendance/working-hours";
import type { AttendanceTotals } from "@/services/attendance/summary";

/**
 * The footer figures for an individual employee report (§6). Plain
 * label/value tiles rather than icon cards — this sits *under* a table as a
 * summary, so it should read as a total row, not compete with the page's
 * own stat cards.
 */
export function AttendanceTotalsStrip({ totals, className }: { totals: AttendanceTotals; className?: string }) {
  const items: { label: string; value: string }[] = [
    { label: "Total Working Days", value: String(totals.workingDays) },
    { label: "Full Days", value: String(totals.fullDays) },
    { label: "First Half Days", value: String(totals.firstHalfDays) },
    { label: "Second Half Days", value: String(totals.secondHalfDays) },
    { label: "Absent Days", value: String(totals.absentDays) },
    { label: "Total Working Hours", value: formatTotalHours(totals.totalWorkingMinutes) },
    { label: "Average Working Hours", value: formatTotalHours(totals.averageWorkingMinutes) },
    { label: "Payable Days", value: formatPayableDays(totals.payableDays) },
    // An unpriced day is excluded from the sum, so say so rather than
    // presenting a partial figure as the total.
    {
      label: totals.unpricedDays > 0 ? `Salary (${totals.unpricedDays} day(s) unpriced)` : "Salary",
      value: totals.payableDays > 0 && totals.unpricedDays === totals.payableDays ? "—" : formatINR(totals.salaryPayable),
    },
  ];

  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5", className)}>
      {items.map((item) => (
        <div key={item.label} className="rounded-[10px] border border-neutral-100 bg-neutral-50 px-3 py-2">
          <p className="truncate text-xs text-neutral-500">{item.label}</p>
          <p className="mt-0.5 text-sm font-bold text-neutral-900">{item.value}</p>
        </div>
      ))}
    </div>
  );
}
