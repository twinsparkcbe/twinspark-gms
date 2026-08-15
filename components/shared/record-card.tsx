import { cn } from "@/lib/utils";

/**
 * The mobile counterpart to the app's list rows.
 *
 * Below `md` the list tables are unusable — Sales and Service force a 900px
 * minimum width, Online Orders 1180px, against a ~390px phone. Rather than
 * scroll sideways, each row re-renders as one of these cards.
 *
 * Deliberately a small set of layout primitives, not a single configurable
 * "card" component: the three lists show genuinely different fields, and a
 * props bag wide enough to cover all of them would be harder to read than the
 * markup it replaced. What's shared here is the chrome — spacing, borders,
 * type scale, field alignment — so the three lists stay visually identical
 * without their content being forced into one shape.
 */

export function RecordCard({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm", className)}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Title on the left, a figure or badge on the right. `subtitle` sits under the
 * title in muted text — usually a phone number, SKU, or vehicle.
 */
export function RecordCardHeader({
  title,
  subtitle,
  trailing,
  leading,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  leading?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {leading}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-neutral-900">{title}</div>
          {subtitle && <div className="mt-0.5 truncate text-xs text-neutral-500">{subtitle}</div>}
        </div>
      </div>
      {trailing && <div className="shrink-0 text-right">{trailing}</div>}
    </div>
  );
}

/**
 * Label/value pairs in a two-column grid. Two per row reads better than a
 * stack on a phone, and keeps the card short enough that several fit on
 * screen at once.
 */
export function RecordCardFields({
  fields,
}: {
  fields: { label: string; value: React.ReactNode }[];
}) {
  if (fields.length === 0) return null;

  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
      {fields.map((field) => (
        <div key={field.label} className="min-w-0">
          <dt className="truncate text-[11px] tracking-wide text-neutral-400 uppercase">{field.label}</dt>
          <dd className="mt-0.5 truncate text-sm text-neutral-800">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Full-width action row, separated by a hairline. Buttons inside should be
 * text+icon rather than icon-only — a phone has no hover, so an icon-only
 * button with a `title` tooltip is unlabelled in practice.
 */
export function RecordCardActions({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3", className)}
      {...props}
    >
      {children}
    </div>
  );
}
