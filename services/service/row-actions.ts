/**
 * Which secondary actions a Service Job row offers (doc/service-edit-undo-scope.md §4).
 *
 * This exists because the list used to render a printer icon and a receipt
 * icon side by side, unlabelled, both opening a print preview — indistinguishable
 * at a glance, and reported as "both buttons do the same thing". The fix isn't a
 * better tooltip: a job card is the workshop work-order and an invoice is the
 * customer's bill, and they are never the relevant document at the same moment.
 * So exactly one print action is offered, chosen by status.
 *
 * Pure — no React, no Supabase, no `Date.now()`. Safe to import from client
 * components, and unit-testable without a DOM.
 */

import type { ServiceJobStatus } from "@/types/database.types";

export type ServiceRowPrintKind = "JOB_CARD" | "INVOICE";

/** CANCEL voids a job nothing has been billed on; UNDO_COMPLETION reverses a
 * completed one (stock back, invoice voided). Two genuinely different
 * operations behind one "step this back" affordance. */
export type ServiceRowUndoKind = "CANCEL" | "UNDO_COMPLETION";

export interface ServiceRowPrintAction {
  kind: ServiceRowPrintKind;
  label: string;
  /** Appended to `/service/{id}/` — the route this action opens. */
  segment: "job-card" | "invoice";
}

export interface ServiceRowUndoAction {
  kind: ServiceRowUndoKind;
  /** Icon tooltip / mobile button text. */
  label: string;
  /** Confirmation dialog heading. */
  title: string;
  /** Destructive button inside the dialog. */
  confirmLabel: string;
}

export interface ServiceRowActionSet {
  print: ServiceRowPrintAction;
  /** Null when there's nothing left to correct, or the viewer isn't allowed. */
  edit: { label: string } | null;
  undo: ServiceRowUndoAction | null;
}

export interface RowActionJob {
  status: ServiceJobStatus;
}

export interface RowActionViewer {
  /** Editing a billed job and undoing a completion are both Administrator-only
   * (scope §2/§3) — they move stock and void an invoice number. */
  isAdmin: boolean;
}

const JOB_CARD: ServiceRowPrintAction = { kind: "JOB_CARD", label: "Print job card", segment: "job-card" };
const INVOICE: ServiceRowPrintAction = { kind: "INVOICE", label: "Print invoice", segment: "invoice" };

const CANCEL_ACTION: ServiceRowUndoAction = {
  kind: "CANCEL",
  label: "Cancel job",
  title: "Cancel this Service Job?",
  confirmLabel: "Cancel job",
};

const UNDO_ACTION: ServiceRowUndoAction = {
  kind: "UNDO_COMPLETION",
  label: "Undo completion",
  title: "Undo this completed job?",
  confirmLabel: "Undo completion",
};

export function getRowActions(job: RowActionJob, viewer: RowActionViewer): ServiceRowActionSet {
  if (job.status === "CANCELLED") {
    // Terminal and reversible by nothing — the job card stays reachable so the
    // paperwork can still be reprinted.
    return { print: JOB_CARD, edit: null, undo: null };
  }

  if (job.status === "COMPLETED") {
    return {
      print: INVOICE,
      edit: viewer.isAdmin ? { label: "Edit invoice details" } : null,
      undo: viewer.isAdmin ? UNDO_ACTION : null,
    };
  }

  // DRAFT / IN_PROGRESS / READY_FOR_DELIVERY — nothing billed yet, so editing
  // is the ordinary flow any Mechanic can use.
  return {
    print: JOB_CARD,
    edit: { label: "Edit job" },
    undo: viewer.isAdmin ? CANCEL_ACTION : null,
  };
}

export function serviceRowPrintHref(jobId: string, print: ServiceRowPrintAction): string {
  return `/service/${jobId}/${print.segment}`;
}
