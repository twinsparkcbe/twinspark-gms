"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  AlertTriangle,
  Bike,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  FileText,
  IndianRupee,
  Percent,
  StickyNote,
  UserCog,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useGlobalLoader } from "@/components/shared/global-loader";
import { PaymentCapture } from "@/components/shared/payment-capture";
import { formatINR, fromISTDateInput, toISTDateInput } from "@/lib/format";
import type { InventoryItemRow } from "@/services/inventory";
import type { CustomerRow } from "@/services/sales";
import type { MechanicOption } from "@/services/users";
import { MOBILE_NUMBER_ERROR, isValidMobileNumber } from "@/services/shared/mobile";
import type {
  CatalogDefaultItemRow,
  GeneralServicePackageRow,
  LastServiceSummary,
  ServiceJobInput,
  ServiceJobRow,
  SpecificServiceRow,
  VehicleRow,
} from "@/services/service";
import { resolveCombo } from "@/services/combos/resolve";
import type { ComboRow } from "@/services/combos/types";
import { mergeDefaultItemsIntoParts } from "@/services/service/parts-merge";
import { buildPickerIndex, type PickerResolution, type UsageCounts } from "@/services/service/picker";
import { computeServiceJobTotals } from "@/services/service/totals";
import {
  draftFromPayment,
  draftToPaymentInput,
  initialPaymentDraft,
  recalcForTotal,
  validatePayment,
  type PaymentDraft,
  type PaymentErrors,
} from "@/services/shared/payment";

import {
  createServiceJobAction,
  editCompletedServiceJobAction,
  fetchLastCompletedServiceForVehicleAction,
  findActiveServiceJobsForVehicleAction,
  saveAndCompleteServiceJobAction,
  updateServiceJobAction,
} from "@/app/(app)/service/actions";

import { CustomerVehicleField } from "./customer-vehicle-field";
import { MechanicSelect, UNASSIGNED_VALUE } from "./mechanic-select";
import { LastServiceHint } from "./last-service-hint";
import { PendingJobBanner } from "./pending-job-banner";
import { ServiceLinePicker } from "./service-line-picker";
import { ServiceJobLines, type ServiceLineDraft, type ServiceLineErrors } from "./service-job-lines";
import { ServicePartsUsed, type PartUsedDraft, type PartUsedErrors } from "./service-parts-used";

import { findStockShortfalls, stockShortfallMessage } from "@/services/service/stock-check";

const COMMON_COMPLAINTS = ["Engine Noise", "Brake Issue", "Starting Problem", "Mileage Drop", "Chain Noise"];

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ServiceJobFormClient({
  existingJob,
  customers,
  vehicles,
  items,
  packages,
  specificServices,
  combos = [],
  usageCounts,
  mechanics = [],
  canRecordPayment,
  defaultAssignedMechanicId,
  defaultExpectedDeliveryDate,
}: {
  /** Present on the Edit route — pre-fills every field from the job being edited. */
  existingJob?: ServiceJobRow;
  customers: CustomerRow[];
  vehicles: VehicleRow[];
  items: InventoryItemRow[];
  packages: GeneralServicePackageRow[];
  specificServices: SpecificServiceRow[];
  /** Combo Offers sellable right now — they appear in the same picker. */
  combos?: ComboRow[];
  /** How often each catalog entry has actually been billed — ranks search
   * results and fills the quick-add chips (rework plan Change 1). */
  usageCounts?: UsageCounts;
  /** Active Mechanics for the assignment picker (doc/mechanic-role-scope.md §5). */
  mechanics?: MechanicOption[];
  /**
   * Whether this user may stamp the tender on a job — canSetServicePaymentStatus(),
   * Administrator-only today.
   *
   * Required, not defaulted, so a new page cannot forget it and silently get
   * the old behaviour back. That behaviour was: show a Mechanic the Cash/UPI
   * picker, let them choose, complete the job — creating the invoice and
   * deducting the stock — and only THEN call the admin-only
   * update_service_payment_status(), which refuses. The job was already
   * billed, but the screen said "Only Administrators can update payment
   * status", so it read as a total failure and the natural response was to
   * press the button again, which made a second job.
   */
  canRecordPayment: boolean;
  /** Pre-selects the signed-in Mechanic on a new job — they are almost
   * always assigning themselves. Ignored when editing an existing job. */
  defaultAssignedMechanicId?: string;
  /** Today in IST as "YYYY-MM-DD", resolved on the server. Pre-fills
   * Expected Delivery on a new job; ignored when editing. */
  defaultExpectedDeliveryDate?: string;
}) {
  const router = useRouter();
  const isEdit = Boolean(existingJob);
  /**
   * Correcting an already-billed job (doc/service-edit-undo-scope.md §2). Same
   * form, three differences: the save goes through
   * edit_completed_service_job() so the invoice number survives, the tender is
   * pre-filled from what was actually collected rather than starting blank,
   * and there is no "complete this" action because the job is already
   * complete. The route guard has already established the viewer is an admin.
   */
  const isCompletedEdit = existingJob?.status === "COMPLETED";

  const [customerName, setCustomerName] = useState(existingJob?.customerName ?? "");
  const [customerMobile, setCustomerMobile] = useState(existingJob?.customerMobile ?? "");
  const [customerAddress, setCustomerAddress] = useState(existingJob?.customerAddress ?? "");
  const [vehicleNumber, setVehicleNumber] = useState(existingJob?.vehicleNumber ?? "");
  const [vehicleModel, setVehicleModel] = useState(existingJob?.vehicleModel ?? "");
  const [odometerReading, setOdometerReading] = useState(existingJob ? String(existingJob.odometerReading) : "");
  const [complaintNotes, setComplaintNotes] = useState(existingJob?.complaintNotes ?? "");
  const [mechanicNotes, setMechanicNotes] = useState(existingJob?.mechanicNotes ?? "");
  // Date only (no time) — and on a new job it starts on today, since a
  // walk-in is almost always promised back the same day. Today's date is
  // computed on the server and passed in, never `new Date()` in this render
  // body, so SSR and hydration can't disagree about the date.
  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState(
    existingJob ? toISTDateInput(existingJob.expectedDeliveryAt) : (defaultExpectedDeliveryDate ?? "")
  );
  const [assignedMechanicId, setAssignedMechanicId] = useState(
    existingJob ? (existingJob.assignedMechanicId ?? UNASSIGNED_VALUE) : (defaultAssignedMechanicId ?? UNASSIGNED_VALUE)
  );
  // Opens on its own when the job already carries either field, so editing
  // never buries something that was previously filled in.
  const [showMoreDetails, setShowMoreDetails] = useState(Boolean(existingJob?.mechanicNotes?.trim()) || Boolean(existingJob?.expectedDeliveryAt));
  const [gstApplicable, setGstApplicable] = useState(existingJob?.gstApplicable ?? false);
  const [gstPercent, setGstPercent] = useState("18");
  const [discountApplicable, setDiscountApplicable] = useState(existingJob?.discountApplicable ?? false);
  const [discountAmount, setDiscountAmount] = useState(existingJob?.discountAmount ? String(existingJob.discountAmount) : "");
  // Payment status is locked until a job is Completed (doc §11), so this is
  // captured here and applied immediately after completion in the same action.
  // Deliberately a yes/no rather than the full four-way status: at the counter
  // the bill is either settled or it isn't. Partial and Free Service are real
  // but rare, and stay available on the job detail screen.
  // Same default as the old pre-ticked "Customer has paid" box.
  // On a correction the money is already in the till, so the fields start from
  // what was recorded — starting blank would read as "nothing collected" and
  // silently wipe the tender on save.
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft>(() =>
    existingJob && existingJob.status === "COMPLETED"
      ? draftFromPayment(
          {
            mode: existingJob.paymentMode,
            cashAmount: existingJob.cashAmount,
            upiAmount: existingJob.upiAmount,
            freeService: existingJob.paymentStatus === "FREE_SERVICE",
          },
          existingJob.grandTotal
        )
      : initialPaymentDraft(0)
  );
  const [paymentErrors, setPaymentErrors] = useState<PaymentErrors>({});
  // Handover is a separate fact from payment — a bill is often settled while
  // the bike is still on the ramp. Left off by default so completing a job
  // never claims a vehicle went out that's still in the shop; ticking it here
  // saves the extra trip to the job detail screen when the customer is
  // standing at the counter collecting the bike.
  const [vehicleDelivered, setVehicleDelivered] = useState(false);

  const [lines, setLines] = useState<ServiceLineDraft[]>(
    (existingJob?.lines ?? []).map((l) => ({
      id: newId(),
      lineType: l.lineType,
      generalServicePackageId: l.generalServicePackageId,
      specificServiceId: l.specificServiceId,
      comboId: l.comboId,
      comboContents: l.comboContents,
      description: l.description,
      quantity: String(l.quantity),
      rate: String(l.rate),
    })),
  );
  const [parts, setParts] = useState<PartUsedDraft[]>(
    (existingJob?.usage ?? []).map((u) => ({
      id: newId(),
      inventoryItemId: u.inventoryItemId,
      quantityUsed: String(u.quantityUsed),
      // Seeded with what the job actually charged, not today's catalogue
      // price — reopening a job must show the bill as it stands, or a
      // negotiated part silently reverts to list on the next save. A part
      // carried in by a combo bills at ₹0 and has no editable price, so it
      // seeds blank.
      unitPrice: u.includedInCombo ? "" : String(u.unitPrice),
      comboId: u.comboId,
      includedInCombo: u.includedInCombo,
    })),
  );

  /**
   * Parts on this job that the shelf can't cover. Recomputed on every render
   * so the warning appears the moment a part is added or its quantity raised,
   * rather than only when the counter presses the button.
   *
   * Correcting a completed job credits back what that job already holds:
   * edit_completed_service_job() restores its original parts before
   * re-deducting the corrected list, so leaving the parts alone must not be
   * refused just because Inventory now reads zero.
   */
  const stockShortfalls = findStockShortfalls({
    parts: parts.map((p) => ({
      inventoryItemId: p.inventoryItemId,
      quantityUsed: Math.trunc(Number(p.quantityUsed) || 0),
    })),
    items,
    alreadyDeducted: isCompletedEdit
      ? (existingJob?.usage ?? []).map((u) => ({
          inventoryItemId: u.inventoryItemId,
          quantityUsed: u.quantityUsed,
        }))
      : undefined,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  /**
   * Why a ref and not the isSubmitting state above.
   *
   * Two duplicate-job routes were open here, and this closes both.
   *
   * 1. React state does not change until a re-render. Two clicks landing in
   *    the same frame BOTH read isSubmitting === false, and both submit. A
   *    ref flips synchronously, so the second click sees the lock the first
   *    one set.
   *
   * 2. The bigger one: isSubmitting used to be cleared BEFORE
   *    router.push(). Navigation is async — it fetches the destination
   *    route — so on a slow connection the form stayed on screen with the
   *    button live again for a second or more after a successful save. Staff
   *    saw nothing happen and pressed again, creating a second job. On
   *    success the lock is now deliberately never released: the form stays
   *    disabled until the next page replaces it.
   */
  const submitLock = useRef(false);
  const [errors, setErrors] = useState<{
    customerName?: string;
    customerMobile?: string;
    vehicleNumber?: string;
    vehicleModel?: string;
    odometerReading?: string;
    gstPercent?: string;
    discountAmount?: string;
    form?: string;
  }>({});
  const [lineErrors, setLineErrors] = useState<ServiceLineErrors>({});
  const [partErrors, setPartErrors] = useState<PartUsedErrors>({});
  const [pendingJobs, setPendingJobs] = useState<ServiceJobRow[]>([]);
  const [lastService, setLastService] = useState<LastServiceSummary | null>(null);
  const { runWithLoader } = useGlobalLoader();

  function updateLine(id: string, patch: Partial<ServiceLineDraft>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    setLineErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev, [id]: { ...prev[id] } };
      for (const key of Object.keys(patch)) delete next[id][key];
      return next;
    });
  }

  function removeLine(id: string) {
    setLines((prev) => prev.filter((l) => l.id !== id));
    setLineErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function updatePart(id: string, patch: Partial<PartUsedDraft>) {
    setParts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setPartErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev, [id]: { ...prev[id] } };
      for (const key of Object.keys(patch)) delete next[id][key];
      return next;
    });
  }

  function removePart(id: string) {
    setParts((prev) => prev.filter((p) => p.id !== id));
    setPartErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function applyDefaultItems(defaultItems: CatalogDefaultItemRow[]) {
    setParts((prev) => mergeDefaultItemsIntoParts(prev, defaultItems, newId));
  }

  const hasPackageLine = lines.some((line) => line.lineType === "PACKAGE");

  /** Everything the picker can offer, in one index (rework plan Change 1). */
  const pickerEntries = useMemo(
    () => buildPickerIndex({ packages, specificServices, items, combos, usageCounts }),
    [packages, specificServices, items, combos, usageCounts],
  );

  /**
   * Single landing point for whatever the admin picked or typed. The picker
   * has already worked out *what* it is; this just files it in the right
   * list — which is the classification step the admin used to do by hand.
   */
  function handlePicked(resolution: PickerResolution) {
    if (!resolution.ok) {
      toast.error(resolution.reason);
      return;
    }

    if (resolution.target === "PART") {
      setParts((prev) => {
        // Same item picked twice stacks, matching the default-items merge —
        // two rows for one part would just have to be reconciled at billing.
        const existingIndex = prev.findIndex((p) => p.inventoryItemId === resolution.part.inventoryItemId && !p.includedInCombo);
        if (existingIndex >= 0) {
          const existing = prev[existingIndex];
          const next = [...prev];
          next[existingIndex] = {
            ...existing,
            quantityUsed: String(Math.trunc(Number(existing.quantityUsed) || 0) + 1),
          };
          return next;
        }
        return [...prev, { id: newId(), comboId: null, includedInCombo: false, ...resolution.part }];
      });
      return;
    }

    if (resolution.target === "COMBO") {
      addCombo(resolution.combo);
      return;
    }

    setLines((prev) => [...prev, { id: newId(), ...resolution.line }]);
    if (resolution.defaultItems.length > 0) applyDefaultItems(resolution.defaultItems);
  }

  /**
   * Expands a combo into the rows the job stores: one priced line plus a
   * stock row per included part at ₹0. Combo-sourced parts are kept as their
   * own rows rather than merged into any existing part of the same item —
   * merging would blur which units were given away with the offer and which
   * were billed, and the invoice has to keep them apart.
   */
  function addCombo(combo: ComboRow) {
    const result = resolveCombo(combo, { quantity: 1, now: new Date() });
    if (!result.ok) {
      toast.error(result.reason);
      return;
    }

    const { charges, parts: comboParts, contents } = result.resolution;

    setLines((prev) => [
      ...prev,
      ...charges.map((charge) => ({
        id: newId(),
        lineType: charge.source === "COMBO" ? ("COMBO" as const) : charge.source === "EXTRA_PACKAGE" ? ("PACKAGE" as const) : ("SPECIFIC" as const),
        generalServicePackageId: charge.generalServicePackageId,
        specificServiceId: charge.specificServiceId,
        comboId: charge.source === "COMBO" ? charge.comboId : null,
        comboContents: charge.source === "COMBO" ? contents.map((c) => (c.quantity > 1 ? `${c.label} ×${c.quantity}` : c.label)) : [],
        description: charge.description,
        quantity: String(charge.quantity),
        rate: String(charge.rate),
      })),
    ]);

    setParts((prev) => [
      ...prev,
      ...comboParts.map((part) => ({
        id: newId(),
        inventoryItemId: part.inventoryItemId,
        quantityUsed: String(part.quantity),
        unitPrice: "",
        comboId: part.comboId,
        includedInCombo: part.includedInCombo,
      })),
    ]);
  }

  async function handleVehicleSelected(vehicle: VehicleRow) {
    if (isEdit && vehicle.id === existingJob?.vehicleId) return; // same job, nothing pending against itself
    const [pendingResult, lastServiceResult] = await Promise.all([
      findActiveServiceJobsForVehicleAction(vehicle.id),
      fetchLastCompletedServiceForVehicleAction(vehicle.id),
    ]);
    if (pendingResult.success) {
      const others = isEdit ? pendingResult.data.filter((j) => j.id !== existingJob?.id) : pendingResult.data;
      setPendingJobs(others);
    }
    setLastService(lastServiceResult.success ? lastServiceResult.data : null);
  }

  const priceLookup = useMemo(() => {
    const map = new Map(items.map((item) => [item.id, item.sellingPrice]));
    return { sellingPriceOf: (id: string) => map.get(id) };
  }, [items]);

  const {
    subtotal,
    partsTotal: inventoryTotal,
    gstAmount: gstNum,
    discountAmount: discountNum,
    grandTotal,
  } = computeServiceJobTotals({
    lines,
    parts,
    prices: priceLookup,
    gstApplicable,
    gstPercent,
    discountApplicable,
    discountAmount,
  });

  const gstPercentNum = Number(gstPercent) || 0;

  // Keeps the payment amounts pinned to the running total, so adding a part
  // after choosing payment can't leave the old figure recorded. Manual Split
  // entries survive; only derived amounts move (see recalcForTotal).
  useEffect(() => {
    setPaymentDraft((prev) => recalcForTotal(prev, grandTotal));
  }, [grandTotal]);

  function validate(): boolean {
    const next: typeof errors = {};
    const nextLineErrors: ServiceLineErrors = {};
    const nextPartErrors: PartUsedErrors = {};

    if (!customerName.trim()) next.customerName = "Customer name is required.";
    if (!isValidMobileNumber(customerMobile)) next.customerMobile = MOBILE_NUMBER_ERROR;
    if (!vehicleNumber.trim()) next.vehicleNumber = "Vehicle number is required.";
    if (!vehicleModel.trim()) next.vehicleModel = "Vehicle model is required.";
    if (odometerReading.trim() === "" || Number(odometerReading) < 0) next.odometerReading = "Enter a valid odometer reading.";

    if (gstApplicable && (gstPercent.trim() === "" || Number(gstPercent) < 0 || Number(gstPercent) > 100)) {
      next.gstPercent = "Enter a GST rate between 0 and 100.";
    }
    if (discountApplicable && (discountAmount.trim() === "" || Number(discountAmount) < 0)) {
      next.discountAmount = "Enter a discount amount of 0 or more.";
    }

    for (const line of lines) {
      const fieldErrors: Record<string, string> = {};
      if (line.lineType === "PACKAGE" && !line.generalServicePackageId) fieldErrors.generalServicePackageId = "Select a package.";
      if (line.lineType === "SPECIFIC" && !line.specificServiceId) fieldErrors.specificServiceId = "Select a service.";
      if (line.lineType === "CUSTOM" && !line.description.trim()) fieldErrors.description = "Description is required.";
      if (line.rate.trim() === "" || Number(line.rate) < 0) fieldErrors.rate = "Enter a valid rate.";
      if (Object.keys(fieldErrors).length > 0) nextLineErrors[line.id] = fieldErrors;
    }

    for (const part of parts) {
      const fieldErrors: Record<string, string> = {};
      if (!part.inventoryItemId) fieldErrors.inventoryItemId = "Select an item.";
      const qty = Math.trunc(Number(part.quantityUsed) || 0);
      if (qty <= 0) fieldErrors.quantityUsed = "Enter a quantity greater than 0.";
      // Blank is valid and means "charge the catalogue price"; anything typed
      // has to be a real, positive amount.
      const typedPrice = (part.unitPrice ?? "").trim();
      if (typedPrice !== "" && !(Number(typedPrice) > 0)) {
        fieldErrors.unitPrice = "Enter a price greater than 0, or leave it blank for the catalogue price.";
      }
      if (Object.keys(fieldErrors).length > 0) nextPartErrors[part.id] = fieldErrors;
    }

    // Only relevant on the Complete path — a Draft save records no payment —
    // but validating unconditionally keeps one code path instead of two.
    const nextPaymentErrors = canRecordPayment
      ? validatePayment(draftToPaymentInput(paymentDraft), grandTotal)
      : {};

    setErrors(next);
    setLineErrors(nextLineErrors);
    setPartErrors(nextPartErrors);
    setPaymentErrors(nextPaymentErrors);
    return (
      Object.keys(next).length === 0 &&
      Object.keys(nextLineErrors).length === 0 &&
      Object.keys(nextPartErrors).length === 0 &&
      Object.keys(nextPaymentErrors).length === 0
    );
  }

  function buildInput(): ServiceJobInput {
    return {
      customerName: customerName.trim(),
      customerMobile: customerMobile.trim(),
      customerAddress: customerAddress.trim() || undefined,
      vehicleNumber: vehicleNumber.trim(),
      vehicleModel: vehicleModel.trim(),
      odometerReading: Math.trunc(Number(odometerReading) || 0),
      complaintNotes: complaintNotes.trim() || undefined,
      mechanicNotes: mechanicNotes.trim() || undefined,
      expectedDeliveryAt: expectedDeliveryAt ? fromISTDateInput(expectedDeliveryAt) : undefined,
      assignedMechanicId: assignedMechanicId === UNASSIGNED_VALUE ? undefined : assignedMechanicId,
      gstApplicable,
      gstAmount: gstNum,
      discountApplicable,
      discountAmount: discountNum,
      lines: lines.map((line) => ({
        lineType: line.lineType,
        generalServicePackageId: line.lineType === "PACKAGE" ? (line.generalServicePackageId ?? undefined) : undefined,
        specificServiceId: line.lineType === "SPECIFIC" ? (line.specificServiceId ?? undefined) : undefined,
        comboId: line.lineType === "COMBO" ? (line.comboId ?? undefined) : undefined,
        comboContents: line.lineType === "COMBO" ? line.comboContents : undefined,
        description: line.lineType === "CUSTOM" ? line.description.trim() : undefined,
        quantity: Math.trunc(Number(line.quantity) || 1),
        rate: Number(line.rate) || 0,
      })),
      usage: parts.map((p) => ({
        inventoryItemId: p.inventoryItemId ?? "",
        quantityUsed: Math.trunc(Number(p.quantityUsed) || 0),
        // Only sent when actually negotiated. Undefined means "use the
        // catalogue price", which is what the server did before this existed —
        // so an untouched row behaves exactly as before.
        unitPrice:
          !p.includedInCombo && (p.unitPrice ?? "").trim() !== "" && Number(p.unitPrice) > 0
            ? Number(p.unitPrice)
            : undefined,
        comboId: p.comboId ?? undefined,
        includedInCombo: p.includedInCombo ?? undefined,
      })),
    };
  }

  /**
   * The hard stop, on EVERY save — Complete, Save Draft, Save Changes and a
   * correction to a completed job alike.
   *
   * Draft saves don't move stock, so on the face of it they could be let
   * through. They aren't, because of what the counter actually does when the
   * bill is refused: not knowing why, they press Save Draft instead, and
   * again, and again — trading one pile of duplicate jobs for another. One
   * rule the whole screen obeys ("a part that isn't there stops the job")
   * is easier to learn than a rule that depends on which button you press.
   *
   * Every press re-fires the toast, so a counter who keeps pressing keeps
   * being told exactly which part is short and what to do about it.
   *
   * Returns true when it has blocked the submit.
   */
  function blockedByStock(): boolean {
    if (stockShortfalls.length === 0) return false;

    const message = stockShortfallMessage(stockShortfalls);

    // Mark the offending rows too — the banner says which parts, the red
    // quantity field says which line to change.
    const short = new Set(stockShortfalls.map((s) => s.inventoryItemId));
    setPartErrors((prev) => {
      const next = { ...prev };
      for (const part of parts) {
        if (part.inventoryItemId && short.has(part.inventoryItemId)) {
          next[part.id] = { ...(next[part.id] ?? {}), quantityUsed: "Not enough stock." };
        }
      }
      return next;
    });

    setErrors((prev) => ({ ...prev, form: message }));
    toast.error(message);
    return true;
  }

  async function handleSubmit() {
    if (!validate()) return;
    if (isCompletedEdit && lines.length === 0) {
      const message = "A completed job must keep at least one service.";
      setErrors((prev) => ({ ...prev, form: message }));
      toast.error(message);
      return;
    }
    if (blockedByStock()) return;

    const input = buildInput();

    if (submitLock.current) return;
    submitLock.current = true;
    setIsSubmitting(true);
    const result = await runWithLoader(() => {
      if (isCompletedEdit) {
        // Keeps the invoice number, reconciles stock to the corrected parts
        // list, re-derives payment status against the new total.
        return editCompletedServiceJobAction({
          serviceJobId: existingJob!.id,
          input,
          payment: draftToPaymentInput(paymentDraft),
        });
      }
      return isEdit ? updateServiceJobAction(existingJob!.id, input) : createServiceJobAction(input);
    });

    if (!result.success) {
      // Only a failure hands the form back to the user, so only a failure
      // releases the lock.
      submitLock.current = false;
      setIsSubmitting(false);
      setErrors((prev) => ({ ...prev, form: result.error }));
      toast.error(result.error);
      return;
    }

    {
      if (isCompletedEdit) {
        // Straight to the corrected bill — the whole point of the correction is
        // usually that the customer is standing there waiting for it.
        toast.success(`Invoice ${result.data.invoiceNumber} updated.`);
        router.push(`/service/${result.data.id}/invoice`);
        return;
      }
      toast.success(isEdit ? `Service Job ${result.data.jobNumber} updated.` : `Service Job ${result.data.jobNumber} created.`);
      router.push(`/service/${result.data.id}`);
    }
  }

  /**
   * "Complete & Generate Invoice" (doc §21) — the one-shot billing flow for
   * how the shop actually works: the bike's already fixed, so this saves
   * everything on the form, moves the job through to Completed (deducting
   * stock, assigning the invoice number), optionally stamps the payment
   * status picked above, then goes straight to the printable invoice.
   */
  async function handleCompleteNow() {
    if (!validate()) return;
    if (lines.length === 0) {
      const message = "Add at least one service before completing.";
      setErrors((prev) => ({ ...prev, form: message }));
      toast.error(message);
      return;
    }
    // Nothing is sent while a part is short. This is what stops the duplicate
    // jobs: the create call that used to run before the stock failure never
    // happens, so there is no half-made job for a retry to duplicate.
    if (blockedByStock()) return;

    const input = buildInput();

    if (submitLock.current) return;
    submitLock.current = true;
    setIsSubmitting(true);
    const result = await runWithLoader(() =>
      saveAndCompleteServiceJobAction({
        serviceJobId: isEdit ? existingJob!.id : undefined,
        input,
        // "Not paid yet" leaves the job at PENDING, so it surfaces in
        // "awaiting payment" instead of looking settled. Omitted entirely
        // when this user may not set it: saveAndCompleteServiceJob() skips
        // the admin-only call when payment is undefined, so the completion
        // succeeds instead of failing after the invoice already exists.
        payment: canRecordPayment ? draftToPaymentInput(paymentDraft) : undefined,
        // Same idea for handover — unticked leaves the job's delivery status
        // where completion put it, so it stays on the "to hand over" list.
        deliveryStatus: vehicleDelivered ? "DELIVERED" : undefined,
      }),
    );

    if (!result.success) {
      submitLock.current = false;
      setIsSubmitting(false);
      setErrors((prev) => ({ ...prev, form: result.error }));
      toast.error(result.error);
      return;
    }

    toast.success(`Service Job ${result.data.jobNumber} completed — Invoice ${result.data.invoiceNumber}.`);
    router.push(`/service/${result.data.id}/invoice`);
  }

  // Same target as the Cancel button at the bottom: an edit returns to the
  // job it came from, a new job returns to the Service list.
  const backHref = isEdit ? `/service/${existingJob?.id}` : "/service";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Button asChild variant="secondary" size="sm" className="rounded-[10px]">
        <Link href={backHref}>
          <ArrowLeft className="size-4" />
          {isEdit ? `Back to ${existingJob?.jobNumber}` : "Back to Service"}
        </Link>
      </Button>

      <div className="flex items-start gap-2.5">
        <ClipboardList className="mt-1 size-6 shrink-0 text-primary" />
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">{isEdit ? `Edit ${existingJob?.jobNumber}` : "New Service Job"}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {isCompletedEdit ? (
              <>
                Correcting a billed job. Invoice <span className="font-mono font-semibold">{existingJob?.invoiceNumber}</span> keeps its number, and
                stock adjusts to match whatever parts you leave on the job.
              </>
            ) : (
              <>
                Capture the customer, vehicle, and what&apos;s being done. Save as Draft any time — nothing here touches stock or reports until the job
                is completed.
              </>
            )}
          </p>
        </div>
      </div>

      {/* Two columns on a desktop monitor: everything the admin types flows
          down the left, while totals and the billing action stay pinned on
          the right instead of sitting a screen-and-a-half below the fold. */}
      <fieldset disabled={isSubmitting} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="space-y-6">
          <div className="rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
            <CustomerVehicleField
              customerName={customerName}
              customerMobile={customerMobile}
              customerAddress={customerAddress}
              vehicleNumber={vehicleNumber}
              vehicleModel={vehicleModel}
              odometerReading={odometerReading}
              customers={customers}
              vehicles={vehicles}
              onChangeCustomerName={(v) => {
                setCustomerName(v);
                setErrors((prev) => ({ ...prev, customerName: undefined }));
              }}
              onChangeCustomerMobile={(v) => {
                setCustomerMobile(v);
                setErrors((prev) => ({ ...prev, customerMobile: undefined }));
              }}
              onChangeCustomerAddress={setCustomerAddress}
              onChangeVehicleNumber={(v) => {
                setVehicleNumber(v);
                setErrors((prev) => ({ ...prev, vehicleNumber: undefined }));
                setPendingJobs([]);
                setLastService(null);
              }}
              onChangeVehicleModel={(v) => {
                setVehicleModel(v);
                setErrors((prev) => ({ ...prev, vehicleModel: undefined }));
              }}
              onChangeOdometerReading={(v) => {
                setOdometerReading(v);
                setErrors((prev) => ({ ...prev, odometerReading: undefined }));
              }}
              onVehicleSelected={handleVehicleSelected}
              disabled={isSubmitting}
              errors={errors}
            />
            {lastService && (
              <div className="mt-3">
                <LastServiceHint summary={lastService} />
              </div>
            )}
            {pendingJobs.length > 0 && (
              <div className="mt-3">
                <PendingJobBanner jobs={pendingJobs} onDismiss={() => setPendingJobs([])} />
              </div>
            )}
          </div>

          <div className="rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <StickyNote className="size-4 text-primary" />
              <Label className="text-sm font-semibold text-neutral-900">Customer Complaint</Label>
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {COMMON_COMPLAINTS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setComplaintNotes((prev) => (prev.trim() ? `${prev.trim()}, ${chip}` : chip))}
                  className="rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 hover:border-primary hover:text-primary"
                >
                  {chip}
                </button>
              ))}
            </div>
            <Textarea
              placeholder="Describe what the customer reported..."
              value={complaintNotes}
              disabled={isSubmitting}
              onChange={(e) => setComplaintNotes(e.target.value)}
              rows={2}
            />
          </div>

          {/* Its own card directly above Work Done: who is on the bike is
            decided at the counter alongside the complaint, not tucked in with
            the optional notes/delivery fields below. */}
          <div className="rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <UserCog className="size-4 text-primary" />
              <Label className="text-sm font-semibold text-neutral-900">Assigned Mechanic</Label>
            </div>
            <MechanicSelect
              value={assignedMechanicId}
              onChange={setAssignedMechanicId}
              mechanics={mechanics}
              disabled={isSubmitting}
              className="h-9 w-full rounded-[10px] sm:max-w-xs"
            />
          </div>

          {/* One card, one search box, both lists — whatever gets added lands
            directly below where it was typed (rework plan Changes 1 & 2). */}
          <div className="space-y-3 rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <Wrench className="size-4 text-primary" />
              <Label className="text-sm font-semibold text-neutral-900">Work Done</Label>
            </div>

            <ServiceLinePicker entries={pickerEntries} hasPackageLine={hasPackageLine} disabled={isSubmitting} onResolve={handlePicked} />

            <ServiceJobLines lines={lines} errors={lineErrors} disabled={isSubmitting} onUpdate={updateLine} onRemove={removeLine} />

            {parts.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Parts Used</p>
                <ServicePartsUsed
                  parts={parts}
                  items={items}
                  errors={partErrors}
                  disabled={isSubmitting}
                  onUpdate={updatePart}
                  onRemove={removePart}
                />
                {stockShortfalls.length > 0 ? (
                  /* Shown as soon as the part is added, not held back until
                     the button is pressed — the counter can swap the part or
                     restock while the customer is still standing there. The
                     same list is repeated in the toast if they press anyway. */
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-[10px] border border-danger/30 bg-danger-bg px-3 py-2.5"
                  >
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
                    <div className="min-w-0 text-xs text-danger">
                      <p className="font-semibold">Not enough stock</p>
                      <ul className="mt-1 space-y-0.5">
                        {stockShortfalls.map((s) => (
                          <li key={s.inventoryItemId}>
                            {s.productName} — need {s.required}, {s.available} in stock
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1.5 text-danger/80">
                        Remove {stockShortfalls.length === 1 ? "it" : "them"} from this job, or add stock in
                        Inventory. The job can&apos;t be saved or billed until then.
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-neutral-400">Stock only deducts when this job is completed.</p>
                )}
              </div>
            )}
          </div>

          {/* Neither field is filled at drop-off in practice, so on an empty
            form this is one line instead of a whole card. Opens itself when
            editing a job that already has them, so nothing hides silently. */}
          {showMoreDetails ? (
            <div className="rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <CalendarClock className="size-4 text-primary" />
                <Label className="text-sm font-semibold text-neutral-900">Mechanic Notes &amp; Delivery</Label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-neutral-500">Mechanic Notes (internal only — never shown to the customer)</Label>
                  <Textarea
                    placeholder="e.g. Replace chain next visit"
                    value={mechanicNotes}
                    disabled={isSubmitting}
                    onChange={(e) => setMechanicNotes(e.target.value)}
                    rows={2}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-neutral-500">Expected Delivery</Label>
                  <Input
                    type="date"
                    value={expectedDeliveryAt}
                    disabled={isSubmitting}
                    onChange={(e) => setExpectedDeliveryAt(e.target.value)}
                  />
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowMoreDetails(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-500 transition-colors hover:border-primary hover:text-primary"
            >
              <ChevronDown className="size-4" />
              Add mechanic notes or expected delivery
            </button>
          )}
        </div>

        <div className="space-y-6 lg:sticky lg:top-6">
          <div className="rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Percent className="size-4 text-primary" />
              <Label className="text-sm font-semibold text-neutral-900">Charges &amp; Totals</Label>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
                  <Checkbox checked={gstApplicable} onCheckedChange={(v) => setGstApplicable(v === true)} />
                  Apply GST
                </label>
                {gstApplicable && (
                  <div className="ml-6 max-w-36 space-y-1.5">
                    <Label className="text-xs text-neutral-500">GST Rate</Label>
                    <div className="relative">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        className="pr-7"
                        value={gstPercent}
                        aria-invalid={Boolean(errors.gstPercent) || undefined}
                        onChange={(e) => {
                          setGstPercent(e.target.value);
                          setErrors((prev) => ({
                            ...prev,
                            gstPercent: undefined,
                          }));
                        }}
                      />
                      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-neutral-400">%</span>
                    </div>
                    {errors.gstPercent && <p className="text-xs text-danger">{errors.gstPercent}</p>}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
                  <Checkbox checked={discountApplicable} onCheckedChange={(v) => setDiscountApplicable(v === true)} />
                  Apply Discount
                </label>
                {discountApplicable && (
                  <div className="ml-6 max-w-36 space-y-1.5">
                    <Label className="text-xs text-neutral-500">Discount Amount</Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-neutral-400">₹</span>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        className="pl-7"
                        value={discountAmount}
                        aria-invalid={Boolean(errors.discountAmount) || undefined}
                        onChange={(e) => {
                          setDiscountAmount(e.target.value);
                          setErrors((prev) => ({
                            ...prev,
                            discountAmount: undefined,
                          }));
                        }}
                      />
                    </div>
                    {errors.discountAmount && <p className="text-xs text-danger">{errors.discountAmount}</p>}
                  </div>
                )}
              </div>

              <div className="space-y-1.5 border-t border-neutral-100 pt-3 text-sm">
                <div className="flex items-center justify-between text-neutral-600">
                  <span>Service Subtotal</span>
                  <span className="font-medium text-neutral-900">{formatINR(subtotal)}</span>
                </div>
                {inventoryTotal > 0 && (
                  <div className="flex items-center justify-between text-neutral-600">
                    <span>Parts Used</span>
                    <span className="font-medium text-neutral-900">{formatINR(inventoryTotal)}</span>
                  </div>
                )}
                {gstApplicable && gstNum > 0 && (
                  <div className="flex items-center justify-between text-neutral-600">
                    <span>GST ({gstPercentNum}%)</span>
                    <span className="font-medium text-neutral-900">+ {formatINR(gstNum)}</span>
                  </div>
                )}
                {discountApplicable && discountNum > 0 && (
                  <div className="flex items-center justify-between text-neutral-600">
                    <span>Discount</span>
                    <span className="font-medium text-neutral-900">− {formatINR(discountNum)}</span>
                  </div>
                )}
                <div className="mt-1 flex items-center justify-between border-t border-neutral-200 pt-2 text-base font-bold text-neutral-900">
                  <span>{isCompletedEdit ? "Corrected Total" : "Estimated Total"}</span>
                  <span>{formatINR(grandTotal)}</span>
                </div>
                <p className="text-xs text-neutral-400">
                  {isCompletedEdit
                    ? "Saving replaces the amount on the existing invoice."
                    : "Final total is locked in when the job is marked Completed."}
                </p>
              </div>
            </div>
          </div>

          {isCompletedEdit ? (
            /* Already billed — the tender is a correction, not a capture, and
               there is no completion step left to offer. */
            <div className="rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <IndianRupee className="size-4 text-neutral-500" />
                <Label className="text-sm font-semibold text-neutral-900">Payment Recorded</Label>
              </div>
              <p className="mb-3 text-xs text-neutral-500">
                Pre-filled with what was collected. If the corrected total is higher, the balance shows as still due; it can never be left above the
                total, since that would mean money is owed back.
              </p>
              <PaymentCapture
                grandTotal={grandTotal}
                draft={paymentDraft}
                errors={paymentErrors}
                onChange={(next) => {
                  setPaymentDraft(next);
                  setPaymentErrors({});
                }}
                className="border-neutral-200"
              />
            </div>
          ) : (
            <div className="rounded-[14px] border border-primary/30 bg-primary/5 p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <CheckCircle2 className="size-4 text-primary" />
                <Label className="text-sm font-semibold text-neutral-900">Job Done? Bill It Now</Label>
              </div>
              <p className="mb-3 text-xs text-neutral-500">
                {canRecordPayment
                  ? "If the work is finished, mark payment and complete the job in one step — stock deducts, the invoice is generated, and you're taken straight to it."
                  : "If the work is finished, complete the job here — stock deducts, the invoice is generated, and you're taken straight to it."}
              </p>
              <div className="space-y-3">
                {canRecordPayment ? (
                  <PaymentCapture
                    grandTotal={grandTotal}
                    draft={paymentDraft}
                    errors={paymentErrors}
                    onChange={(next) => {
                      setPaymentDraft(next);
                      setPaymentErrors({});
                    }}
                    className="border-neutral-200"
                  />
                ) : (
                  /* Shown instead of the Cash/UPI picker rather than beside a
                     disabled one: a control you are not allowed to use is
                     worse than no control, and this is the screen where
                     pressing on regardless used to bill the job and then
                     report a permission failure. */
                  <div className="rounded-[10px] border border-neutral-200 bg-neutral-50 p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-neutral-700">Payment</span>
                      <span className="text-sm font-bold text-neutral-900">Bill total {formatINR(grandTotal)}</span>
                    </div>
                    <p className="mt-1.5 text-xs text-neutral-500">
                      Only an Administrator can record how the customer paid. Complete the job now — the invoice is
                      generated and it shows as <span className="font-medium text-danger">Pending</span> until an
                      Administrator marks it paid from the Service list.
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
                    <Checkbox checked={vehicleDelivered} onCheckedChange={(v) => setVehicleDelivered(v === true)} />
                    <Bike className="size-3.5 text-neutral-500" />
                    Vehicle handed over to customer
                  </label>
                  <p className="pl-6 text-xs text-neutral-500">
                    Leave unticked if the bike is still in the shop — you can mark it delivered later from the job.
                  </p>
                </div>
                <Button type="button" className="w-full bg-primary hover:bg-primary/90" onClick={handleCompleteNow} disabled={isSubmitting}>
                  <CheckCircle2 className="size-4" />
                  {isSubmitting ? "Completing..." : "Complete & Generate Invoice"}
                </Button>
              </div>
            </div>
          )}

          {errors.form && <p className="text-sm text-danger">{errors.form}</p>}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => router.push(isEdit ? `/service/${existingJob?.id}` : "/service")}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="button" className="flex-1 bg-danger hover:bg-danger/90" onClick={handleSubmit} disabled={isSubmitting}>
              <FileText className="size-4" />
              {isSubmitting ? "Saving..." : isCompletedEdit ? "Save & Reprint Invoice" : isEdit ? "Save Changes" : "Save Draft"}
            </Button>
          </div>
        </div>
      </fieldset>
    </div>
  );
}
