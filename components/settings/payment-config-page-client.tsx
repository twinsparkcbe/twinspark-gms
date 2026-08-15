"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
// Leaf module, not the "@/services/payments" barrel — see the note in
// payment-config-form-dialog.tsx.
import type { PaymentQrConfigRow } from "@/services/payments/qr-config";

import { deletePaymentQrConfigAction, setActivePaymentQrConfigAction } from "@/app/(app)/settings/payment/actions";

import { ConfirmDeletePaymentConfigDialog } from "./confirm-delete-payment-config-dialog";
import { PaymentConfigFormDialog } from "./payment-config-form-dialog";
import { PaymentConfigTable } from "./payment-config-table";

/**
 * Settings / Payment (doc/payment-qr-config-scope.md) — Admin-only. No
 * pagination/filtering, same reasoning as Settings / Users: this app's
 * realistic scale is a handful of payment destinations per garage, not
 * hundreds of rows.
 */
export function PaymentConfigPageClient({ initialConfigs }: { initialConfigs: PaymentQrConfigRow[] }) {
  const [configs, setConfigs] = useState(initialConfigs);

  const [formDialog, setFormDialog] = useState<{ open: boolean; editing: PaymentQrConfigRow | null }>({
    open: false,
    editing: null,
  });
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; config: PaymentQrConfigRow | null }>({
    open: false,
    config: null,
  });

  function upsertConfig(config: PaymentQrConfigRow) {
    setConfigs((prev) => {
      // Activating one config deactivates every other row server-side
      // (set_active_payment_qr) — mirror that locally so only one Active
      // badge is ever showing without waiting on a full refetch.
      const withoutStaleActive = config.isActive ? prev.map((c) => ({ ...c, isActive: false })) : prev;
      const exists = withoutStaleActive.some((c) => c.id === config.id);
      return exists
        ? withoutStaleActive.map((c) => (c.id === config.id ? config : c))
        : [config, ...withoutStaleActive];
    });
  }

  async function handleSetActive(config: PaymentQrConfigRow) {
    const result = await setActivePaymentQrConfigAction(config.id);
    if (result.success) {
      upsertConfig(result.data);
      toast.success(`"${result.data.label}" is now the active payment config.`);
    } else {
      toast.error(result.error);
    }
  }

  async function handleDelete(config: PaymentQrConfigRow) {
    const result = await deletePaymentQrConfigAction(config.id);
    if (result.success) {
      setConfigs((prev) => prev.filter((c) => c.id !== config.id));
      toast.success("Payment config deleted.");
      return { success: true };
    }
    return { success: false, error: result.error };
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">Payment Settings</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Configure the QR + UPI ID shown to customers on the online order form.
          </p>
        </div>
        <Button type="button" className="rounded-[10px]" onClick={() => setFormDialog({ open: true, editing: null })}>
          <Plus className="size-4" />
          Add Payment Config
        </Button>
      </div>

      <div className="rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
        <PaymentConfigTable
          configs={configs}
          onEdit={(config) => setFormDialog({ open: true, editing: config })}
          onSetActive={handleSetActive}
          onDelete={(config) => setDeleteDialog({ open: true, config })}
        />
      </div>

      <PaymentConfigFormDialog
        open={formDialog.open}
        editing={formDialog.editing}
        onOpenChange={(open) => setFormDialog((prev) => ({ ...prev, open }))}
        onSaved={upsertConfig}
      />

      <ConfirmDeletePaymentConfigDialog
        open={deleteDialog.open}
        config={deleteDialog.config}
        onOpenChange={(open) => setDeleteDialog((prev) => ({ ...prev, open }))}
        onConfirm={handleDelete}
      />
    </div>
  );
}
