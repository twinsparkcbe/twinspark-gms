"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Bike, PlayCircle, Receipt } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useGlobalLoader } from "@/components/shared/global-loader";
import type { ServiceJobRow } from "@/services/service";
import { getNextStep, type NextStepAction } from "@/services/service/next-step";

import {
  updateServiceDeliveryStatusAction,
  updateServiceJobStatusAction,
} from "@/app/(app)/service/actions";

/**
 * The one next-step button on a Service list row (rework plan Change 3).
 *
 * Previously every one of these needed a trip through the read-only detail
 * page: open the job, find the right dropdown, pick a value, go back.
 * Delivery now fires in place from the row, and billing jumps straight to the
 * entry screen.
 *
 * Marking paid can't fire in one tap — since 0027 it has to record *how* the
 * money came in — but it doesn't need a page either: the parent opens the same
 * Record Payment dialog over the list. The trip to the job detail screen
 * remains only as the fallback for someone who isn't allowed to set payment
 * (a Mechanic), where the dialog would just error on save.
 *
 * The row is patched only from the server's response, never ahead of it, so
 * it can't briefly display a state the server went on to reject — the same
 * write discipline as the detail screen, just without the navigation.
 */
export function ServiceRowActions({
  job,
  canRecordPayment,
  onRecordPayment,
  onJobUpdated,
}: {
  job: ServiceJobRow;
  /** Administrator only (doc/mechanic-role-scope.md §1). When false, "Mark
   * paid" navigates instead of opening a dialog the server would refuse. */
  canRecordPayment: boolean;
  /** Asks the parent to open the shared Record Payment dialog for this job. */
  onRecordPayment: (job: ServiceJobRow) => void;
  /** Lets the parent patch this one row in place, rather than refetching the
   * whole list and losing scroll position. */
  onJobUpdated: (job: ServiceJobRow) => void;
}) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const { runWithLoader } = useGlobalLoader();

  const nextStep = getNextStep(job);
  if (!nextStep) return null;

  async function runAction(action: NextStepAction) {
    if (action.kind === "COMPLETE_AND_BILL") {
      // Billing needs the full form (services, parts, GST) — the one step
      // that genuinely warrants leaving the list.
      router.push(`/service/${job.id}/edit`);
      return;
    }

    if (action.kind === "MARK_PAID") {
      // Since 0027, marking paid has to record *how* the money came in, which
      // a one-tap row action can't ask — but a dialog over the list can, and
      // the counter is exactly where this gets answered.
      if (canRecordPayment) {
        onRecordPayment(job);
      } else {
        router.push(`/service/${job.id}`);
      }
      return;
    }

    setIsBusy(true);
    const result = await runWithLoader(() => {
      switch (action.kind) {
        case "START_WORK":
          return updateServiceJobStatusAction({ serviceJobId: job.id, newStatus: "IN_PROGRESS" });
        case "MARK_DELIVERED":
          return updateServiceDeliveryStatusAction({ serviceJobId: job.id, deliveryStatus: "DELIVERED" });
        default:
          return updateServiceJobStatusAction({ serviceJobId: job.id, newStatus: "READY_FOR_DELIVERY" });
      }
    });
    setIsBusy(false);

    if (result.success) {
      onJobUpdated(result.data);
      toast.success(SUCCESS_MESSAGES[action.kind](job.jobNumber));
    } else {
      // Nothing was patched locally before the call returned, so there's no
      // stale state to undo — the row simply stays as it was.
      toast.error(result.error);
    }
  }

  const Icon = ACTION_ICONS[nextStep.action.kind];

  return (
    <Button
      type="button"
      size="sm"
      variant={nextStep.action.kind === "COMPLETE_AND_BILL" ? "primary" : "secondary"}
      className="h-8 rounded-[10px] px-2.5 text-xs"
      disabled={isBusy}
      onClick={() => runAction(nextStep.action)}
    >
      <Icon className="size-3.5" />
      {nextStep.label}
    </Button>
  );
}

const ACTION_ICONS = {
  START_WORK: PlayCircle,
  MARK_READY: BadgeCheck,
  COMPLETE_AND_BILL: Receipt,
  MARK_PAID: BadgeCheck,
  MARK_DELIVERED: Bike,
} as const;

const SUCCESS_MESSAGES: Record<NextStepAction["kind"], (jobNumber: string) => string> = {
  START_WORK: (n) => `${n} — work started.`,
  MARK_READY: (n) => `${n} — marked ready.`,
  COMPLETE_AND_BILL: (n) => `${n} — ready to bill.`,
  MARK_PAID: (n) => `${n} — marked paid.`,
  MARK_DELIVERED: (n) => `${n} — marked delivered.`,
};
