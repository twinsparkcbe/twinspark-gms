"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PaymentDetailsCard } from "@/components/online-orders/payment-details-card";
// Imported directly from the leaf modules (not the "@/services/payments"
// barrel) — this is a Client Component, and the barrel also re-exports
// qr-config.ts, which is server-only. Same pattern the public order form
// uses for services/online-orders/schemas.
import { upiIdSchema } from "@/services/payments/schemas";
import type { PaymentQrConfigRow } from "@/services/payments/qr-config";

import {
  createPaymentQrConfigAction,
  updatePaymentQrConfigAction,
  uploadPaymentQrImageAction,
} from "@/app/(app)/settings/payment/actions";

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

interface FormErrors {
  label?: string;
  upiId?: string;
  payeeName?: string;
  qrImage?: string;
  form?: string;
}

/**
 * Add/Edit Payment Config — same one-dialog-for-both shape as UserFormDialog
 * (components/users/user-form-dialog.tsx). The live preview on the right
 * renders the exact PaymentDetailsCard the customer sees on /order (spec
 * §2's "shows a live preview of exactly what the customer will see") —
 * reusing the component, not a hand-copied mockup, so it can never drift.
 */
export function PaymentConfigFormDialog({
  open,
  editing,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  editing: PaymentQrConfigRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (config: PaymentQrConfigRow) => void;
}) {
  const [label, setLabel] = useState(editing?.label ?? "");
  const [upiId, setUpiId] = useState(editing?.upiId ?? "");
  const [payeeName, setPayeeName] = useState(editing?.payeeName ?? "");
  const [qrImageFile, setQrImageFile] = useState<File | null>(null);
  const [qrImagePreviewUrl, setQrImagePreviewUrl] = useState<string | null>(editing?.qrImageUrl ?? null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Revoke the object URL for any file the user picked, so switching files
  // (or closing the dialog) doesn't leak blob: URLs.
  useEffect(() => {
    return () => {
      if (qrImageFile && qrImagePreviewUrl) URL.revokeObjectURL(qrImagePreviewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup-only effect, re-running on every render would revoke the current preview
  }, []);

  /**
   * Re-seeded on every open, matching UserFormDialog and RecordPaymentDialog.
   *
   * The useState initialisers above run once, on first mount, and this dialog
   * stays mounted for the life of the settings screen — so the second config
   * opened showed the first one's UPI ID. Re-seeding on CLOSE (what this did
   * before) cannot fix it: at close time `editing` is still the config being
   * closed, so it restored exactly the values that leaked into the next open.
   */
  useEffect(() => {
    if (!open) return;
    setLabel(editing?.label ?? "");
    setUpiId(editing?.upiId ?? "");
    setPayeeName(editing?.payeeName ?? "");
    setQrImageFile(null);
    setQrImagePreviewUrl(editing?.qrImageUrl ?? null);
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setErrors((prev) => ({ ...prev, qrImage: "Only PNG, JPEG, or WEBP images are allowed." }));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setErrors((prev) => ({ ...prev, qrImage: "Image must be 5MB or smaller." }));
      return;
    }

    setQrImageFile(file);
    setQrImagePreviewUrl(URL.createObjectURL(file));
    setErrors((prev) => ({ ...prev, qrImage: undefined }));
  }

  async function handleSubmit() {
    const nextErrors: FormErrors = {};
    if (!label.trim()) nextErrors.label = "Label is required.";
    const upiResult = upiIdSchema.safeParse(upiId);
    if (!upiResult.success) nextErrors.upiId = upiResult.error.issues[0]?.message ?? "Enter a valid UPI ID.";
    if (!payeeName.trim()) nextErrors.payeeName = "Payee name is required.";
    if (!editing && !qrImageFile) nextErrors.qrImage = "Upload a QR image.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setIsSubmitting(true);

    let qrImagePath = editing?.qrImagePath ?? "";
    if (qrImageFile) {
      const formData = new FormData();
      formData.append("file", qrImageFile);
      const uploadResult = await uploadPaymentQrImageAction(formData);
      if (!uploadResult.success) {
        setIsSubmitting(false);
        setErrors({ form: uploadResult.error });
        return;
      }
      qrImagePath = uploadResult.data.path;
    }

    const input = { label: label.trim(), upiId: upiId.trim(), payeeName: payeeName.trim(), qrImagePath };
    const result = editing
      ? await updatePaymentQrConfigAction(editing.id, input)
      : await createPaymentQrConfigAction(input);
    setIsSubmitting(false);

    if (result.success) {
      toast.success(editing ? "Payment config updated." : "Payment config created.");
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
      }}
    >
      <DialogContent key={editing?.id ?? "new"} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Payment Config" : "Add Payment Config"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Label *</Label>
              <Input
                value={label}
                placeholder="e.g. Twinspark GPay"
                aria-invalid={Boolean(errors.label) || undefined}
                onChange={(e) => {
                  setLabel(e.target.value);
                  setErrors((prev) => ({ ...prev, label: undefined }));
                }}
                disabled={isSubmitting}
              />
              {errors.label && <p className="text-sm text-danger">{errors.label}</p>}
              <p className="text-xs text-neutral-400">Internal only — not shown to customers.</p>
            </div>

            <div className="space-y-1.5">
              <Label>UPI ID *</Label>
              <Input
                value={upiId}
                placeholder="name@bank"
                aria-invalid={Boolean(errors.upiId) || undefined}
                onChange={(e) => {
                  setUpiId(e.target.value);
                  setErrors((prev) => ({ ...prev, upiId: undefined }));
                }}
                disabled={isSubmitting}
              />
              {errors.upiId && <p className="text-sm text-danger">{errors.upiId}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Payee Name *</Label>
              <Input
                value={payeeName}
                placeholder="e.g. Twinspark Tyres And Bike Garage"
                aria-invalid={Boolean(errors.payeeName) || undefined}
                onChange={(e) => {
                  setPayeeName(e.target.value);
                  setErrors((prev) => ({ ...prev, payeeName: undefined }));
                }}
                disabled={isSubmitting}
              />
              {errors.payeeName && <p className="text-sm text-danger">{errors.payeeName}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>QR Image {!editing && "*"}</Label>
              <Input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} disabled={isSubmitting} />
              {errors.qrImage && <p className="text-sm text-danger">{errors.qrImage}</p>}
              <p className="text-xs text-neutral-400">
                {editing ? "Leave blank to keep the current QR image." : "The client's actual GPay/PhonePe merchant QR — PNG, JPEG, or WEBP, up to 5MB."}
              </p>
            </div>

            {errors.form && <p className="text-sm text-danger">{errors.form}</p>}
          </div>

          <div className="space-y-1.5">
            <Label className="text-neutral-500">What the customer sees on /order</Label>
            <PaymentDetailsCard
              upiId={upiId.trim() || "your-upi-id@bank"}
              payeeName={payeeName.trim() || "Payee Name"}
              qrImageUrl={qrImagePreviewUrl}
            />
          </div>
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
