/**
 * "What happens to this job next" (rework plan Change 7, test cases §F).
 *
 * The status ladder is unchanged in the database — DRAFT → IN_PROGRESS →
 * READY_FOR_DELIVERY → COMPLETED, plus CANCELLED. What changes is that the
 * UI stops asking the admin to navigate it. Each job resolves to exactly one
 * primary action, so a list row or a detail header can render a single button
 * instead of a menu of transitions.
 *
 * "Mark ready for delivery" is demoted to a secondary action: billing works
 * directly from IN_PROGRESS, so the middle rung is a marker the shop may use,
 * not a step the system requires.
 *
 * Pure — no React, no Supabase. Safe to import from client components.
 */

import type { ServiceDeliveryStatus, ServiceJobStatus, ServicePaymentStatus } from "@/types/database.types";

export type NextStepAction =
  | { kind: "START_WORK" }
  | { kind: "MARK_READY" }
  | { kind: "COMPLETE_AND_BILL" }
  | { kind: "MARK_PAID" }
  | { kind: "MARK_DELIVERED" };

export interface NextStep {
  action: NextStepAction;
  label: string;
  /** True when the action needs the full entry screen rather than firing
   * in place from a list row. */
  navigates: boolean;
}

export interface NextStepJob {
  status: ServiceJobStatus;
  paymentStatus: ServicePaymentStatus | null;
  deliveryStatus: ServiceDeliveryStatus | null;
}

/** FREE_SERVICE is settled, not outstanding — a warranty job must not sit in
 * "awaiting payment" forever (doc §11). */
function isPaymentSettled(paymentStatus: ServicePaymentStatus | null): boolean {
  return paymentStatus === "PAID" || paymentStatus === "FREE_SERVICE";
}

/**
 * The one primary action for a job, or `null` when there's nothing left to
 * do (fully billed, paid and delivered — or cancelled).
 */
export function getNextStep(job: NextStepJob): NextStep | null {
  switch (job.status) {
    case "DRAFT":
      return { action: { kind: "START_WORK" }, label: "Start work", navigates: false };

    // Both pre-completion working states lead to the same place: the shop
    // fixes the bike, then bills it in one sitting (doc §21).
    case "IN_PROGRESS":
    case "READY_FOR_DELIVERY":
      return { action: { kind: "COMPLETE_AND_BILL" }, label: "Bill this job", navigates: true };

    case "COMPLETED": {
      if (!isPaymentSettled(job.paymentStatus)) {
        return { action: { kind: "MARK_PAID" }, label: "Mark paid", navigates: false };
      }
      if (job.deliveryStatus !== "DELIVERED") {
        return { action: { kind: "MARK_DELIVERED" }, label: "Mark delivered", navigates: false };
      }
      return null;
    }

    case "CANCELLED":
    default:
      return null;
  }
}

/**
 * Actions offered alongside the primary one. Only IN_PROGRESS has a genuine
 * optional rung; everywhere else this is empty, which is the point — fewer
 * buttons competing for attention.
 */
export function getSecondarySteps(job: NextStepJob): NextStep[] {
  if (job.status === "IN_PROGRESS") {
    return [{ action: { kind: "MARK_READY" }, label: "Mark ready", navigates: false }];
  }
  return [];
}

/** Status transitions the server will accept — mirrors the transition table
 * enforced by `update_service_job_status()` (doc §5). Exported so tests can
 * assert no proposed step is ever illegal. */
export const ALLOWED_STATUS_TRANSITIONS: Readonly<Record<ServiceJobStatus, readonly ServiceJobStatus[]>> = {
  DRAFT: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["READY_FOR_DELIVERY", "COMPLETED", "CANCELLED"],
  READY_FOR_DELIVERY: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

/** The status an action moves the job into, or `null` for actions that
 * change payment/delivery rather than job status. */
export function targetStatusOf(action: NextStepAction): ServiceJobStatus | null {
  switch (action.kind) {
    case "START_WORK":
      return "IN_PROGRESS";
    case "MARK_READY":
      return "READY_FOR_DELIVERY";
    case "COMPLETE_AND_BILL":
      return "COMPLETED";
    default:
      return null;
  }
}
