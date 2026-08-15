"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ProfileRow } from "@/services/users";

/**
 * Activate/Deactivate confirmation — same shared shape as Online Orders'
 * ConfirmOrderActionDialog (components/online-orders/confirm-order-action-dialog.tsx).
 * Deactivation is the "destructive" direction per the style guide (blocks
 * the account from signing in immediately) so it gets the danger button
 * variant; reactivating is a plain primary action.
 */
export function ConfirmUserStatusDialog({
  open,
  onOpenChange,
  user,
  nextActive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: ProfileRow | null;
  nextActive: boolean;
  onConfirm: (user: ProfileRow) => Promise<{ success: boolean; error?: string }>;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!user) return null;
  const currentUser = user;

  async function handleConfirm() {
    setIsSubmitting(true);
    setError("");
    const result = await onConfirm(currentUser);
    setIsSubmitting(false);

    if (result.success) {
      onOpenChange(false);
    } else if (result.error) {
      setError(result.error);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isSubmitting) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{nextActive ? "Activate User" : "Deactivate User"}</DialogTitle>
          <DialogDescription>
            {nextActive
              ? `Reactivate ${currentUser.fullName}'s account? They'll be able to sign in again immediately.`
              : `Deactivate ${currentUser.fullName}'s account? They'll be signed out and blocked from signing in again, effective immediately.`}
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-danger">{error}</p>}

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
