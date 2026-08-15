"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useGlobalLoader } from "@/components/shared/global-loader";
import { formatINR } from "@/lib/format";
import type { ServiceJobRow } from "@/services/service";
import type { ServiceRowUndoAction } from "@/services/service/row-actions";

/**
 * The one confirmation gate in front of both reversals
 * (doc/service-edit-undo-scope.md §3/§4).
 *
 * It spells out the consequences the admin can't see from the row — which
 * parts go back into stock, that the invoice number is being voided and won't
 * be reissued, that money was already collected, that the bike has already
 * left — because every one of those is a fact they'd otherwise only discover
 * afterwards. A reason is required for the same reason Undo Sale Return has
 * required one since 0015: six months later the job timeline is the only
 * record of why a bill vanished.
 */
export function UndoServiceJobDialog({
  open,
  onOpenChange,
  job,
  action,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: ServiceJobRow | null;
  action: ServiceRowUndoAction | null;
  onConfirm: (input: { serviceJobId: string; reason: string }) => Promise<{ success: boolean; error?: string }>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isBusy, setIsBusy] = useState(false);
  const { runWithLoader } = useGlobalLoader();

  // Never carry one job's reason over to the next — the dialog is mounted once
  // by the list and reused for every row.
  useEffect(() => {
    if (open) {
      setReason("");
      setError(undefined);
    }
  }, [open, job?.id]);

  if (!job || !action) return null;

  const isUndoCompletion = action.kind === "UNDO_COMPLETION";
  const partsToRestore = isUndoCompletion ? job.usage : [];
  const collected = job.cashAmount + job.upiAmount;

  async function handleConfirm() {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setError("Give a short reason (at least 3 characters).");
      return;
    }

    setIsBusy(true);
    const result = await runWithLoader(() => onConfirm({ serviceJobId: job!.id, reason: trimmed }));
    setIsBusy(false);

    if (result.success) {
      onOpenChange(false);
    } else {
      setError(result.error ?? "Something went wrong.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{action.title}</DialogTitle>
          <DialogDescription>
            {job.jobNumber} · {job.customerName} · {job.vehicleNumber}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* No light warning token exists by design (globals.css: "solid, no
              light variant"), so the tint comes from an alpha of the same
              colour rather than a one-off hex. */}
          <div className="rounded-[10px] border border-warning/40 bg-warning/10 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <div className="space-y-1.5 text-sm text-neutral-700">
                {isUndoCompletion ? (
                  <>
                    <p>
                      Invoice <span className="font-mono font-semibold">{job.invoiceNumber ?? "—"}</span> will be voided. Completing this job again
                      issues a <span className="font-semibold">new</span> invoice number — this one is not reused.
                    </p>
                    {partsToRestore.length > 0 && (
                      <div>
                        <p className="font-medium">These parts go back into stock:</p>
                        <ul className="mt-0.5 list-disc pl-4">
                          {partsToRestore.map((part) => (
                            <li key={part.id}>
                              {part.itemName} × {part.quantityUsed}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {collected > 0 && (
                      <p className="font-medium text-danger">
                        {formatINR(collected)} already recorded as collected will be cleared.
                      </p>
                    )}
                    {job.deliveryStatus === "DELIVERED" && <p className="font-medium">This job was already marked delivered.</p>}
                  </>
                ) : (
                  <p>
                    This job will be marked Cancelled. Nothing has been billed and no stock has moved, so nothing is reversed — but a cancelled job
                    can&apos;t be reopened.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="undo-reason">Reason</Label>
            <Textarea
              id="undo-reason"
              value={reason}
              placeholder={isUndoCompletion ? "e.g. Billed the wrong quantity of engine oil" : "e.g. Customer took the bike away without service"}
              aria-invalid={Boolean(error) || undefined}
              onChange={(e) => {
                setReason(e.target.value);
                setError(undefined);
              }}
            />
            {error && <p className="text-xs text-danger">{error}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isBusy}>
            Keep as is
          </Button>
          <Button type="button" variant="danger" onClick={handleConfirm} disabled={isBusy}>
            {isBusy ? "Working..." : action.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
