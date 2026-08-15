"use client";

import { useMemo, useState } from "react";
import { Gift, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useGlobalLoader } from "@/components/shared/global-loader";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { computeComboPricing, type ComboPricingComponent } from "@/services/combos/pricing";
import type { ComboComponentPricing, ComboComponentType, ComboInput } from "@/services/combos/schemas";
import type { ComboRow } from "@/services/combos/types";
import type { InventoryItemRow } from "@/services/inventory";
import type { GeneralServicePackageRow, SpecificServiceRow } from "@/services/service";
import { buildPickerIndex, searchCatalog, type PickerEntry } from "@/services/service/picker";

import { createComboAction, updateComboAction } from "@/app/(app)/service/actions";

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface ComponentDraft {
  key: string;
  componentType: ComboComponentType;
  refId: string;
  name: string;
  unitPrice: number | null;
  unitPurchasePrice: number | null;
  quantity: string;
  pricing: ComboComponentPricing;
}

/**
 * Build or edit a Combo Offer (plan §3.B).
 *
 * Contents are assembled with the same search-anything picker the Service job
 * form uses — type "water wash", press Enter, it's in — so there's one way to
 * find a catalog entry in this app rather than a bespoke picker per screen.
 *
 * The pricing panel is the point of this dialog. A combo is a discount by
 * construction, and pricing one below the cost of its own goods is an easy
 * slip that stays invisible on the Sales figure and only surfaces in the
 * Profit report weeks later. Showing list value, saving, cost and margin
 * while the admin types makes that mistake impossible to miss.
 */
export function ComboBuilderDialog({
  open,
  editing,
  packages,
  specificServices,
  items,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  editing: ComboRow | null;
  packages: GeneralServicePackageRow[];
  specificServices: SpecificServiceRow[];
  items: InventoryItemRow[];
  onOpenChange: (open: boolean) => void;
  onSaved: (combo: ComboRow) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [comboPrice, setComboPrice] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [components, setComponents] = useState<ComponentDraft[]>([]);
  const [term, setTerm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; comboPrice?: string; components?: string; validTo?: string; form?: string }>({});
  const { runWithLoader } = useGlobalLoader();

  // Keyed on the dialog's open+target so reopening always starts from the
  // right state without a useEffect syncing props into state.
  const formKey = `${open}-${editing?.id ?? "new"}`;
  const [lastKey, setLastKey] = useState(formKey);
  if (lastKey !== formKey) {
    setLastKey(formKey);
    setName(editing?.name ?? "");
    setDescription(editing?.description ?? "");
    setComboPrice(editing ? String(editing.comboPrice) : "");
    setValidFrom(editing?.validFrom ?? "");
    setValidTo(editing?.validTo ?? "");
    setComponents(
      (editing?.components ?? []).map((c) => ({
        key: newId(),
        componentType: c.componentType,
        refId: (c.generalServicePackageId ?? c.specificServiceId ?? c.inventoryItemId)!,
        name: c.name,
        unitPrice: c.unitPrice,
        unitPurchasePrice: c.unitPurchasePrice,
        quantity: String(c.quantity),
        pricing: c.pricing,
      }))
    );
    setTerm("");
    setErrors({});
  }

  // Combos aren't offered as components — nesting one inside another would
  // make "what does this price cover" unanswerable at a glance.
  const pickerEntries = useMemo(
    () => buildPickerIndex({ packages, specificServices, items }),
    [packages, specificServices, items]
  );
  const results = useMemo(() => searchCatalog(pickerEntries, term), [pickerEntries, term]);

  const pricingComponents: ComboPricingComponent[] = components.map((c) => ({
    componentType: c.componentType,
    quantity: Math.trunc(Number(c.quantity) || 0),
    pricing: c.pricing,
    unitPrice: c.unitPrice,
    unitPurchasePrice: c.unitPurchasePrice,
  }));
  const pricing = computeComboPricing(pricingComponents, Number(comboPrice) || 0);

  function addComponent(entry: PickerEntry) {
    const componentType: ComboComponentType = entry.kind === "ITEM" ? "ITEM" : entry.kind === "PACKAGE" ? "PACKAGE" : "SPECIFIC";

    setComponents((prev) => {
      const existing = prev.find((c) => c.componentType === componentType && c.refId === entry.id);
      if (existing) {
        return prev.map((c) => (c === existing ? { ...c, quantity: String(Math.trunc(Number(c.quantity) || 0) + 1) } : c));
      }
      return [
        ...prev,
        {
          key: newId(),
          componentType,
          refId: entry.id,
          name: entry.name,
          unitPrice: entry.rate,
          // Only inventory items carry a cost basis; a service has none.
          unitPurchasePrice: entry.kind === "ITEM" ? (items.find((i) => i.id === entry.id)?.purchasePrice ?? null) : null,
          quantity: "1",
          pricing: "INCLUDED",
        },
      ];
    });

    setTerm("");
    setErrors((prev) => ({ ...prev, components: undefined }));
  }

  function updateComponent(key: string, patch: Partial<ComponentDraft>) {
    setComponents((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  function removeComponent(key: string) {
    setComponents((prev) => prev.filter((c) => c.key !== key));
  }

  function validate(): boolean {
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Name is required.";
    if (comboPrice.trim() === "" || Number(comboPrice) < 0) next.comboPrice = "Enter a price of zero or more.";
    if (components.length === 0) next.components = "Add at least one service or part.";
    if (validFrom && validTo && validTo < validFrom) next.validTo = "The end date can't be before the start date.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;

    const input: ComboInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      comboPrice: Number(comboPrice) || 0,
      validFrom: validFrom || undefined,
      validTo: validTo || undefined,
      components: components.map((c) => ({
        componentType: c.componentType,
        generalServicePackageId: c.componentType === "PACKAGE" ? c.refId : undefined,
        specificServiceId: c.componentType === "SPECIFIC" ? c.refId : undefined,
        inventoryItemId: c.componentType === "ITEM" ? c.refId : undefined,
        quantity: Math.trunc(Number(c.quantity) || 1),
        pricing: c.pricing,
      })),
    };

    setIsSubmitting(true);
    const result = await runWithLoader(() => (editing ? updateComboAction(editing.id, input) : createComboAction(input)));
    setIsSubmitting(false);

    if (result.success) {
      toast.success(editing ? `${result.data.name} updated.` : `${result.data.name} created.`);
      onSaved(result.data);
      onOpenChange(false);
    } else {
      setErrors((prev) => ({ ...prev, form: result.error }));
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="size-4 text-primary" />
            {editing ? `Edit ${editing.name}` : "New Combo Offer"}
          </DialogTitle>
        </DialogHeader>

        <fieldset disabled={isSubmitting} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <div className="space-y-1.5">
              <Label>Offer Name *</Label>
              <Input
                placeholder="e.g. ₹7,499 Combo — Duke 390"
                value={name}
                aria-invalid={Boolean(errors.name) || undefined}
                onChange={(e) => {
                  setName(e.target.value);
                  setErrors((prev) => ({ ...prev, name: undefined }));
                }}
              />
              {errors.name && <p className="text-xs text-danger">{errors.name}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Combo Price *</Label>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-neutral-400">₹</span>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  className="pl-7"
                  value={comboPrice}
                  aria-invalid={Boolean(errors.comboPrice) || undefined}
                  onChange={(e) => {
                    setComboPrice(e.target.value);
                    setErrors((prev) => ({ ...prev, comboPrice: undefined }));
                  }}
                />
              </div>
              {errors.comboPrice && <p className="text-xs text-danger">{errors.comboPrice}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Description (optional)</Label>
            <Textarea placeholder="Shown on the catalog list, not on the invoice." value={description} rows={2} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-neutral-500">Offer starts (optional)</Label>
              <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-neutral-500">Offer ends (optional)</Label>
              <Input
                type="date"
                value={validTo}
                aria-invalid={Boolean(errors.validTo) || undefined}
                onChange={(e) => {
                  setValidTo(e.target.value);
                  setErrors((prev) => ({ ...prev, validTo: undefined }));
                }}
              />
              {errors.validTo && <p className="text-xs text-danger">{errors.validTo}</p>}
            </div>
          </div>

          {/* Contents */}
          <div className="space-y-2 rounded-[10px] border border-neutral-200 p-3">
            <Label className="text-sm font-semibold text-neutral-900">What&apos;s in the combo</Label>

            <div className="relative">
              <Input
                placeholder="Search a service, package or part, then press Enter"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (results[0]) addComponent(results[0]);
                  }
                }}
              />
              {term.trim().length > 0 && results.length > 0 && (
                <div className="absolute top-full left-0 z-50 mt-1 w-full rounded-[10px] border border-neutral-200 bg-white shadow-md">
                  <div className="max-h-56 overflow-y-auto p-1">
                    {results.map((entry) => (
                      <button
                        key={entry.key}
                        type="button"
                        onClick={() => addComponent(entry)}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-neutral-100"
                      >
                        <Plus className="size-3.5 shrink-0 text-neutral-400" />
                        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                        <span className="shrink-0 text-xs text-neutral-500">{entry.rate === null ? "—" : formatINR(entry.rate)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {components.length === 0 ? (
              <p className="rounded-[10px] border border-dashed border-neutral-200 px-4 py-5 text-center text-sm text-neutral-500">
                Nothing added yet — search above to build the bundle.
              </p>
            ) : (
              <div className="divide-y divide-neutral-100">
                {components.map((component) => (
                  <div key={component.key} className="grid grid-cols-[1fr_70px_130px_36px] items-center gap-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-neutral-900">{component.name}</p>
                      <p className="truncate text-[11px] text-neutral-400">
                        {component.componentType === "ITEM" ? "Part" : component.componentType === "PACKAGE" ? "General Service" : "Specific Service"}
                        {component.unitPrice !== null && ` · ${formatINR(component.unitPrice)} each`}
                      </p>
                    </div>

                    <Input
                      type="number"
                      min={1}
                      step="1"
                      aria-label={`Quantity of ${component.name}`}
                      className="h-9 text-center"
                      value={component.quantity}
                      onChange={(e) => updateComponent(component.key, { quantity: e.target.value })}
                    />

                    {/* Included vs Extra is the whole point of a combo, so it's
                        a visible two-way toggle rather than a buried select. */}
                    <div className="flex rounded-[8px] border border-neutral-200 p-0.5">
                      {(["INCLUDED", "EXTRA"] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => updateComponent(component.key, { pricing: option })}
                          className={cn(
                            "flex-1 rounded-[6px] px-2 py-1 text-[11px] font-medium transition-colors",
                            component.pricing === option ? "bg-primary text-white" : "text-neutral-500 hover:text-neutral-900"
                          )}
                        >
                          {option === "INCLUDED" ? "Included" : "Extra"}
                        </button>
                      ))}
                    </div>

                    <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Remove ${component.name}`} onClick={() => removeComponent(component.key)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {errors.components && <p className="text-xs text-danger">{errors.components}</p>}
          </div>

          {/* Pricing sanity check */}
          <div className="space-y-1.5 rounded-[10px] border border-neutral-200 bg-neutral-50 p-3 text-sm">
            <div className="flex justify-between text-neutral-600">
              <span>List value if bought separately</span>
              <span className="font-medium text-neutral-900">{formatINR(pricing.listValue)}</span>
            </div>
            <div className="flex justify-between text-neutral-600">
              <span>Combo price</span>
              <span className="font-medium text-neutral-900">{formatINR(pricing.comboPrice)}</span>
            </div>
            <div className="flex justify-between border-t border-neutral-200 pt-1.5 font-semibold text-success">
              <span>Customer saves</span>
              <span>
                {formatINR(pricing.savings)}
                {pricing.savingsPercent > 0 && <span className="ml-1 font-normal text-neutral-500">({pricing.savingsPercent}%)</span>}
              </span>
            </div>
            <div className="flex justify-between border-t border-neutral-200 pt-1.5 text-neutral-600">
              <span>Cost of goods included</span>
              <span className="font-medium text-neutral-900">{formatINR(pricing.cost)}</span>
            </div>
            <div className={cn("flex justify-between font-semibold", pricing.margin < 0 ? "text-danger" : "text-neutral-900")}>
              <span>Your margin</span>
              <span>{formatINR(pricing.margin)}</span>
            </div>

            {pricing.isBelowCost && (
              <p className="rounded-[8px] bg-danger-bg px-2.5 py-2 text-xs font-medium text-danger">
                This combo sells for less than the parts inside it cost you. Every one sold loses {formatINR(Math.abs(pricing.margin))}.
              </p>
            )}
            {pricing.isPricedAboveList && (
              <p className="rounded-[8px] bg-warning/10 px-2.5 py-2 text-xs font-medium text-warning">
                The combo costs more than buying these separately — the customer saves nothing.
              </p>
            )}
          </div>

          {errors.form && <p className="text-sm text-danger">{errors.form}</p>}
        </fieldset>

        <DialogFooter>
          <Button type="button" variant="secondary" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={isSubmitting} onClick={handleSubmit}>
            {isSubmitting ? "Saving..." : editing ? "Save Changes" : "Create Combo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
