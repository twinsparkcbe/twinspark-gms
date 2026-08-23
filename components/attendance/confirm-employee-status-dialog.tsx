"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AttendanceEmployeeRow } from "@/services/attendance/types";

export function ConfirmEmployeeStatusDialog({
  open,
  employee,
  nextActive,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  employee: AttendanceEmployeeRow | null;
  nextActive: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (employee: AttendanceEmployeeRow) => Promise<{ success: boolean; error?: string }>;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleConfirm() {
    if (!employee) return;
    setIsSubmitting(true);
    const result = await onConfirm(employee);
    setIsSubmitting(false);
    if (result.success) onOpenChange(false);
    else if (result.error) toast.error(result.error);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isSubmitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{nextActive ? "Activate Employee" : "Deactivate Employee"}</DialogTitle>
          <DialogDescription>
            {nextActive ? (
              <>
                <span className="font-medium text-neutral-700">{employee?.name}</span> will appear in the Daily
                Attendance list again from today onwards.
              </>
            ) : (
              <>
                <span className="font-medium text-neutral-700">{employee?.name}</span> will stop appearing in the Daily
                Attendance list. Their past attendance records are kept and stay visible in every report.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={nextActive ? "primary" : "danger"}
            onClick={handleConfirm}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Saving..." : nextActive ? "Activate" : "Deactivate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
