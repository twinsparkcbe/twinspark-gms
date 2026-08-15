import { Badge } from "@/components/ui/badge";
import type { OnlineOrderStatus } from "@/types/database.types";

const STATUS_CONFIG: Record<OnlineOrderStatus, { label: string; variant: "warning" | "info" | "channel" | "success" | "danger" }> = {
  SUBMITTED: { label: "Awaiting Verification", variant: "warning" },
  PAYMENT_VERIFIED: { label: "Payment Verified", variant: "info" },
  APPROVED: { label: "Approved", variant: "channel" },
  DISPATCHED: { label: "Dispatched", variant: "success" },
  REJECTED: { label: "Rejected", variant: "danger" },
};

export function OnlineOrderStatusBadge({ status }: { status: OnlineOrderStatus }) {
  const config = STATUS_CONFIG[status];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
