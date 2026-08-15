/**
 * Job Card view builder (doc/service-module-scope.md §17, spec §4.7).
 * Available at ANY status, including DRAFT — printable before the invoice
 * even exists (doc §15's "print before completion" requirement). Total
 * shown here is the line-amount sum only, no GST/Discount — that breakdown
 * belongs to the Invoice (services/shared/invoice.ts), not the Job Card.
 *
 * Deliberately never reads `mechanicNotes` (doc §14) — the field simply
 * isn't part of this view's shape, so there's no path that could
 * accidentally leak it onto a customer-facing print.
 */
import type { BusinessInfo } from "@/services/shared/invoice";
import type { ServiceJobRow } from "@/services/service/jobs";

import { formatDate, formatINR } from "@/lib/format";

export interface JobCardLineView {
  slNo: number;
  description: string;
  /** Combo Offers — the bundle's contents, listed unpriced beneath. */
  comboContents?: string[];
  quantityLabel: string;
  rateLabel: string;
  amountLabel: string;
}

export interface JobCardView {
  jobNumber: string;
  jobDateLabel: string;
  statusLabel: string;
  business: BusinessInfo;
  customer: { name: string; mobile: string; addressLines: string[] };
  vehicle: { number: string; model: string; odometerLabel: string };
  /** Omitted entirely when nobody is assigned — the print shouldn't carry an
   * empty label (same stance as mechanicNotes never being in this shape). */
  assignedMechanicName?: string;
  complaintNotes: string | null;
  lines: JobCardLineView[];
  totalLabel: string;
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  IN_PROGRESS: "In Progress",
  READY_FOR_DELIVERY: "Ready for Delivery",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export function buildJobCardView(job: ServiceJobRow, business: BusinessInfo): JobCardView {
  const total = job.lines.reduce((sum, line) => sum + line.amount, 0);

  return {
    jobNumber: job.jobNumber,
    jobDateLabel: formatDate(job.createdAt),
    statusLabel: STATUS_LABELS[job.status] ?? job.status,
    business,
    customer: {
      name: job.customerName,
      mobile: job.customerMobile,
      addressLines: job.customerAddress ? [job.customerAddress] : [],
    },
    vehicle: {
      number: job.vehicleNumber,
      model: job.vehicleModel,
      odometerLabel: `${job.odometerReading.toLocaleString("en-IN")} km`,
    },
    assignedMechanicName: job.assignedMechanicName ?? undefined,
    complaintNotes: job.complaintNotes,
    lines: job.lines.map((line, index) => ({
      slNo: index + 1,
      description: line.description,
      comboContents: line.lineType === "COMBO" && line.comboContents.length > 0 ? line.comboContents : undefined,
      quantityLabel: String(line.quantity),
      rateLabel: formatINR(line.rate),
      amountLabel: formatINR(line.amount),
    })),
    totalLabel: formatINR(total),
  };
}
