import { describe, expect, it } from "vitest";

import { getRowActions, serviceRowPrintHref } from "./row-actions";
import type { ServiceJobStatus } from "@/types/database.types";

const ADMIN = { isAdmin: true };
const MECHANIC = { isAdmin: false };

const OPEN_STATUSES: ServiceJobStatus[] = ["DRAFT", "IN_PROGRESS", "READY_FOR_DELIVERY"];

describe("getRowActions", () => {
  it("offers the job card on every pre-completion status", () => {
    for (const status of OPEN_STATUSES) {
      expect(getRowActions({ status }, ADMIN).print).toMatchObject({ kind: "JOB_CARD", segment: "job-card" });
    }
  });

  it("swaps the job card for the invoice once completed", () => {
    expect(getRowActions({ status: "COMPLETED" }, ADMIN).print).toMatchObject({ kind: "INVOICE", segment: "invoice" });
  });

  it("offers Cancel as the undo on an open job", () => {
    for (const status of OPEN_STATUSES) {
      expect(getRowActions({ status }, ADMIN).undo?.kind).toBe("CANCEL");
    }
  });

  it("offers Undo Completion on a completed job", () => {
    expect(getRowActions({ status: "COMPLETED" }, ADMIN).undo?.kind).toBe("UNDO_COMPLETION");
  });

  it("offers nothing to undo or edit on a cancelled job, but keeps the job card", () => {
    const actions = getRowActions({ status: "CANCELLED" }, ADMIN);
    expect(actions.undo).toBeNull();
    expect(actions.edit).toBeNull();
    expect(actions.print.kind).toBe("JOB_CARD");
  });

  it("never offers undo to a non-admin", () => {
    for (const status of ["DRAFT", "IN_PROGRESS", "READY_FOR_DELIVERY", "COMPLETED", "CANCELLED"] as ServiceJobStatus[]) {
      expect(getRowActions({ status }, MECHANIC).undo).toBeNull();
    }
  });

  it("lets a non-admin edit an open job but not a billed one", () => {
    for (const status of OPEN_STATUSES) {
      expect(getRowActions({ status }, MECHANIC).edit).not.toBeNull();
    }
    expect(getRowActions({ status: "COMPLETED" }, MECHANIC).edit).toBeNull();
  });

  // The regression this whole module exists to prevent: two actions rendering
  // as interchangeable grey icons.
  it("gives every offered action a distinct label", () => {
    for (const status of ["DRAFT", "IN_PROGRESS", "READY_FOR_DELIVERY", "COMPLETED", "CANCELLED"] as ServiceJobStatus[]) {
      const actions = getRowActions({ status }, ADMIN);
      const labels = [actions.print.label, actions.edit?.label, actions.undo?.label].filter(Boolean);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});

describe("serviceRowPrintHref", () => {
  it("routes each print action to its own page", () => {
    const jobId = "0f8e4a1c-1111-4222-8333-444455556666";
    expect(serviceRowPrintHref(jobId, getRowActions({ status: "IN_PROGRESS" }, ADMIN).print)).toBe(`/service/${jobId}/job-card`);
    expect(serviceRowPrintHref(jobId, getRowActions({ status: "COMPLETED" }, ADMIN).print)).toBe(`/service/${jobId}/invoice`);
  });
});
