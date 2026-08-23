"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ATTENDANCE_ROLE_LABELS, ATTENDANCE_ROLES } from "@/services/attendance/schemas";
import type { AttendanceEmployeeRow } from "@/services/attendance/types";
import type { AttendanceRole } from "@/types/database.types";

import { createAttendanceEmployeeAction, updateAttendanceEmployeeAction } from "@/app/(app)/attendance/actions";

interface FormErrors {
  name?: string;
  otherRoleDescription?: string;
  mobile?: string;
  joiningDate?: string;
  form?: string;
}

function todayYMD(): string {
  // The <input type="date"> value the browser itself would call "today".
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Add/Edit Employee — same dialog shape as components/users/user-form-dialog.tsx.
 * Unlike Users, every field stays editable on edit: an employee code or
 * joining date typed in wrong is a plain data-entry mistake with no auth
 * consequences, so there's no reason to force a delete-and-recreate.
 */
export function EmployeeFormDialog({
  open,
  editing,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  editing: AttendanceEmployeeRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (employee: AttendanceEmployeeRow) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [role, setRole] = useState<AttendanceRole>(editing?.role ?? "SALES_PERSON");
  const [otherRoleDescription, setOtherRoleDescription] = useState(editing?.otherRoleDescription ?? "");
  const [mobile, setMobile] = useState(editing?.mobile ?? "");
  const [joiningDate, setJoiningDate] = useState(editing?.joiningDate ?? todayYMD());
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function resetForm() {
    setName(editing?.name ?? "");
    setRole(editing?.role ?? "SALES_PERSON");
    setOtherRoleDescription(editing?.otherRoleDescription ?? "");
    setMobile(editing?.mobile ?? "");
    setJoiningDate(editing?.joiningDate ?? todayYMD());
    setIsActive(editing?.isActive ?? true);
    setErrors({});
  }

  async function handleSubmit() {
    const nextErrors: FormErrors = {};
    if (!name.trim()) nextErrors.name = "Employee name is required.";
    // "Other Staff" alone doesn't say who someone is — same rule the Zod
    // schema and the DB CHECK constraint both enforce.
    if (role === "OTHER_STAFF" && !otherRoleDescription.trim()) {
      nextErrors.otherRoleDescription = "Say what this person does — e.g. Watchman, Accountant, Cleaner.";
    }
    if (!joiningDate) nextErrors.joiningDate = "Joining date is required.";
    // Optional, but must be a real number if given — mirrors the Zod rule.
    if (mobile.trim() && !/^[6-9]\d{9}$/.test(mobile.trim())) nextErrors.mobile = "Enter a valid 10-digit mobile number.";

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const input = {
      name: name.trim(),
      role,
      // Cleared for the other two roles so switching a role can never leave
      // a stale job title behind.
      otherRoleDescription: role === "OTHER_STAFF" ? otherRoleDescription.trim() : null,
      mobile: mobile.trim() === "" ? null : mobile.trim(),
      joiningDate,
      isActive,
    };

    setIsSubmitting(true);
    const result = editing
      ? await updateAttendanceEmployeeAction(editing.id, input)
      : await createAttendanceEmployeeAction(input);
    setIsSubmitting(false);

    if (result.success) {
      toast.success(editing ? "Employee updated." : "Employee added.");
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
          <DialogTitle>{editing ? "Edit Employee" : "Add Employee"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Employee ID</Label>
              <Input
                value={editing?.employeeCode ?? "Auto-generated"}
                readOnly
                disabled
                className="font-mono text-neutral-500"
              />
              <p className="text-xs text-neutral-400">
                {editing ? "Employee IDs never change." : "Assigned automatically — 001, 002, 003..."}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Joining Date *</Label>
              <Input
                type="date"
                defaultValue={editing?.joiningDate ?? todayYMD()}
                aria-invalid={Boolean(errors.joiningDate) || undefined}
                onChange={(e) => {
                  setJoiningDate(e.target.value);
                  setErrors((prev) => ({ ...prev, joiningDate: undefined }));
                }}
                disabled={isSubmitting}
              />
              {errors.joiningDate && <p className="text-sm text-danger">{errors.joiningDate}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Employee Name *</Label>
            <Input
              defaultValue={editing?.name ?? ""}
              placeholder="e.g. Arun Kumar"
              aria-invalid={Boolean(errors.name) || undefined}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((prev) => ({ ...prev, name: undefined }));
              }}
              disabled={isSubmitting}
            />
            {errors.name && <p className="text-sm text-danger">{errors.name}</p>}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Role *</Label>
              <Select value={role} onValueChange={(value) => setRole(value as AttendanceRole)} disabled={isSubmitting}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ATTENDANCE_ROLES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {ATTENDANCE_ROLE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Status *</Label>
              <Select
                value={isActive ? "active" : "inactive"}
                onValueChange={(value) => setIsActive(value === "active")}
                disabled={isSubmitting}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Only asked for when it's actually needed — "Other Staff" is a
              bucket, not a job, so the roster needs to record which job. */}
          {role === "OTHER_STAFF" && (
            <div className="space-y-1.5">
              <Label>What do they do? *</Label>
              <Input
                defaultValue={editing?.otherRoleDescription ?? ""}
                placeholder="e.g. Watchman, Accountant, Cleaner"
                aria-invalid={Boolean(errors.otherRoleDescription) || undefined}
                onChange={(e) => {
                  setOtherRoleDescription(e.target.value);
                  setErrors((prev) => ({ ...prev, otherRoleDescription: undefined }));
                }}
                disabled={isSubmitting}
              />
              {errors.otherRoleDescription ? (
                <p className="text-sm text-danger">{errors.otherRoleDescription}</p>
              ) : (
                <p className="text-xs text-neutral-400">This is what shows in the Role column instead of &quot;Other Staff&quot;.</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Mobile Number</Label>
            <Input
              inputMode="numeric"
              defaultValue={editing?.mobile ?? ""}
              placeholder="10-digit number (optional)"
              aria-invalid={Boolean(errors.mobile) || undefined}
              onChange={(e) => {
                setMobile(e.target.value);
                setErrors((prev) => ({ ...prev, mobile: undefined }));
              }}
              disabled={isSubmitting}
            />
            {errors.mobile && <p className="text-sm text-danger">{errors.mobile}</p>}
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
