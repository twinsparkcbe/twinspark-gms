"use client";

import { useEffect, useState } from "react";
import { Gift, Package2, Plus, Wrench } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGlobalLoader } from "@/components/shared/global-loader";
import { formatDate, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { InventoryItemRow } from "@/services/inventory";
import { isComboAvailable } from "@/services/combos/availability";
import type { ComboRow } from "@/services/combos/types";
import type { GeneralServicePackageRow, SpecificServiceRow } from "@/services/service";

import {
  deleteComboAction,
  deleteGeneralServicePackageAction,
  deleteSpecificServiceAction,
  duplicateComboAction,
  setComboActiveAction,
  createGeneralServicePackageAction,
  createSpecificServiceAction,
  setGeneralServicePackageActiveAction,
  setSpecificServiceActiveAction,
  updateGeneralServicePackageAction,
  updateSpecificServiceAction,
} from "@/app/(app)/service/actions";

import { CatalogItemPicker, type CatalogItemDraft } from "./catalog-item-picker";
import { CatalogRowActions } from "./catalog-row-actions";
import { ComboBuilderDialog } from "./combo-builder-dialog";

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Manage Catalog (doc §3) — admin CRUD for Combo Offers, General Service
 * Packages and Specific Services, split across tabs because the admin only
 * ever manages one kind at a time and the stacked version made the page a
 * long scroll of half-relevant lists.
 *
 * Removal is two-tiered. Switching an entry off is the everyday action and
 * always works: it stops appearing on new jobs while past invoices keep
 * resolving (doc §16). Delete is for the mistake case only, and the server
 * refuses it for anything already used (0023_catalog_delete.sql) — so history
 * is protected by construction rather than by the UI being careful.
 */
export function CatalogPageClient({
  initialPackages,
  initialSpecificServices,
  initialCombos,
  items,
}: {
  initialPackages: GeneralServicePackageRow[];
  initialSpecificServices: SpecificServiceRow[];
  initialCombos: ComboRow[];
  items: InventoryItemRow[];
}) {
  const [packages, setPackages] = useState(initialPackages);
  const [specificServices, setSpecificServices] = useState(initialSpecificServices);
  const [combos, setCombos] = useState(initialCombos);
  const { runWithLoader } = useGlobalLoader();

  const [packageDialog, setPackageDialog] = useState<{ open: boolean; editing: GeneralServicePackageRow | null }>({ open: false, editing: null });
  const [specificDialog, setSpecificDialog] = useState<{ open: boolean; editing: SpecificServiceRow | null }>({ open: false, editing: null });
  const [comboDialog, setComboDialog] = useState<{ open: boolean; editing: ComboRow | null }>({ open: false, editing: null });

  async function toggleComboActive(combo: ComboRow) {
    const result = await runWithLoader(() => setComboActiveAction(combo.id, !combo.isActive));
    if (result.success) {
      setCombos((prev) => prev.map((c) => (c.id === combo.id ? result.data : c)));
      toast.success(result.data.isActive ? "Combo activated." : "Combo deactivated.");
    } else {
      toast.error(result.error);
    }
  }

  /** Pinning exact products means one combo per tyre fitment (plan §6.1), so
   * cloning is the difference between a two-field edit and a ten-line rebuild.
   * The copy arrives inactive — it still carries the donor's tyres. */
  async function handleDuplicate(combo: ComboRow) {
    const result = await runWithLoader(() => duplicateComboAction(combo.id, `${combo.name} (copy)`));
    if (result.success) {
      setCombos((prev) => [...prev, result.data].sort((a, b) => a.name.localeCompare(b.name)));
      setComboDialog({ open: true, editing: result.data });
      toast.success("Copy created — edit it and switch it on when it's ready.");
    } else {
      toast.error(result.error);
    }
  }

  function handleComboSaved(saved: ComboRow) {
    setCombos((prev) => {
      const exists = prev.some((c) => c.id === saved.id);
      const next = exists ? prev.map((c) => (c.id === saved.id ? saved : c)) : [...prev, saved];
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async function togglePackageActive(pkg: GeneralServicePackageRow) {
    const result = await runWithLoader(() => setGeneralServicePackageActiveAction(pkg.id, !pkg.isActive));
    if (result.success) {
      setPackages((prev) => prev.map((p) => (p.id === pkg.id ? result.data : p)));
      toast.success(result.data.isActive ? "Package activated." : "Package deactivated.");
    } else {
      toast.error(result.error);
    }
  }

  async function toggleSpecificActive(svc: SpecificServiceRow) {
    const result = await runWithLoader(() => setSpecificServiceActiveAction(svc.id, !svc.isActive));
    if (result.success) {
      setSpecificServices((prev) => prev.map((s) => (s.id === svc.id ? result.data : s)));
      toast.success(result.data.isActive ? "Service activated." : "Service deactivated.");
    } else {
      toast.error(result.error);
    }
  }

  /** The three deletes share a shape: on refusal the server's message names
   * the actual job/sale counts, so it's shown as-is rather than replaced with
   * something vaguer. */
  async function handleDeleteCombo(combo: ComboRow) {
    const result = await runWithLoader(() => deleteComboAction(combo.id));
    if (result.success) {
      setCombos((prev) => prev.filter((c) => c.id !== combo.id));
      toast.success(`${combo.name} deleted.`);
    } else {
      toast.error(result.error);
    }
  }

  async function handleDeletePackage(pkg: GeneralServicePackageRow) {
    const result = await runWithLoader(() => deleteGeneralServicePackageAction(pkg.id));
    if (result.success) {
      setPackages((prev) => prev.filter((p) => p.id !== pkg.id));
      toast.success(`${pkg.name} deleted.`);
    } else {
      toast.error(result.error);
    }
  }

  async function handleDeleteSpecific(svc: SpecificServiceRow) {
    const result = await runWithLoader(() => deleteSpecificServiceAction(svc.id));
    if (result.success) {
      setSpecificServices((prev) => prev.filter((s) => s.id !== svc.id));
      toast.success(`${svc.name} deleted.`);
    } else {
      toast.error(result.error);
    }
  }

  const counts = { combos: combos.length, packages: packages.length, services: specificServices.length };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        {/* Matches the sidebar label word-for-word, so the owner lands on the
            words they just clicked. "Catalog" only survives in the route. */}
        <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">Services &amp; Prices</h1>
        <p className="mt-1 text-sm text-neutral-500">
          What you offer and what you charge — everything the Service Job screen can add, and for combos, the Sales
          screen too.
        </p>
      </div>

      {/* Tabs rather than three stacked cards: the page used to be a long
          scroll of half-relevant lists, and the admin is only ever managing
          one kind of thing at a time. */}
      <Tabs defaultValue="combos" className="gap-4">
        <TabsList className="h-10 w-full sm:w-auto">
          <TabsTrigger value="combos" className="gap-2 px-4">
            <Gift className="size-4" />
            Combo Offers
            <CountBadge value={counts.combos} />
          </TabsTrigger>
          <TabsTrigger value="packages" className="gap-2 px-4">
            <Package2 className="size-4" />
            Packages
            <CountBadge value={counts.packages} />
          </TabsTrigger>
          <TabsTrigger value="services" className="gap-2 px-4">
            <Wrench className="size-4" />
            Services
            <CountBadge value={counts.services} />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="combos">
          <CatalogSection
            title="Combo Offers"
            hint="A fixed price covering several services and parts at once."
            addLabel="Add Combo"
            onAdd={() => setComboDialog({ open: true, editing: null })}
            isEmpty={combos.length === 0}
            emptyText="No combo offers yet. A combo bundles services and parts into one advertised price — like a tyres-plus-service deal."
          >
            {combos.map((combo) => {
              const available = isComboAvailable({ isActive: combo.isActive, validFrom: combo.validFrom, validTo: combo.validTo }, new Date());
              return (
                <CatalogRow
                  key={combo.id}
                  name={combo.name}
                  price={formatINR(combo.comboPrice)}
                  isActive={combo.isActive}
                  /* Switched on but out of window — without this it looks live
                     here while the job picker silently hides it. */
                  extraBadge={combo.isActive && !available ? "Outside offer dates" : null}
                  meta={combo.components.map((c) => (c.quantity > 1 ? `${c.name} ×${c.quantity}` : c.name))}
                  footnote={formatOfferWindow(combo.validFrom, combo.validTo)}
                  actions={
                    <CatalogRowActions
                      name={combo.name}
                      isActive={combo.isActive}
                      onEdit={() => setComboDialog({ open: true, editing: combo })}
                      onDuplicate={() => handleDuplicate(combo)}
                      onToggleActive={() => toggleComboActive(combo)}
                      onDelete={() => handleDeleteCombo(combo)}
                    />
                  }
                />
              );
            })}
          </CatalogSection>
        </TabsContent>

        <TabsContent value="packages">
          <CatalogSection
            title="General Service Packages"
            hint="One package per job. Linked parts are billed on top of the package charge."
            addLabel="Add Package"
            onAdd={() => setPackageDialog({ open: true, editing: null })}
            isEmpty={packages.length === 0}
            emptyText="No packages yet. A package is your standard service at a set charge."
          >
            {packages.map((pkg) => (
              <CatalogRow
                key={pkg.id}
                name={pkg.name}
                price={formatINR(pkg.serviceCharge)}
                isActive={pkg.isActive}
                description={pkg.includedItems.length > 0 ? pkg.includedItems.join(", ") : null}
                meta={pkg.defaultItems.map((i) => `${i.itemName} ×${i.defaultQuantity}`)}
                metaLabel="Auto-adds"
                actions={
                  <CatalogRowActions
                    name={pkg.name}
                    isActive={pkg.isActive}
                    onEdit={() => setPackageDialog({ open: true, editing: pkg })}
                    onToggleActive={() => togglePackageActive(pkg)}
                    onDelete={() => handleDeletePackage(pkg)}
                  />
                }
              />
            ))}
          </CatalogSection>
        </TabsContent>

        <TabsContent value="services">
          <CatalogSection
            title="Specific Services"
            hint="Individual jobs — water wash, chain cleaning, and so on."
            addLabel="Add Service"
            onAdd={() => setSpecificDialog({ open: true, editing: null })}
            isEmpty={specificServices.length === 0}
            emptyText="No specific services yet."
          >
            {specificServices.map((svc) => (
              <CatalogRow
                key={svc.id}
                name={svc.name}
                price={svc.defaultCharge !== null ? formatINR(svc.defaultCharge) : "No set price"}
                isActive={svc.isActive}
                meta={svc.defaultItems.map((i) => `${i.itemName} ×${i.defaultQuantity}`)}
                metaLabel="Auto-adds"
                actions={
                  <CatalogRowActions
                    name={svc.name}
                    isActive={svc.isActive}
                    onEdit={() => setSpecificDialog({ open: true, editing: svc })}
                    onToggleActive={() => toggleSpecificActive(svc)}
                    onDelete={() => handleDeleteSpecific(svc)}
                  />
                }
              />
            ))}
          </CatalogSection>
        </TabsContent>
      </Tabs>

      <ComboBuilderDialog
        open={comboDialog.open}
        editing={comboDialog.editing}
        packages={packages}
        specificServices={specificServices}
        items={items}
        onOpenChange={(open) => setComboDialog((prev) => ({ ...prev, open }))}
        onSaved={handleComboSaved}
      />
      <PackageDialog
        open={packageDialog.open}
        editing={packageDialog.editing}
        items={items}
        onOpenChange={(open) => setPackageDialog((prev) => ({ ...prev, open }))}
        onSaved={(pkg) => {
          setPackages((prev) => (prev.some((p) => p.id === pkg.id) ? prev.map((p) => (p.id === pkg.id ? pkg : p)) : [...prev, pkg].sort((a, b) => a.name.localeCompare(b.name))));
        }}
      />
      <SpecificServiceDialog
        open={specificDialog.open}
        editing={specificDialog.editing}
        items={items}
        onOpenChange={(open) => setSpecificDialog((prev) => ({ ...prev, open }))}
        onSaved={(svc) => {
          setSpecificServices((prev) => (prev.some((s) => s.id === svc.id) ? prev.map((s) => (s.id === svc.id ? svc : s)) : [...prev, svc].sort((a, b) => a.name.localeCompare(b.name))));
        }}
      />
    </div>
  );
}

function CountBadge({ value }: { value: number }) {
  return <span className="rounded-full bg-neutral-200/70 px-1.5 text-[11px] font-semibold text-neutral-600">{value}</span>;
}

/** "From 12 Aug until 13 Aug", or just one side, or nothing. */
function formatOfferWindow(validFrom: string | null, validTo: string | null): string | null {
  if (!validFrom && !validTo) return null;
  if (validFrom && validTo) return `Runs ${formatDate(validFrom)} – ${formatDate(validTo)}`;
  if (validFrom) return `Runs from ${formatDate(validFrom)}`;
  return `Runs until ${formatDate(validTo!)}`;
}

function CatalogSection({
  title,
  hint,
  addLabel,
  onAdd,
  isEmpty,
  emptyText,
  children,
}: {
  title: string;
  hint: string;
  addLabel: string;
  onAdd: () => void;
  isEmpty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[14px] border border-neutral-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-900">{title}</p>
          <p className="text-xs text-neutral-500">{hint}</p>
        </div>
        <Button type="button" size="sm" className="rounded-[10px]" onClick={onAdd}>
          <Plus className="size-4" />
          {addLabel}
        </Button>
      </div>

      {isEmpty ? (
        <p className="px-4 py-10 text-center text-sm text-neutral-500">{emptyText}</p>
      ) : (
        <div className="divide-y divide-neutral-100">{children}</div>
      )}
    </div>
  );
}

/**
 * One catalog row. Deliberately uniform across all three tabs: name and price
 * carry the weight, everything else is quiet. The old layout put a long
 * truncated blue "Auto-adds: …" string under every row, which dominated the
 * list while being the least important thing on it — those are chips now, and
 * they stop at three with a "+N more" rather than eating the row.
 */
function CatalogRow({
  name,
  price,
  isActive,
  extraBadge,
  description,
  meta,
  metaLabel,
  footnote,
  actions,
}: {
  name: string;
  price: string;
  isActive: boolean;
  extraBadge?: string | null;
  description?: string | null;
  meta?: string[];
  metaLabel?: string;
  footnote?: string | null;
  actions: React.ReactNode;
}) {
  const shown = (meta ?? []).slice(0, 3);
  const hidden = (meta ?? []).length - shown.length;

  return (
    <div className={cn("flex items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-neutral-50/70", !isActive && "opacity-60")}>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-semibold text-neutral-900">{name}</p>
          {!isActive && <Badge variant="neutral">Off</Badge>}
          {extraBadge && <Badge variant="warning">{extraBadge}</Badge>}
        </div>

        {description && <p className="truncate text-xs text-neutral-500">{description}</p>}

        {shown.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {metaLabel && <span className="mr-0.5 text-[11px] font-medium text-neutral-400">{metaLabel}</span>}
            {shown.map((entry, i) => (
              <span key={i} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600">
                {entry}
              </span>
            ))}
            {hidden > 0 && <span className="text-[11px] text-neutral-400">+{hidden} more</span>}
          </div>
        )}

        {footnote && <p className="text-[11px] text-neutral-400">{footnote}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span className="text-sm font-semibold whitespace-nowrap text-neutral-900">{price}</span>
        {actions}
      </div>
    </div>
  );
}

function PackageDialog({
  open,
  editing,
  items,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  editing: GeneralServicePackageRow | null;
  items: InventoryItemRow[];
  onOpenChange: (open: boolean) => void;
  onSaved: (pkg: GeneralServicePackageRow) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [includedItems, setIncludedItems] = useState(editing?.includedItems.join(", ") ?? "");
  const [serviceCharge, setServiceCharge] = useState(editing ? String(editing.serviceCharge) : "");
  const [defaultItemRows, setDefaultItemRows] = useState<CatalogItemDraft[]>(
    (editing?.defaultItems ?? []).map((i) => ({ id: newId(), inventoryItemId: i.inventoryItemId, defaultQuantity: String(i.defaultQuantity) }))
  );
  const [errors, setErrors] = useState<{ name?: string; serviceCharge?: string; form?: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * Re-seeded on every open, matching UserFormDialog and RecordPaymentDialog.
   * The useState initialisers above run once, on first mount, and this dialog
   * stays mounted for the life of the screen — so the second entry opened
   * showed the first one's charge and default items. Re-seeding on CLOSE
   * (what this did before) cannot work: at close time `editing` is still the
   * entry being closed, so it restored the very values that then leaked into
   * the next open. The key on DialogContent below looks like it covers this,
   * but the state lives here, above it, so a remount of the content never
   * touched it.
   */
  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setIncludedItems(editing?.includedItems.join(", ") ?? "");
    setServiceCharge(editing ? String(editing.serviceCharge) : "");
    setDefaultItemRows(
      (editing?.defaultItems ?? []).map((i) => ({ id: newId(), inventoryItemId: i.inventoryItemId, defaultQuantity: String(i.defaultQuantity) }))
    );
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  function addDefaultItem() {
    setDefaultItemRows((prev) => [...prev, { id: newId(), inventoryItemId: null, defaultQuantity: "1" }]);
  }
  function updateDefaultItem(id: string, patch: Partial<CatalogItemDraft>) {
    setDefaultItemRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeDefaultItem(id: string) {
    setDefaultItemRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleSubmit() {
    const nextErrors: typeof errors = {};
    if (!name.trim()) nextErrors.name = "Name is required.";
    if (serviceCharge.trim() === "" || Number(serviceCharge) < 0) nextErrors.serviceCharge = "Enter a valid service charge.";
    const validItemRows = defaultItemRows.filter((r) => r.inventoryItemId);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const input = {
      name: name.trim(),
      includedItems: includedItems
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      serviceCharge: Number(serviceCharge),
      defaultItems: validItemRows.map((r) => ({
        inventoryItemId: r.inventoryItemId as string,
        defaultQuantity: Math.max(1, Math.trunc(Number(r.defaultQuantity) || 1)),
      })),
    };

    setIsSubmitting(true);
    const result = editing ? await updateGeneralServicePackageAction(editing.id, input) : await createGeneralServicePackageAction(input);
    setIsSubmitting(false);

    if (result.success) {
      toast.success(editing ? "Package updated." : "Package created.");
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
        onOpenChange(next);
      }}
    >
      <DialogContent key={editing?.id ?? "new"} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Package" : "Add General Service Package"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input
              defaultValue={editing?.name ?? ""}
              placeholder="e.g. Standard General Service"
              aria-invalid={Boolean(errors.name) || undefined}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((prev) => ({ ...prev, name: undefined }));
              }}
              disabled={isSubmitting}
            />
            {errors.name && <p className="text-sm text-danger">{errors.name}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Included Items (comma-separated)</Label>
            <Input
              defaultValue={editing?.includedItems.join(", ") ?? ""}
              placeholder="e.g. Oil Change, Water Wash, Standard Inspection"
              onChange={(e) => setIncludedItems(e.target.value)}
              disabled={isSubmitting}
            />
          </div>
          <div className="max-w-40 space-y-1.5">
            <Label>Service Charge *</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              defaultValue={editing ? String(editing.serviceCharge) : ""}
              aria-invalid={Boolean(errors.serviceCharge) || undefined}
              onChange={(e) => {
                setServiceCharge(e.target.value);
                setErrors((prev) => ({ ...prev, serviceCharge: undefined }));
              }}
              disabled={isSubmitting}
            />
            {errors.serviceCharge && <p className="text-sm text-danger">{errors.serviceCharge}</p>}
          </div>
          <CatalogItemPicker items={items} rows={defaultItemRows} disabled={isSubmitting} onAdd={addDefaultItem} onUpdate={updateDefaultItem} onRemove={removeDefaultItem} />
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

function SpecificServiceDialog({
  open,
  editing,
  items,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  editing: SpecificServiceRow | null;
  items: InventoryItemRow[];
  onOpenChange: (open: boolean) => void;
  onSaved: (svc: SpecificServiceRow) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [defaultCharge, setDefaultCharge] = useState(editing?.defaultCharge !== null && editing?.defaultCharge !== undefined ? String(editing.defaultCharge) : "");
  const [defaultItemRows, setDefaultItemRows] = useState<CatalogItemDraft[]>(
    (editing?.defaultItems ?? []).map((i) => ({ id: newId(), inventoryItemId: i.inventoryItemId, defaultQuantity: String(i.defaultQuantity) }))
  );
  const [errors, setErrors] = useState<{ name?: string; defaultCharge?: string; form?: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * Re-seeded on every open, matching UserFormDialog and RecordPaymentDialog.
   * The useState initialisers above run once, on first mount, and this dialog
   * stays mounted for the life of the screen — so the second entry opened
   * showed the first one's charge and default items. Re-seeding on CLOSE
   * (what this did before) cannot work: at close time `editing` is still the
   * entry being closed, so it restored the very values that then leaked into
   * the next open. The key on DialogContent below looks like it covers this,
   * but the state lives here, above it, so a remount of the content never
   * touched it.
   */
  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setDefaultCharge(editing?.defaultCharge !== null && editing?.defaultCharge !== undefined ? String(editing.defaultCharge) : "");
    setDefaultItemRows(
      (editing?.defaultItems ?? []).map((i) => ({ id: newId(), inventoryItemId: i.inventoryItemId, defaultQuantity: String(i.defaultQuantity) }))
    );
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  function addDefaultItem() {
    setDefaultItemRows((prev) => [...prev, { id: newId(), inventoryItemId: null, defaultQuantity: "1" }]);
  }
  function updateDefaultItem(id: string, patch: Partial<CatalogItemDraft>) {
    setDefaultItemRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeDefaultItem(id: string) {
    setDefaultItemRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleSubmit() {
    const nextErrors: typeof errors = {};
    if (!name.trim()) nextErrors.name = "Name is required.";
    if (defaultCharge.trim() !== "" && Number(defaultCharge) < 0) nextErrors.defaultCharge = "Enter a valid amount.";
    const validItemRows = defaultItemRows.filter((r) => r.inventoryItemId);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const input = {
      name: name.trim(),
      defaultCharge: defaultCharge.trim() !== "" ? Number(defaultCharge) : undefined,
      defaultItems: validItemRows.map((r) => ({
        inventoryItemId: r.inventoryItemId as string,
        defaultQuantity: Math.max(1, Math.trunc(Number(r.defaultQuantity) || 1)),
      })),
    };

    setIsSubmitting(true);
    const result = editing ? await updateSpecificServiceAction(editing.id, input) : await createSpecificServiceAction(input);
    setIsSubmitting(false);

    if (result.success) {
      toast.success(editing ? "Service updated." : "Service created.");
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
        onOpenChange(next);
      }}
    >
      <DialogContent key={editing?.id ?? "new"} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Specific Service" : "Add Specific Service"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input
              defaultValue={editing?.name ?? ""}
              placeholder="e.g. Chain Cleaning"
              aria-invalid={Boolean(errors.name) || undefined}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((prev) => ({ ...prev, name: undefined }));
              }}
              disabled={isSubmitting}
            />
            {errors.name && <p className="text-sm text-danger">{errors.name}</p>}
          </div>
          <div className="max-w-40 space-y-1.5">
            <Label>Default Charge (optional)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              defaultValue={editing?.defaultCharge !== null && editing?.defaultCharge !== undefined ? String(editing.defaultCharge) : ""}
              placeholder="Typed fresh if blank"
              aria-invalid={Boolean(errors.defaultCharge) || undefined}
              onChange={(e) => {
                setDefaultCharge(e.target.value);
                setErrors((prev) => ({ ...prev, defaultCharge: undefined }));
              }}
              disabled={isSubmitting}
            />
            {errors.defaultCharge && <p className="text-sm text-danger">{errors.defaultCharge}</p>}
          </div>
          <CatalogItemPicker items={items} rows={defaultItemRows} disabled={isSubmitting} onAdd={addDefaultItem} onUpdate={updateDefaultItem} onRemove={removeDefaultItem} />
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
