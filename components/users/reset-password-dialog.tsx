"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProfileRow } from "@/services/users";

import { resetUserPasswordAction } from "@/app/(app)/settings/users/actions";

export function ResetPasswordDialog({
  open,
  user,
  onOpenChange,
}: {
  open: boolean;
  user: ProfileRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!user) return null;
  const currentUser = user;

  function reset() {
    setPassword("");
    setShowPassword(false);
    setError("");
  }

  async function handleSubmit() {
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setIsSubmitting(true);
    const result = await resetUserPasswordAction(currentUser.id, password);
    setIsSubmitting(false);

    if (result.success) {
      toast.success(`Password reset for ${currentUser.fullName}.`);
      onOpenChange(false);
      reset();
    } else {
      setError(result.error);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isSubmitting) return;
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
          <DialogDescription>
            Set a new password for {currentUser.fullName} ({currentUser.email}). Share it with them directly — no
            email is sent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>New Password *</Label>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              placeholder="At least 8 characters"
              aria-invalid={Boolean(error) || undefined}
              className="pr-10"
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              disabled={isSubmitting}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Reset Password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
