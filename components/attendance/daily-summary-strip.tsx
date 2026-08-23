import { cn } from "@/lib/utils";
import type { DailySummary } from "@/services/attendance/summary";

/**
 * The day's figures as one slim bar rather than a grid of seven cards.
 *
 * The cards were ~200px of chrome above a ten-row table, pushing half the
 * roster below the fold on a laptop — on a screen whose whole job is "see
 * everyone, mark everyone", that's the wrong trade. Same numbers, one line,
 * roster visible without scrolling.
 */
function Stat({
  label,
  value,
  dotClass,
  valueClass,
}: {
  label: string;
  value: number;
  dotClass?: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      {dotClass && <span aria-hidden className={cn("size-2 shrink-0 rounded-full", dotClass)} />}
      <span className={cn("text-lg font-extrabold tracking-tight tabular-nums", valueClass ?? "text-neutral-900")}>
        {value}
      </span>
      <span className="text-xs font-medium whitespace-nowrap text-neutral-500">{label}</span>
    </div>
  );
}

export function DailySummaryStrip({ summary }: { summary: DailySummary }) {
  return (
    <div className="flex flex-wrap items-center divide-x divide-neutral-200 overflow-hidden rounded-[12px] border border-neutral-200 bg-white shadow-sm">
      <Stat label="Employees" value={summary.totalEmployees} />
      <Stat label="Present" value={summary.present} dotClass="bg-success" valueClass="text-success" />
      <Stat
        label="Absent"
        value={summary.absent}
        dotClass="bg-danger"
        valueClass={summary.absent > 0 ? "text-danger" : undefined}
      />
      <Stat label="Full Day" value={summary.fullDay} dotClass="bg-success/60" />
      <Stat label="First Half" value={summary.firstHalf} dotClass="bg-info" />
      <Stat label="Second Half" value={summary.secondHalf} dotClass="bg-channel-purple" />

      {/* Only while there's still work to do — once the day is fully marked
          this disappears rather than sitting there reading zero. */}
      {summary.unmarked > 0 && (
        <Stat label="Not Marked" value={summary.unmarked} dotClass="bg-neutral-300" valueClass="text-neutral-400" />
      )}
    </div>
  );
}
