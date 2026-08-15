"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { UserRole } from "@/lib/auth/permissions";
import type { ProfileRow } from "@/services/users";

import { createUserAction, updateUserAction } from "@/app/(app)/settings/users/actions";

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "sales_person", label: "Sales Person" },
  { value: "mechanic", label: "Mechanic" },
  { value: "admin", label: "Administrator" },
];

interface FormErrors {
  fullName?: string;
  email?: string;
  password?: string;
  form?: string;
}

/**
 * Create/Edit User — one dialog, same shape as the Service Catalog's
 * Package/Specific Service dialogs (components/service/catalog-page-client.tsx).
 * Email + password only appear on create — email is immutable (no
 * change-email flow in scope) and password reset is its own explicit action
 * (ResetPasswordDialog), not bundled into a general edit.
 */
export function UserFormDialog({
  open,
  editing,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  editing: ProfileRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (user: ProfileRow) => void;
}) {
  const [fullName, setFullName] = useState(editing?.fullName ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<UserRole>(editing?.role ?? "sales_person");
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function resetForm() {
    setFullName(editing?.fullName ?? "");
    setEmail(editing?.email ?? "");
    setPassword("");
    setShowPassword(false);
    setRole(editing?.role ?? "sales_person");
    setErrors({});
  }

  async function handleSubmit() {
    const nextErrors: FormErrors = {};
    if (!fullName.trim()) nextErrors.fullName = "Name is required.";
    if (!editing) {
      if (!email.trim()) nextErrors.email = "Email is required.";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) nextErrors.email = "Enter a valid email.";
      if (password.length < 8) nextErrors.password = "Password must be at least 8 characters.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setIsSubmitting(true);
    const result = editing
      ? await updateUserAction(editing.id, { fullName: fullName.trim(), role })
      : await createUserAction({ fullName: fullName.trim(), email: email.trim(), password, role });
    setIsSubmitting(false);

    if (result.success) {
      toast.success(editing ? "User updated." : "User created.");
      onSaved(result.data);
      onOpenChange(false);
    } else {
      setErrors((prev) => ({ ...prev, form: result.error }));
      toast.error(result.error);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isSubmitting) return;
        onOpenChange(next);
        if (!next) resetForm();
      }}
    >
      <DialogContent key={editing?.id ?? "new"} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit User" : "Add User"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Full Name *</Label>
            <Input
              defaultValue={editing?.fullName ?? ""}
              placeholder="e.g. Karthik Raja"
              aria-invalid={Boolean(errors.fullName) || undefined}
              onChange={(e) => {
                setFullName(e.target.value);
                setErrors((prev) => ({ ...prev, fullName: undefined }));
              }}
              disabled={isSubmitting}
            />
            {errors.fullName && <p className="text-sm text-danger">{errors.fullName}</p>}
          </div>

          {editing ? (
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={editing.email} disabled className="text-neutral-500" />
              <p className="text-xs text-neutral-400">Email can&apos;t be changed here — delete and recreate the account if it&apos;s wrong.</p>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input
                  type="email"
                  defaultValue={email}
                  placeholder="staff@twinspark.in"
                  aria-invalid={Boolean(errors.email) || undefined}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setErrors((prev) => ({ ...prev, email: undefined }));
                  }}
                  disabled={isSubmitting}
                />
                {errors.email && <p className="text-sm text-danger">{errors.email}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Password *</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="At least 8 characters"
                    aria-invalid={Boolean(errors.password) || undefined}
                    className="pr-10"
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setErrors((prev) => ({ ...prev, password: undefined }));
                    }}
                    disabled={isSubmitting}
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
                {errors.password && <p className="text-sm text-danger">{errors.password}</p>}
                <p className="text-xs text-neutral-400">Share this with them directly — no invite email is sent.</p>
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label>Role *</Label>
            <Select value={role} onValueChange={(value) => setRole(value as UserRole)} disabled={isSubmitting}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {errors.form && <p className="text-sm text-danger">{errors.form}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
