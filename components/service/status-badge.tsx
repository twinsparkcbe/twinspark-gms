import { Badge } from "@/components/ui/badge";
import type { ServiceDeliveryStatus, ServiceJobStatus, ServicePaymentStatus } from "@/types/database.types";

const JOB_STATUS_LABELS: Record<ServiceJobStatus, string> = {
  DRAFT: "Draft",
  IN_PROGRESS: "In Progress",
  READY_FOR_DELIVERY: "Ready for Delivery",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

// neutral/info while work is ongoing, success once billed, danger for a
// cancelled job — same palette convention as every other status badge.
const JOB_STATUS_VARIANTS: Record<ServiceJobStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  IN_PROGRESS: "info",
  READY_FOR_DELIVERY: "warning",
  COMPLETED: "success",
  CANCELLED: "danger",
};

export function ServiceJobStatusBadge({ status }: { status: ServiceJobStatus }) {
  return <Badge variant={JOB_STATUS_VARIANTS[status]}>{JOB_STATUS_LABELS[status]}</Badge>;
}

const PAYMENT_STATUS_LABELS: Record<ServicePaymentStatus, string> = {
  PENDING: "Payment Pending",
  PARTIAL: "Partially Paid",
  PAID: "Paid",
  FREE_SERVICE: "Free Service",
};

const PAYMENT_STATUS_VARIANTS: Record<ServicePaymentStatus, "neutral" | "warning" | "success" | "info"> = {
  PENDING: "warning",
  PARTIAL: "warning",
  PAID: "success",
  FREE_SERVICE: "info",
};

export function PaymentStatusBadge({ status }: { status: ServicePaymentStatus }) {
  return <Badge variant={PAYMENT_STATUS_VARIANTS[status]}>{PAYMENT_STATUS_LABELS[status]}</Badge>;
}

const DELIVERY_STATUS_LABELS: Record<ServiceDeliveryStatus, string> = {
  WAITING: "Waiting",
  READY_FOR_PICKUP: "Ready for Pickup",
  DELIVERED: "Delivered",
};

const DELIVERY_STATUS_VARIANTS: Record<ServiceDeliveryStatus, "neutral" | "warning" | "success"> = {
  WAITING: "neutral",
  READY_FOR_PICKUP: "warning",
  DELIVERED: "success",
};

export function DeliveryStatusBadge({ status }: { status: ServiceDeliveryStatus }) {
  return <Badge variant={DELIVERY_STATUS_VARIANTS[status]}>{DELIVERY_STATUS_LABELS[status]}</Badge>;
}

export { JOB_STATUS_LABELS, PAYMENT_STATUS_LABELS, DELIVERY_STATUS_LABELS };
