import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { computeDelta, formatDeltaPercent, type DeltaDirection } from "@/services/dashboard/delta";

/**
 * Whether a rise in this metric is good news.
 *
 * - `gain`    Sales, Profit — up is green, down is red.
 * - `neutral` Purchase Amount — spending more on restocking isn't inherently
 *             bad (it's usually a *good* sign in a growing month), so it gets
 *             a direction arrow but no success/danger colouring. Colouring it
 *             red would nag the owner for doing the right thing.
 */
export type DeltaPolarity = "gain" | "neutral";

function directionClass(direction: DeltaDirection, polarity: DeltaPolarity): string {
  if (polarity === "neutral" || direction === "flat") return "text-neutral-500";
  return direction === "up" ? "text-success" : "text-danger";
}

function DirectionIcon({ direction }: { direction: DeltaDirection }) {
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  return <Icon className="size-3.5 shrink-0" aria-hidden="true" />;
}

/**
 * The "vs previous period" pill. Renders nothing at all when there's no
 * meaningful comparison to draw — a brand-new garage shouldn't be shown "0%"
 * as though a comparison happened (doc/dashboard-redesign-scope.md §3g).
 */
export function MetricDelta({
  current,
  previous,
  polarity = "gain",
  className,
}: {
  current: number;
  previous: number;
  polarity?: DeltaPolarity;
  className?: string;
}) {
  const delta = computeDelta(current, previous);

  if (delta.kind === "none") return null;

  if (delta.kind === "new") {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full bg-success-bg px-2 py-0.5 text-xs font-semibold text-success",
          className
        )}
      >
        New
      </span>
    );
  }

  const label =
    delta.kind === "percent"
      ? formatDeltaPercent(delta.value)
      : `${delta.value >= 0 ? "+" : "−"}${formatINR(Math.abs(delta.value))}`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-semibold",
        directionClass(delta.direction, polarity),
        className
      )}
    >
      <DirectionIcon direction={delta.direction} />
      {label}
    </span>
  );
}
