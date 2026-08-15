import { describe, expect, it } from "vitest";

import type { ServiceDeliveryStatus, ServiceJobStatus, ServicePaymentStatus } from "@/types/database.types";

import { ALLOWED_STATUS_TRANSITIONS, getNextStep, getSecondarySteps, targetStatusOf, type NextStepJob } from "./next-step";

function job(
  status: ServiceJobStatus,
  paymentStatus: ServicePaymentStatus | null = null,
  deliveryStatus: ServiceDeliveryStatus | null = null
): NextStepJob {
  return { status, paymentStatus, deliveryStatus };
}

describe("getNextStep", () => {
  it("offers 'Start work' on a draft", () => {
    expect(getNextStep(job("DRAFT"))).toMatchObject({ label: "Start work", action: { kind: "START_WORK" } });
  });

  it("offers billing as the primary action while work is in progress", () => {
    expect(getNextStep(job("IN_PROGRESS"))).toMatchObject({ label: "Bill this job", action: { kind: "COMPLETE_AND_BILL" } });
  });

  it("offers billing from Ready for Delivery too — the same destination", () => {
    expect(getNextStep(job("READY_FOR_DELIVERY"))).toMatchObject({ action: { kind: "COMPLETE_AND_BILL" } });
  });

  it("sends billing through the entry screen rather than firing from the row", () => {
    expect(getNextStep(job("IN_PROGRESS"))?.navigates).toBe(true);
  });

  it("offers 'Mark paid' once completed and unpaid", () => {
    expect(getNextStep(job("COMPLETED", "PENDING", "WAITING"))).toMatchObject({ action: { kind: "MARK_PAID" } });
  });

  it("treats a partial payment as still outstanding", () => {
    expect(getNextStep(job("COMPLETED", "PARTIAL", "WAITING"))).toMatchObject({ action: { kind: "MARK_PAID" } });
  });

  it("moves on to 'Mark delivered' once payment is settled", () => {
    expect(getNextStep(job("COMPLETED", "PAID", "WAITING"))).toMatchObject({ action: { kind: "MARK_DELIVERED" } });
  });

  it("treats a free service as settled, so a warranty job doesn't sit in 'awaiting payment'", () => {
    expect(getNextStep(job("COMPLETED", "FREE_SERVICE", "READY_FOR_PICKUP"))).toMatchObject({ action: { kind: "MARK_DELIVERED" } });
  });

  it("has nothing left to offer once paid and delivered", () => {
    expect(getNextStep(job("COMPLETED", "PAID", "DELIVERED"))).toBeNull();
  });

  it("has nothing to offer on a cancelled job", () => {
    expect(getNextStep(job("CANCELLED"))).toBeNull();
  });

  it("marks payment and delivery actions as in-place, not navigations", () => {
    expect(getNextStep(job("COMPLETED", "PENDING", "WAITING"))?.navigates).toBe(false);
    expect(getNextStep(job("COMPLETED", "PAID", "WAITING"))?.navigates).toBe(false);
  });
});

describe("getSecondarySteps", () => {
  it("offers 'Mark ready' only from In Progress, and never as the primary action", () => {
    expect(getSecondarySteps(job("IN_PROGRESS"))).toEqual([{ action: { kind: "MARK_READY" }, label: "Mark ready", navigates: false }]);
    expect(getNextStep(job("IN_PROGRESS"))?.action.kind).not.toBe("MARK_READY");
  });

  it("offers no secondary action in any other state", () => {
    for (const status of ["DRAFT", "READY_FOR_DELIVERY", "COMPLETED", "CANCELLED"] as ServiceJobStatus[]) {
      expect(getSecondarySteps(job(status))).toEqual([]);
    }
  });
});

describe("proposed steps are always legal transitions", () => {
  const everyState: NextStepJob[] = [
    job("DRAFT"),
    job("IN_PROGRESS"),
    job("READY_FOR_DELIVERY"),
    job("COMPLETED", "PENDING", "WAITING"),
    job("COMPLETED", "PAID", "WAITING"),
    job("COMPLETED", "PAID", "DELIVERED"),
    job("CANCELLED"),
  ];

  it("never proposes a status change the server would reject (doc §5 transition table)", () => {
    for (const state of everyState) {
      for (const step of [getNextStep(state), ...getSecondarySteps(state)]) {
        if (!step) continue;
        const target = targetStatusOf(step.action);
        if (!target) continue; // payment/delivery action, not a status change
        expect(ALLOWED_STATUS_TRANSITIONS[state.status]).toContain(target);
      }
    }
  });

  it("treats COMPLETED and CANCELLED as terminal", () => {
    expect(ALLOWED_STATUS_TRANSITIONS.COMPLETED).toEqual([]);
    expect(ALLOWED_STATUS_TRANSITIONS.CANCELLED).toEqual([]);
  });
});

describe("targetStatusOf", () => {
  it("maps work actions to the status they move the job into", () => {
    expect(targetStatusOf({ kind: "START_WORK" })).toBe("IN_PROGRESS");
    expect(targetStatusOf({ kind: "MARK_READY" })).toBe("READY_FOR_DELIVERY");
    expect(targetStatusOf({ kind: "COMPLETE_AND_BILL" })).toBe("COMPLETED");
  });

  it("returns null for actions that change payment or delivery instead", () => {
    expect(targetStatusOf({ kind: "MARK_PAID" })).toBeNull();
    expect(targetStatusOf({ kind: "MARK_DELIVERED" })).toBeNull();
  });
});
