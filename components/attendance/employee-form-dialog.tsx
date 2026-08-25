"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { maskAmountInput, maskMobileInput } from "@/services/attendance/input-masks";
import { ATTENDANCE_ROLE_LABELS, ATTENDANCE_ROLES } from "@/services/attendance/schemas";
import type { AttendanceEmployeeRow } from "@/services/attendance/types";
import type { AttendanceRole } from "@/types/database.types";

import { createAttendanceEmployeeAction, updateAttendanceEmployeeAction } from "@/app/(app)/attendance/actions";

interface FormErrors {
  name?: string;
  dailyWage?: string;
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
 * Add/Edit Employee.
 *
 * The form body is a SEPARATE component, mounted under a `key` of the
 * employee's id. That structure is load-bearing, not styling: `useState`
 * initialisers run once per mount, so state held in this outer component
 * would survive being reopened for a different employee. The inputs would
 * then show the newly-opened employee (from their props) while the state
 * still held the previous one — and Save writes the state. Editing Bharath
 * after Arun silently saved Arun's name onto Bharath.
 *
 * Keying the component that OWNS the state is what fixes it: a different
 * employee is a different mount, so every field starts from that employee's
 * own values. The inputs are also fully controlled now, so the DOM and the
 * state can never disagree in the first place.
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Employee" : "Add Employee"}</DialogTitle>
        </DialogHeader>
        <EmployeeForm
          key={editing?.id ?? "new"}
          editing={editing}
          onCancel={() => onOpenChange(false)}
          onSaved={(employee) => {
            onSaved(employee);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function EmployeeForm({
  editing,
  onCancel,
  onSaved,
}: {
  editing: AttendanceEmployeeRow | null;
  onCancel: () => void;
  onSaved: (employee: AttendanceEmployeeRow) => void;
}) {
  // Safe to seed from props here precisely because this component is keyed
  // by employee id — a different employee remounts it.
  const [name, setName] = useState(editing?.name ?? "");
  const [role, setRole] = useState<AttendanceRole>(editing?.role ?? "SALES_PERSON");
  const [otherRoleDescription, setOtherRoleDescription] = useState(editing?.otherRoleDescription ?? "");
  const [dailyWage, setDailyWage] = useState(editing?.dailyWage != null ? String(editing.dailyWage) : "");
  const [mobile, setMobile] = useState(editing?.mobile ?? "");
  const [joiningDate, setJoiningDate] = useState(editing?.joiningDate ?? todayYMD());
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function clearError(field: keyof FormErrors) {
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  async function handleSubmit() {
    const nextErrors: FormErrors = {};
    if (!name.trim()) nextErrors.name = "Employee name is required.";
    if (!joiningDate) nextErrors.joiningDate = "Joining date is required.";
    // "Other Staff" on its own doesn't say who someone is — same rule the Zod
    // schema and the DB CHECK constraint both enforce.
    if (role === "OTHER_STAFF" && !otherRoleDescription.trim()) {
      nextErrors.otherRoleDescription = "Say what this person does — e.g. Watchman, Accountant, Cleaner.";
    }
    if (mobile.trim() && !/^[6-9]\d{9}$/.test(mobile.trim())) {
      nextErrors.mobile = "Enter a valid 10-digit mobile number.";
    }
    // Optional, but a rate that IS given has to be a real one. Zero is
    // rejected rather than stored: it would read as "earns nothing".
    if (dailyWage.trim() && !(Number(dailyWage) > 0)) {
      nextErrors.dailyWage = "Salary per day must be greater than 0.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const input = {
      name: name.trim(),
      role,
      // Cleared for the other two roles so switching a role can never leave
      // a stale job title behind.
      otherRoleDescription: role === "OTHER_STAFF" ? otherRoleDescription.trim() : null,
      dailyWage: dailyWage.trim() === "" ? null : Number(dailyWage),
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
    } else {
      setErrors({ form: result.error });
      toast.error(result.error);
    }
  }

  return (
    <>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Employee ID</Label>
            {/* readOnly rather than disabled: disabled dims it to 50% opacity,
                which made a real assigned code look like unfilled placeholder
                text. It also stays selectable, so the code can be copied. */}
            <Input
              readOnly
              value={editing?.employeeCode ?? "Auto-generated"}
              tabIndex={-1}
              className={cn(
                "cursor-default bg-neutral-50 font-mono",
                editing ? "font-bold text-neutral-700" : "text-neutral-400"
              )}
            />
            <p className="text-xs text-neutral-400">
              {editing ? "Employee IDs never change." : "Assigned automatically — 001, 002, 003..."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Joining Date *</Label>
            <Input
              type="date"
              value={joiningDate}
              aria-invalid={Boolean(errors.joiningDate) || undefined}
              onChange={(e) => {
                setJoiningDate(e.target.value);
                clearError("joiningDate");
              }}
              disabled={isSubmitting}
            />
            {errors.joiningDate && <p className="text-sm text-danger">{errors.joiningDate}</p>}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Employee Name *</Label>
          <Input
            value={name}
            maxLength={120}
            placeholder="e.g. Arun Kumar"
            aria-invalid={Boolean(errors.name) || undefined}
            onChange={(e) => {
              setName(e.target.value);
              clearError("name");
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
              value={otherRoleDescription}
              maxLength={60}
              placeholder="e.g. Watchman, Accountant, Cleaner"
              aria-invalid={Boolean(errors.otherRoleDescription) || undefined}
              onChange={(e) => {
                setOtherRoleDescription(e.target.value);
                clearError("otherRoleDescription");
              }}
              disabled={isSubmitting}
            />
            {errors.otherRoleDescription ? (
              <p className="text-sm text-danger">{errors.otherRoleDescription}</p>
            ) : (
              <p className="text-xs text-neutral-400">
                This is what shows in the Role column instead of &quot;Other Staff&quot;.
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Salary Per Day (&#8377;)</Label>
            <Input
              inputMode="decimal"
              value={dailyWage}
              placeholder="e.g. 600 (optional)"
              aria-invalid={Boolean(errors.dailyWage) || undefined}
              onChange={(e) => {
                setDailyWage(maskAmountInput(e.target.value));
                clearError("dailyWage");
              }}
              disabled={isSubmitting}
            />
            {errors.dailyWage ? (
              <p className="text-sm text-danger">{errors.dailyWage}</p>
            ) : (
              <p className="text-xs text-neutral-400">Half days pay 50%. Affects future attendance only.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Mobile Number</Label>
            <Input
              inputMode="numeric"
              autoComplete="tel"
              maxLength={10}
              value={mobile}
              placeholder="10-digit number (optional)"
              aria-invalid={Boolean(errors.mobile) || undefined}
              onChange={(e) => {
                // Masked as it is typed: letters never appear and the field
                // stops at ten digits, so a wrong keystroke is refused at the
                // moment it happens rather than at Save.
                setMobile(maskMobileInput(e.target.value));
                clearError("mobile");
              }}
              disabled={isSubmitting}
            />
            {errors.mobile && <p className="text-sm text-danger">{errors.mobile}</p>}
          </div>
        </div>

        {errors.form && <p className="text-sm text-danger">{errors.form}</p>}
      </div>

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}
