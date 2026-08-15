"use client";

import { useState } from "react";
import { Copy, Pencil, Power, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * The trailing action cluster on every Manage Catalog row — one component so
 * packages, services and combos behave identically rather than each screen
 * arranging its own icons.
 *
 * Delete carries a confirmation step because it's the one irreversible action
 * here. It's also frequently *refused*: the server only allows deleting an
 * entry nothing references (0023_catalog_delete.sql), so the dialog says up
 * front that anything already used has to be switched off instead. That's
 * cheaper than letting the admin click through and hit an error.
 */
export function CatalogRowActions({
  name,
  isActive,
  disabled,
  onEdit,
  onDuplicate,
  onToggleActive,
  onDelete,
}: {
  name: string;
  isActive: boolean;
  disabled?: boolean;
  onEdit: () => void;
  /** Combos only — omitted elsewhere. */
  onDuplicate?: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <div className="flex shrink-0 items-center gap-0.5">
        {onDuplicate && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-neutral-400 hover:text-neutral-900"
            aria-label={`Duplicate ${name}`}
            title="Duplicate"
            disabled={disabled}
            onClick={onDuplicate}
          >
            <Copy className="size-4" />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-neutral-400 hover:text-neutral-900"
          aria-label={`Edit ${name}`}
          title="Edit"
          disabled={disabled}
          onClick={onEdit}
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-neutral-400 hover:text-neutral-900"
          aria-label={isActive ? `Switch off ${name}` : `Switch on ${name}`}
          title={isActive ? "Switch off" : "Switch on"}
          disabled={disabled}
          onClick={onToggleActive}
        >
          <Power className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-neutral-400 hover:bg-danger-bg hover:text-danger"
          aria-label={`Delete ${name}`}
          title="Delete"
          disabled={disabled}
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {name}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-neutral-600">
            <p>This permanently removes it from the catalog. It can&apos;t be undone.</p>
            <p className="rounded-[10px] bg-neutral-50 px-3 py-2 text-xs">
              If it&apos;s already been used on a job or a sale, the delete will be refused — switch it off instead, so past invoices keep working while
              it stops appearing on new ones.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-danger hover:bg-danger/90"
              onClick={() => {
                setConfirmOpen(false);
                onDelete();
              }}
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
