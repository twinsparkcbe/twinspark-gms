"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarX } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { downloadXlsx, todayForFilename, type XlsxColumn } from "@/lib/xlsx-export";
import { ATTENDANCE_STATUS_LABELS, roleDisplayLabel } from "@/services/attendance/schemas";
import { summarizeAttendance } from "@/services/attendance/summary";
import type { AttendanceEmployeeRow, AttendanceRecordRow } from "@/services/attendance/types";
import { formatWorkingHours } from "@/services/attendance/working-hours";

import { fetchEmployeeAttendanceReportAction } from "@/app/(app)/attendance/actions";

import { AttendanceStatusBadge } from "./attendance-badges";
import { AttendanceDateRangeFilter } from "./date-range-filter";
import { DownloadXlsxButton } from "@/components/reports/download-xlsx-button";
import { AttendanceTotalsStrip } from "./attendance-totals-strip";

// Date | Status | Check In | Check Out | Working Hours
const ROW_GRID_CLASS = "grid grid-cols-[140px_150px_120px_120px_minmax(120px,1fr)] gap-3";

export function EmployeeReportClient({
  employee: initialEmployee,
  initialRecords,
  initialFrom,
  initialTo,
}: {
  employee: AttendanceEmployeeRow;
  initialRecords: AttendanceRecordRow[];
  initialFrom: string;
  initialTo: string;
}) {
  const [employee, setEmployee] = useState(initialEmployee);
  const [records, setRecords] = useState(initialRecords);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [appliedRange, setAppliedRange] = useState({ from: initialFrom, to: initialTo });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const totals = useMemo(() => summarizeAttendance(records), [records]);

  async function handleApply() {
    if (from > to) {
      setError("The start date must be on or before the end date.");
      return;
    }
    setError(null);

    setIsLoading(true);
    const result = await fetchEmployeeAttendanceReportAction(employee.id, from, to);
    setIsLoading(false);

    if (result.success) {
      setEmployee(result.data.employee);
      setRecords(result.data.records);
      // Only updated on success, so the range label always describes what's
      // actually on screen — same rule as useReportDateRange.
      setAppliedRange({ from, to });
    } else {
      toast.error(result.error);
    }
  }

  function handleReset() {
    setFrom(initialFrom);
    setTo(initialTo);
    setError(null);
    if (appliedRange.from !== initialFrom || appliedRange.to !== initialTo) {
      setIsLoading(true);
      void fetchEmployeeAttendanceReportAction(employee.id, initialFrom, initialTo).then((result) => {
        setIsLoading(false);
        if (result.success) {
          setRecords(result.data.records);
          setAppliedRange({ from: initialFrom, to: initialTo });
        } else {
          toast.error(result.error);
        }
      });
    }
  }

  const COLUMNS: XlsxColumn<AttendanceRecordRow>[] = [
    { header: "Date", accessor: (record) => formatDate(`${record.attendanceDate}T00:00:00Z`) },
    { header: "Status", accessor: (record) => ATTENDANCE_STATUS_LABELS[record.status] },
    { header: "Check In", accessor: (record) => record.checkIn ?? "" },
    { header: "Check Out", accessor: (record) => record.checkOut ?? "" },
    { header: "Working Hours", accessor: (record) => formatWorkingHours(record.workingMinutes) },
  ];

  function handleDownload() {
    downloadXlsx(
      `twinspark-attendance-${employee.employeeCode}-${todayForFilename()}`,
      "Attendance",
      COLUMNS,
      records
    );
  }

  return (
    <div className="space-y-4">
      <Link
        href="/attendance/employees"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 transition-colors hover:text-neutral-900"
      >
        <ArrowLeft className="size-4" />
        Back to Employees
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold tracking-tight text-neutral-900">{employee.name}</h2>
            <Badge variant="neutral">{roleDisplayLabel(employee.role, employee.otherRoleDescription)}</Badge>
            {!employee.isActive && <Badge variant="neutral">Inactive</Badge>}
          </div>
          <p className="mt-0.5 font-mono text-xs font-bold text-neutral-500">
            {employee.employeeCode}
            {employee.mobile ? ` · ${employee.mobile}` : ""}
          </p>
        </div>
        <DownloadXlsxButton onClick={handleDownload} disabled={records.length === 0} />
      </div>

      <AttendanceDateRangeFilter
        from={from}
        to={to}
        isLoading={isLoading}
        canReset={from !== initialFrom || to !== initialTo}
        error={error}
        onFromChange={setFrom}
        onToChange={setTo}
        onApply={handleApply}
        onReset={handleReset}
      />

      <p className="text-sm text-neutral-500">
        Showing{" "}
        <span className="font-medium text-neutral-700">
          {formatDate(`${appliedRange.from}T00:00:00Z`)} – {formatDate(`${appliedRange.to}T00:00:00Z`)}
        </span>
      </p>

      <div className="rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="overflow-x-auto">
          <div role="table" aria-label={`Attendance for ${employee.name}`} aria-busy={isLoading} className="min-w-[700px]">
            <div
              role="row"
              className={cn(ROW_GRID_CLASS, "px-4 py-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase")}
            >
              <span>Date</span>
              <span>Status</span>
              <span>Check In</span>
              <span>Check Out</span>
              <span className="text-right">Working Hours</span>
            </div>

            <div className={cn("flex flex-col gap-2", isLoading && "opacity-60 transition-opacity")}>
              {records.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-16 text-center">
                  <CalendarX className="size-10 text-neutral-300" />
                  <p className="text-sm text-neutral-500">No attendance recorded in this period.</p>
                </div>
              )}

              {records.map((record) => (
                <div
                  key={record.id}
                  role="row"
                  className={cn(ROW_GRID_CLASS, "items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm")}
                >
                  <div role="cell" aria-label="Date" className="min-w-0 text-sm text-neutral-700">
                    {formatDate(`${record.attendanceDate}T00:00:00Z`)}
                  </div>
                  <div role="cell" aria-label="Status" className="min-w-0">
                    <AttendanceStatusBadge status={record.status} />
                  </div>
                  <div role="cell" aria-label="Check in" className="min-w-0 font-mono text-sm text-neutral-700">
                    {record.checkIn ?? "—"}
                  </div>
                  <div role="cell" aria-label="Check out" className="min-w-0 font-mono text-sm text-neutral-700">
                    {record.checkOut ?? "—"}
                  </div>
                  <div role="cell" aria-label="Working hours" className="min-w-0 text-right font-mono text-sm font-bold text-neutral-900">
                    {record.status === "ABSENT" ? "—" : formatWorkingHours(record.workingMinutes)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <AttendanceTotalsStrip totals={totals} />
    </div>
  );
}
