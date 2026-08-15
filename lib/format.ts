export const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Exported so services/dashboard/trend.ts can bucket dates into the same
// IST wall-clock days/weeks/months every other date-handling helper here
// uses — India has no DST, so a fixed offset is always correct.
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Renders an ISO timestamp as "11 Jul 2026", always in IST (the garage's
 * timezone), regardless of the server's or browser's own local timezone.
 *
 * Deliberately hand-rolled instead of toLocaleDateString("en-IN", ...):
 * (1) Node's ICU/CLDR data and a browser's can format the same locale
 * slightly differently ("11 Jul 2026" vs "11-Jul-2026"), which is a React
 * hydration mismatch for any SSR'd date column — this is exactly that bug.
 * (2) toLocaleDateString also reads the *runtime's* local timezone, which
 * for a Next.js server is usually UTC — a purchase made after 6:30pm UTC
 * (midnight IST) would render as the wrong calendar day server-side vs a
 * browser sitting in India. Shifting by a fixed IST offset and reading with
 * UTC getters sidesteps both problems: the output only depends on the
 * timestamp itself, never on which machine renders it.
 */
export function formatDate(isoDate: string): string {
  const d = new Date(new Date(isoDate).getTime() + IST_OFFSET_MS);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = MONTH_ABBR[d.getUTCMonth()];
  return `${day} ${month} ${d.getUTCFullYear()}`;
}

/**
 * Converts an ISO timestamp to the "YYYY-MM-DD" shape a native
 * `<input type="date">` expects, in IST — so a job saved late in the evening
 * IST still pre-fills with the date the garage would call it, not the
 * previous/next day the UTC clock is on.
 */
export function toISTDateInput(isoDate: string | null): string {
  if (!isoDate) return "";
  const d = new Date(new Date(isoDate).getTime() + IST_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Inverse of toISTDateInput. Expected Delivery is a date, not an
 * appointment, so a picked day resolves to the *end* of that IST day
 * (23:59) — "ready by the 15th" shouldn't read as overdue from 00:01 on the
 * 15th. Stored as timestamptz like before; only the input got simpler.
 */
export function fromISTDateInput(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 23, 59) - IST_OFFSET_MS);
}

/**
 * Converts an ISO timestamp to the "YYYY-MM-DDTHH:mm" shape a native
 * `<input type="datetime-local">` expects, expressed in IST (same fixed
 * offset as formatDate above) rather than whatever timezone the rendering
 * machine happens to be in — so a staff-entered Expected Delivery time
 * pre-fills showing the same wall-clock value it was saved with.
 */
export function toISTDateTimeLocalInput(isoDate: string | null): string {
  if (!isoDate) return "";
  const d = new Date(new Date(isoDate).getTime() + IST_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Inverse of toISTDateTimeLocalInput — treats the naive "YYYY-MM-DDTHH:mm"
 * value from a datetime-local input as an IST wall-clock time (the garage
 * only operates in one timezone) and returns the correct UTC Date, rather
 * than trusting `new Date(value)` to guess the browser's local timezone.
 */
export function fromISTDateTimeLocalInput(value: string): Date {
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hours, minutes] = (timePart ?? "00:00").split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hours, minutes) - IST_OFFSET_MS);
}

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export function formatINR(amount: number): string {
  return inrFormatter.format(amount);
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 1000 * 60 * 60 * 24 * 365],
  ["month", 1000 * 60 * 60 * 24 * 30],
  ["week", 1000 * 60 * 60 * 24 * 7],
  ["day", 1000 * 60 * 60 * 24],
  ["hour", 1000 * 60 * 60],
  ["minute", 1000 * 60],
];

const relativeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** Renders an ISO timestamp as "2 days ago" / "3 weeks ago" / "just now". */
export function formatRelativeTime(isoDate: string): string {
  const diffMs = new Date(isoDate).getTime() - Date.now();

  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(diffMs) >= ms) {
      return relativeFormatter.format(Math.round(diffMs / ms), unit);
    }
  }
  return "just now";
}
