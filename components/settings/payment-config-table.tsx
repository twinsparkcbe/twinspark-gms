"use client";

import { CreditCard, Pencil, Trash2, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
// Leaf module, not the "@/services/payments" barrel — see the note in
// payment-config-form-dialog.tsx.
import type { PaymentQrConfigRow } from "@/services/payments/qr-config";

// Label | UPI ID | Payee | Status | Created | Actions
const ROW_GRID_CLASS = "grid grid-cols-[minmax(140px,200px)_minmax(160px,220px)_minmax(140px,200px)_100px_120px_160px] gap-3";

export function PaymentConfigTable({
  configs,
  onEdit,
  onSetActive,
  onDelete,
}: {
  configs: PaymentQrConfigRow[];
  onEdit: (config: PaymentQrConfigRow) => void;
  onSetActive: (config: PaymentQrConfigRow) => void;
  onDelete: (config: PaymentQrConfigRow) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div role="table" aria-label="Payment configs" className="min-w-[900px]">
        <div role="row" className={cn(ROW_GRID_CLASS, "px-4 py-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase")}>
          <span>Label</span>
          <span>UPI ID</span>
          <span>Payee Name</span>
          <span>Status</span>
          <span>Created</span>
          <span className="text-right">Actions</span>
        </div>

        <div className="flex flex-col gap-2">
          {configs.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <CreditCard className="size-10 text-neutral-300" />
              <p className="text-sm font-medium text-neutral-700">No payment configs yet</p>
              <p className="text-sm text-neutral-500">Add a QR + UPI ID so customers know where to pay on /order.</p>
            </div>
          )}

          {configs.map((config) => (
            <div
              key={config.id}
              role="row"
              className={cn(ROW_GRID_CLASS, "items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-neutral-50")}
            >
              <div role="cell" aria-label="Label" className="min-w-0 truncate font-semibold text-neutral-900" title={config.label}>
                {config.label}
              </div>

              <div role="cell" aria-label="UPI ID" className="min-w-0 truncate font-mono text-[13px] text-neutral-600">
                {config.upiId}
              </div>

              <div role="cell" aria-label="Payee Name" className="min-w-0 truncate text-sm text-neutral-700" title={config.payeeName}>
                {config.payeeName}
              </div>

              <div role="cell" aria-label="Status" className="min-w-0">
                <Badge variant={config.isActive ? "success" : "neutral"}>{config.isActive ? "Active" : "Inactive"}</Badge>
              </div>

              <div role="cell" aria-label="Created" className="min-w-0 text-sm text-neutral-500">
                {formatDate(config.createdAt)}
              </div>

              <div role="cell" aria-label="Actions" className="flex justify-end gap-1">
                {!config.isActive && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Set active"
                    title="Set Active"
                    className="size-9 rounded-[10px] text-neutral-500 hover:text-success"
                    onClick={() => onSetActive(config)}
                  >
                    <Zap className="size-4" />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Edit payment config"
                  title="Edit"
                  className="size-9 rounded-[10px] text-neutral-500 hover:text-neutral-900"
                  onClick={() => onEdit(config)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Delete payment config"
                  title={config.isActive ? "The active config can't be deleted — set another one active first" : "Delete"}
                  disabled={config.isActive}
                  className="size-9 rounded-[10px] text-danger hover:text-danger"
                  onClick={() => onDelete(config)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
