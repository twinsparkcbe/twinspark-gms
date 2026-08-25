"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileBarChart } from "lucide-react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, formatINR, MONTH_ABBR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { downloadXlsxWorkbook, toSheetData, todayForFilename, type XlsxColumn } from "@/lib/xlsx-export";
import { ATTENDANCE_ROLE_LABELS, ATTENDANCE_ROLES, roleDisplayLabel } from "@/services/attendance/schemas";
import {
  filterToMonth,
  listMonthKeys,
  summarizeByEmployee,
  type EmployeeAttendanceSummary,
} from "@/services/attendance/summary";
import type { AttendanceEmployeeRow, AttendanceRecordWithEmployee } from "@/services/attendance/types";
import { formatPayableDays } from "@/services/attendance/salary";
import { formatTotalHours } from "@/services/attendance/working-hours";
import type { AttendanceRole } from "@/types/database.types";

import { fetchAttendanceReportAction } from "@/app/(app)/attendance/actions";

import { AttendanceDateRangeFilter } from "./date-range-filter";
import { DownloadXlsxButton } from "@/components/reports/download-xlsx-button";

const ALL = "ALL";

/** "2026-08" -> "August 2026". Pure string work, so no timezone can shift
 * the label off by a month. */
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function shortMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return `${MONTH_ABBR[month - 1]} ${year}`;
}

// Employee | Role | Working Days | Full | First Half | Second Half | Absent | Total Hours
// ...Payable Days and Salary appended. Salary is deliberately last and
// right-aligned: it's the figure the owner scans down the column for.
const ROW_GRID_CLASS =
  "grid grid-cols-[minmax(140px,1fr)_120px_80px_60px_75px_85px_70px_95px_90px_115px] gap-2.5";

function SummaryTable({
  summaries,
  ariaLabel,
  isLoading,
  emptyText,
}: {
  summaries: EmployeeAttendanceSummary[];
  ariaLabel: string;
  isLoading?: boolean;
  emptyText: string;
}) {
  return (
    <div className="overflow-x-auto">
      <div role="table" aria-label={ariaLabel} aria-busy={isLoading} className="min-w-[900px]">
        <div
          role="row"
          className={cn(ROW_GRID_CLASS, "px-4 py-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase")}
        >
          <span>Employee</span>
          <span>Role</span>
          <span className="text-right">Working Days</span>
          <span className="text-right">Full</span>
          <span className="text-right">First Half</span>
          <span className="text-right">Second Half</span>
          <span className="text-right">Absent</span>
          <span className="text-right">Total Hours</span>
          <span className="text-right">Payable Days</span>
          <span className="text-right">Salary</span>
        </div>

        <div className={cn("flex flex-col gap-2", isLoading && "opacity-60 transition-opacity")}>
          {summaries.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <FileBarChart className="size-10 text-neutral-300" />
              <p className="text-sm text-neutral-500">{emptyText}</p>
            </div>
          )}

          {summaries.map((summary) => (
            <div
              key={summary.employeeId}
              role="row"
              className={cn(ROW_GRID_CLASS, "items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm")}
            >
              <div role="cell" aria-label="Employee" className="min-w-0">
                <Link
                  href={`/attendance/employees/${summary.employeeId}`}
                  className="truncate font-semibold text-neutral-900 hover:text-brand-red hover:underline"
                >
                  {summary.employeeName}
                </Link>
                <div className="truncate font-mono text-[11px] font-bold text-neutral-500">{summary.employeeCode}</div>
              </div>
              <div role="cell" aria-label="Role" className="min-w-0 truncate text-sm text-neutral-600">
                {roleDisplayLabel(summary.employeeRole, summary.employeeOtherRoleDescription)}
              </div>
              <div role="cell" aria-label="Working days" className="text-right text-sm font-semibold text-neutral-900">
                {summary.workingDays}
              </div>
              <div role="cell" aria-label="Full days" className="text-right text-sm text-neutral-700">
                {summary.fullDays}
              </div>
              <div role="cell" aria-label="First half days" className="text-right text-sm text-neutral-700">
                {summary.firstHalfDays}
              </div>
              <div role="cell" aria-label="Second half days" className="text-right text-sm text-neutral-700">
                {summary.secondHalfDays}
              </div>
              <div role="cell" aria-label="Absent days" className={cn("text-right text-sm", summary.absentDays > 0 ? "font-semibold text-danger" : "text-neutral-700")}>
                {summary.absentDays}
              </div>
              <div role="cell" aria-label="Total hours" className="text-right font-mono text-sm text-neutral-700">
                {formatTotalHours(summary.totalWorkingMinutes)}
              </div>
              <div role="cell" aria-label="Payable days" className="text-right text-sm font-semibold text-neutral-900">
                {formatPayableDays(summary.payableDays)}
              </div>
              {/* Unpriced worked days are excluded from the sum, so the cell
                  says so instead of quietly under-reporting the wage bill. */}
              <div role="cell" aria-label="Salary" className="text-right font-mono text-sm font-bold text-neutral-900">
                {summary.payableDays > 0 && summary.unpricedDays === summary.payableDays ? (
                  <span className="font-sans text-xs font-medium text-neutral-400" title="No salary per day recorded for this employee">
                    no rate set
                  </span>
                ) : (
                  <>
                    {formatINR(summary.salaryPayable)}
                    {summary.unpricedDays > 0 && (
                      <span className="block text-[10px] font-medium text-warning" title="Some worked days have no rate recorded">
                        +{summary.unpricedDays} unpriced
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Attendance Reports (§7) plus the Monthly Summary (§8).
 *
 * One fetch drives both views: the date-range report is the raw records
 * rolled up per employee, and the monthly summary is the same rollup applied
 * to one month's slice of those records. Deriving both from a single result
 * set means the two tables can never disagree with each other.
 */
export function AttendanceReportsClient({
  employees,
  initialRecords,
  initialFrom,
  initialTo,
}: {
  /** Full roster, active and inactive — a report may well cover someone who
   * has since left, so the employee filter must still list them. */
  employees: AttendanceEmployeeRow[];
  initialRecords: AttendanceRecordWithEmployee[];
  initialFrom: string;
  initialTo: string;
}) {
  const [records, setRecords] = useState(initialRecords);
  const [employeeId, setEmployeeId] = useState<string>(ALL);
  const [role, setRole] = useState<string>(ALL);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [appliedRange, setAppliedRange] = useState({ from: initialFrom, to: initialTo });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [monthKey, setMonthKey] = useState<string>(() => listMonthKeys(initialRecords)[0] ?? initialTo.slice(0, 7));

  const summaries = useMemo(() => summarizeByEmployee(records), [records]);
  const monthKeys = useMemo(() => listMonthKeys(records), [records]);
  const monthlySummaries = useMemo(() => summarizeByEmployee(filterToMonth(records, monthKey)), [records, monthKey]);

  const isFiltered = employeeId !== ALL || role !== ALL || from !== initialFrom || to !== initialTo;

  async function runReport(nextFrom: string, nextTo: string, nextEmployeeId: string, nextRole: string) {
    if (nextFrom > nextTo) {
      setError("The start date must be on or before the end date.");
      return;
    }
    setError(null);

    setIsLoading(true);
    const result = await fetchAttendanceReportAction({
      from: nextFrom,
      to: nextTo,
      employeeId: nextEmployeeId === ALL ? undefined : nextEmployeeId,
      role: nextRole === ALL ? undefined : (nextRole as AttendanceRole),
    });
    setIsLoading(false);

    if (result.success) {
      setRecords(result.data);
      setAppliedRange({ from: nextFrom, to: nextTo });
      // Keep the month picker pointing at something that exists in the new
      // result set, otherwise the monthly table silently empties.
      const months = listMonthKeys(result.data);
      if (months.length > 0 && !months.includes(monthKey)) setMonthKey(months[0]);
    } else {
      toast.error(result.error);
    }
  }

  function handleReset() {
    setEmployeeId(ALL);
    setRole(ALL);
    setFrom(initialFrom);
    setTo(initialTo);
    setError(null);
    void runReport(initialFrom, initialTo, ALL, ALL);
  }

  const SUMMARY_COLUMNS: XlsxColumn<EmployeeAttendanceSummary>[] = [
    { header: "Employee ID", accessor: (row) => row.employeeCode },
    { header: "Employee", accessor: (row) => row.employeeName },
    { header: "Role", accessor: (row) => roleDisplayLabel(row.employeeRole, row.employeeOtherRoleDescription) },
    { header: "Working Days", accessor: (row) => row.workingDays },
    { header: "Full Days", accessor: (row) => row.fullDays },
    { header: "First Half", accessor: (row) => row.firstHalfDays },
    { header: "Second Half", accessor: (row) => row.secondHalfDays },
    { header: "Absent", accessor: (row) => row.absentDays },
    { header: "Total Hours", accessor: (row) => formatTotalHours(row.totalWorkingMinutes) },
    { header: "Average Hours", accessor: (row) => formatTotalHours(row.averageWorkingMinutes) },
    { header: "Payable Days", accessor: (row) => row.payableDays },
    { header: "Salary", accessor: (row) => (row.unpricedDays === row.payableDays && row.payableDays > 0 ? "" : row.salaryPayable) },
    { header: "Unpriced Days", accessor: (row) => row.unpricedDays },
  ];

  function handleDownload() {
    const sheets = [toSheetData("Attendance Summary", SUMMARY_COLUMNS, summaries)];
    if (monthlySummaries.length > 0) {
      sheets.push(toSheetData(shortMonthLabel(monthKey), SUMMARY_COLUMNS, monthlySummaries));
    }
    downloadXlsxWorkbook(`twinspark-attendance-report-${todayForFilename()}`, sheets);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-neutral-900">Attendance Reports</h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            Filter by employee, role, and date range. Deactivated employees still appear for periods they worked.
          </p>
        </div>
        <DownloadXlsxButton onClick={handleDownload} disabled={summaries.length === 0} />
      </div>

      <AttendanceDateRangeFilter
        from={from}
        to={to}
        isLoading={isLoading}
        canReset={isFiltered}
        error={error}
        onFromChange={setFrom}
        onToChange={setTo}
        onApply={() => void runReport(from, to, employeeId, role)}
        onReset={handleReset}
      >
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Employee</Label>
          <Select value={employeeId} onValueChange={setEmployeeId} disabled={isLoading}>
            <SelectTrigger className="h-9 w-[200px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Employees</SelectItem>
              {employees.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.name}
                  {employee.isActive ? "" : " (inactive)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Role</Label>
          <Select value={role} onValueChange={setRole} disabled={isLoading}>
            <SelectTrigger className="h-9 w-[170px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Roles</SelectItem>
              {ATTENDANCE_ROLES.map((value) => (
                <SelectItem key={value} value={value}>
                  {ATTENDANCE_ROLE_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </AttendanceDateRangeFilter>

      <div className="space-y-3 rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-neutral-500">
          Summary for{" "}
          <span className="font-medium text-neutral-700">
            {formatDate(`${appliedRange.from}T00:00:00Z`)} – {formatDate(`${appliedRange.to}T00:00:00Z`)}
          </span>
        </p>
        <SummaryTable
          summaries={summaries}
          ariaLabel="Attendance summary"
          isLoading={isLoading}
          emptyText="No attendance recorded for these filters."
        />
      </div>

      <div className="space-y-3 rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-bold text-neutral-900">Monthly Summary</h3>
            <p className="mt-0.5 text-xs text-neutral-500">One calendar month from the range above.</p>
          </div>
          {monthKeys.length > 0 && (
            <Select value={monthKey} onValueChange={setMonthKey} disabled={isLoading}>
              <SelectTrigger className="h-9 w-[180px] text-sm" aria-label="Month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthKeys.map((key) => (
                  <SelectItem key={key} value={key}>
                    {monthLabel(key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <SummaryTable
          summaries={monthlySummaries}
          ariaLabel="Monthly attendance summary"
          isLoading={isLoading}
          emptyText="No attendance recorded in this month."
        />
      </div>
    </div>
  );
}
