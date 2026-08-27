"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, FileText, Percent, ShoppingCart, User, UserCog, Wrench } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useGlobalLoader } from "@/components/shared/global-loader";
import { PaymentCapture } from "@/components/shared/payment-capture";
import { formatINR } from "@/lib/format";
import type { InventoryItemRow } from "@/services/inventory";
import type { CustomerRow, SaleInput } from "@/services/sales";
import { createTyreLookup, getFittingNudge, type FittingCheckLine } from "@/services/sales/fitting";
import { buildSalePickerIndex, type SalePickerResolution, type SaleUsageCounts } from "@/services/sales/picker";
import { MOBILE_NUMBER_ERROR, isValidMobileNumber } from "@/services/shared/mobile";
import {
  draftFromPayment,
  draftToPaymentInput,
  initialPaymentDraft,
  recalcForTotal,
  validatePayment,
  type PaymentDraft,
  type PaymentErrors,
} from "@/services/shared/payment";

import { editSaleAction, recordSaleAction } from "@/app/(app)/sales/actions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SaleRow } from "@/services/sales";
import type { StaffOption } from "@/services/users";

/** Radix Select can't take an empty-string item value, and "nobody
 * credited" is a state the form has to be able to express. */
const UNASSIGNED_VALUE = "UNASSIGNED";

import { CustomerField } from "./customer-field";
import { SaleLinePicker } from "./sale-line-picker";
import { SaleLineItems, lineDiscount, lineTotal, type LineDraft, type LineErrors } from "./sale-line-items";

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `line-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Recovers the GST rate from a stored amount. Only `gst_amount` is persisted,
 * so the rate has to come back out of the arithmetic that produced it:
 * amount ÷ (subtotal + installation) × 100, rounded to two places because a
 * rate like 18 lands as 17.999999 otherwise.
 *
 * Returns null when there's nothing to derive from, so the caller falls back to
 * the 18% default a brand-new bill wants.
 */
function derivedGstPercent(sale?: SaleRow): string | null {
  if (!sale || !sale.gstApplicable || sale.gstAmount <= 0) return null;
  const taxableBase = sale.subtotal + sale.installationTotal;
  if (taxableBase <= 0) return null;
  return String(Math.round((sale.gstAmount / taxableBase) * 10000) / 100);
}

/**
 * Rebuilds the form's line drafts from a recorded sale.
 *
 * A combo is stored as a COMBO header row PLUS the PRODUCT rows the server
 * expanded out of it, each carrying that combo's id. Only the header belongs in
 * the draft — re-listing the expanded components would double them on save,
 * since `replace_sale_lines()` expands the bundle again from the id alone.
 */
function draftLinesFrom(sale?: SaleRow): LineDraft[] {
  if (!sale) return [];

  return sale.lineItems
    .filter((line) => !(line.lineType === "PRODUCT" && line.comboId))
    .map((line): LineDraft => {
      if (line.lineType === "COMBO") {
        return {
          id: newId(),
          lineType: "COMBO",
          comboId: line.comboId ?? "",
          comboName: line.description ?? "Combo",
          comboPrice: String(line.amount ?? 0),
          comboContents: line.comboContents ?? [],
          // Display-only on an edit: the double-charge nudge is about what's
          // being added now, and everything here was already billed.
          comboCoversFitting: false,
          quantity: String(line.quantity ?? 1),
        };
      }
      if (line.lineType === "INSTALLATION") {
        return {
          id: newId(),
          lineType: "INSTALLATION",
          installationSubtype: line.installationSubtype,
          wheelCount: line.wheelCount ? String(line.wheelCount) : "",
          description: line.description ?? "",
          amount: line.amount !== null && line.amount !== undefined ? String(line.amount) : "",
          installedBy: line.installedBy ?? "",
        };
      }
      return {
        id: newId(),
        lineType: "PRODUCT",
        inventoryItemId: line.inventoryItemId,
        quantity: String(line.quantity ?? 0),
        // Seed with what the customer was actually charged, not the catalogue
        // price. Opening a sale for correction must show the bill as issued —
        // otherwise a negotiated line silently reverts to list on the next save.
        unitPrice: line.unitSellingPrice != null ? String(line.unitSellingPrice) : "",
      };
    });
}

export function NewSalePageClient({
  existingSale,
  items,
  customers,
  usageCounts,
  salespeople = [],
  defaultSoldById,
  todayLabel,
  canSellBelowCost = false,
}: {
  /** Present on /sales/[id]/edit — the same form, correcting a recorded sale
   * in place (doc/sales-edit-void-scope.md §3). The invoice number survives, so
   * this is a correction, not a re-issue. */
  existingSale?: SaleRow;
  /** Admin only — a Sales Person may negotiate a price down but not below
   * the item's own cost. Enforced in the DB regardless (0034). */
  canSellBelowCost?: boolean;
  items: InventoryItemRow[];
  customers: CustomerRow[];
  /** How often each item has actually sold — ranks search results and fills
   * the quick-add chips. Combo Offers are deliberately not offered here
   * (confirmed decision, 2026-08-15) — see services/sales/picker.ts. An
   * existing sale that already has a combo line still shows and saves it
   * correctly; this only governs what can be newly added. */
  usageCounts?: SaleUsageCounts;
  /** Active Admins + Sales Persons for the "Sold by" picker (§2). */
  salespeople?: StaffOption[];
  /** Pre-selects the signed-in user on a new sale — it's almost always them.
   * Ignored when editing, which keeps whoever the sale already credits. */
  defaultSoldById?: string;
  todayLabel: string;
}) {
  const router = useRouter();
  const isEdit = Boolean(existingSale);

  const [customerName, setCustomerName] = useState(existingSale?.customerName ?? "");
  const [customerMobile, setCustomerMobile] = useState(existingSale?.customerMobile ?? "");
  const [customerAddress, setCustomerAddress] = useState(existingSale?.customerAddress ?? "");
  const [soldById, setSoldById] = useState(
    existingSale ? (existingSale.soldById ?? UNASSIGNED_VALUE) : (defaultSoldById ?? UNASSIGNED_VALUE)
  );
  const [gstApplicable, setGstApplicable] = useState(existingSale?.gstApplicable ?? false);
  // Standard GST rate is 18% — prefilled so the common case needs no typing;
  // kept editable as a % (not a flat amount) since GST is always a rate
  // applied to the taxable total, and the rare non-standard invoice just
  // overwrites the number here.
  // Only the GST *amount* is stored, never the rate — so on an edit the rate
  // has to be recovered from the amount against its own taxable base. Without
  // this the box would open at 18% and silently restate a bill raised at 12%
  // the moment anything else on it was corrected.
  const [gstPercent, setGstPercent] = useState(() => derivedGstPercent(existingSale) ?? "18");
  const [discountApplicable, setDiscountApplicable] = useState(existingSale?.discountApplicable ?? false);
  const [discountAmount, setDiscountAmount] = useState(existingSale?.discountAmount ? String(existingSale.discountAmount) : "");
  const [lines, setLines] = useState<LineDraft[]>(() => draftLinesFrom(existingSale));
  // Defaults to Cash, for the same reason the old "Customer has paid" box was
  // pre-ticked: a counter sale is settled on the spot far more often than not.
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft>(() =>
    existingSale
      ? draftFromPayment(
          {
            mode: existingSale.paymentMode,
            cashAmount: existingSale.cashAmount,
            upiAmount: existingSale.upiAmount,
          },
          existingSale.grandTotal
        )
      : initialPaymentDraft(0)
  );
  const [paymentErrors, setPaymentErrors] = useState<PaymentErrors>({});
  // "Not needed" applies to this sale only — the next one is a fresh
  // decision, so it's never remembered against a customer or an item.
  const [fittingDismissed, setFittingDismissed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<{
    customerName?: string;
    customerMobile?: string;
    lines?: string;
    gstPercent?: string;
    discountAmount?: string;
    form?: string;
  }>({});
  const [lineErrors, setLineErrors] = useState<LineErrors>({});
  const { runWithLoader } = useGlobalLoader();

  function addProduct() {
    setLines((prev) => [...prev, { id: newId(), lineType: "PRODUCT", inventoryItemId: null, quantity: "" }]);
    setErrors((prev) => ({ ...prev, lines: undefined }));
  }

  function addInstallation() {
    setLines((prev) => [
      ...prev,
      {
        id: newId(),
        lineType: "INSTALLATION",
        installationSubtype: null,
        wheelCount: "",
        description: "",
        amount: "",
        installedBy: "",
      },
    ]);
    setErrors((prev) => ({ ...prev, lines: undefined }));
  }

  /**
   * Single landing point for whatever was picked or typed. The picker has
   * already worked out what it is; this just files it — the classification
   * step the two Add buttons used to force on the admin.
   */
  function handlePicked(resolution: SalePickerResolution) {
    if (!resolution.ok) {
      toast.error(resolution.reason);
      return;
    }
    setErrors((prev) => ({ ...prev, lines: undefined }));

    if (resolution.target === "PRODUCT") {
      setLines((prev) => {
        // The same item picked twice bumps the quantity rather than opening a
        // second row that has to be reconciled at the till.
        const existing = prev.find((l) => l.lineType === "PRODUCT" && l.inventoryItemId === resolution.product.inventoryItemId);
        if (existing && existing.lineType === "PRODUCT") {
          const stock = items.find((i) => i.id === existing.inventoryItemId)?.availableQuantity ?? Infinity;
          const next = Math.min(stock, Math.trunc(Number(existing.quantity) || 0) + 1);
          return prev.map((l) => (l.id === existing.id ? { ...l, quantity: String(next) } : l));
        }
        return [...prev, { id: newId(), lineType: "PRODUCT", ...resolution.product }];
      });
      return;
    }

    if (resolution.target === "FITTING") {
      setLines((prev) => [
        ...prev,
        { id: newId(), lineType: "INSTALLATION", installationSubtype: "TYRE_FITTING", wheelCount: resolution.fitting.wheelCount, description: "", amount: "", installedBy: "" },
      ]);
      return;
    }

    setLines((prev) => [
      ...prev,
      { id: newId(), lineType: "INSTALLATION", installationSubtype: "CUSTOM", wheelCount: "", description: resolution.charge.description, amount: "", installedBy: "" },
    ]);
  }

  /** One tap on the nudge — adds the fitting line the sale was missing. */
  function acceptFittingNudge(wheelCount: number) {
    setLines((prev) => [
      ...prev,
      { id: newId(), lineType: "INSTALLATION", installationSubtype: "TYRE_FITTING", wheelCount: String(wheelCount), description: "", amount: "", installedBy: "" },
    ]);
  }

  function updateLine(id: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((line) => (line.id === id ? ({ ...line, ...patch } as LineDraft) : line)));
    // Clear only the fields that just changed, on this specific line.
    setLineErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev, [id]: { ...prev[id] } };
      for (const key of Object.keys(patch)) delete next[id][key];
      return next;
    });
  }

  function removeLine(id: string) {
    setLines((prev) => prev.filter((line) => line.id !== id));
    setLineErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  const pickerEntries = useMemo(() => buildSalePickerIndex({ items, usageCounts }), [items, usageCounts]);
  const tyreLookup = useMemo(() => createTyreLookup(items), [items]);

  /** The shape the fitting check needs, derived from the form's draft lines. */
  const fittingLines: FittingCheckLine[] = lines.map((line) =>
    line.lineType === "PRODUCT"
      ? {
          // Combo contents never appear as client-side product rows (the
          // server expands them), so a product row here is always loose.
          lineType: "PRODUCT" as const,
          inventoryItemId: line.inventoryItemId,
          quantity: Math.trunc(Number(line.quantity) || 0),
        }
      : line.lineType === "COMBO"
        ? { lineType: "COMBO" as const, comboCoversFitting: line.comboCoversFitting }
        : { lineType: "INSTALLATION" as const, installationSubtype: line.installationSubtype }
  );

  const fittingNudge = getFittingNudge(fittingLines, tyreLookup, { dismissed: fittingDismissed });
  /** Tyres on the sale, so picking "Tyre Fitting" pre-fills the wheel count. */
  const suggestedWheelCount = fittingNudge?.kind === "SUGGEST_FITTING" ? fittingNudge.wheelCount : 0;

  const subtotal = lines
    .filter((l) => l.lineType === "PRODUCT")
    .reduce((sum, l) => sum + lineTotal(l, items), 0);
  const installationTotal = lines
    .filter((l) => l.lineType === "INSTALLATION")
    .reduce((sum, l) => sum + lineTotal(l, items), 0);
  // What the counter has given away against the catalogue, visible BEFORE
  // Complete Sale rather than discovered in a report next month.
  const negotiatedDiscount = lines.reduce((sum, l) => sum + lineDiscount(l, items), 0);
  const taxableTotal = subtotal + installationTotal;
  const gstPercentNum = Number(gstPercent) || 0;
  // Rounded to the nearest paisa before it ever reaches state used for
  // display or submission — avoids floating-point tails like ₹755.9999999994.
  const gstNum = gstApplicable ? Math.round(taxableTotal * gstPercentNum) / 100 : 0;
  const discountNum = discountApplicable ? Number(discountAmount) || 0 : 0;
  const grandTotal = Math.max(0, taxableTotal + gstNum - discountNum);

  // Payment amounts are pinned to the bill total, so a line added (or GST
  // toggled) after choosing payment can't leave ₹2,000 recorded against a
  // ₹2,500 bill. Manually-entered Split figures survive; only the derived
  // side moves. See recalcForTotal() for the exact rule.
  useEffect(() => {
    setPaymentDraft((prev) => recalcForTotal(prev, grandTotal));
  }, [grandTotal]);

  function validate(): boolean {
    const next: typeof errors = {};
    const nextLineErrors: LineErrors = {};

    if (!customerName.trim()) next.customerName = "Customer name is required.";
    if (!isValidMobileNumber(customerMobile)) {
      next.customerMobile = MOBILE_NUMBER_ERROR;
    }

    if (lines.length === 0) {
      next.lines = "Add at least one line item.";
    } else if (!lines.some((l) => l.lineType === "PRODUCT" || l.lineType === "COMBO")) {
      // A combo expands into products server-side, so it counts.
      next.lines = "A sale requires at least one product or combo.";
    }

    if (gstApplicable && (gstPercent.trim() === "" || Number(gstPercent) < 0 || Number(gstPercent) > 100)) {
      next.gstPercent = "Enter a GST rate between 0 and 100.";
    }
    if (discountApplicable && (discountAmount.trim() === "" || Number(discountAmount) < 0)) {
      next.discountAmount = "Enter a discount amount of 0 or more.";
    }

    for (const line of lines) {
      const fieldErrors: Record<string, string> = {};
      if (line.lineType === "PRODUCT") {
        if (!line.inventoryItemId) fieldErrors.inventoryItemId = "Select an item.";
        const qty = Math.trunc(Number(line.quantity) || 0);
        if (qty <= 0) {
          fieldErrors.quantity = "Enter a quantity greater than 0.";
        } else {
          // Same check shown live under the stepper (sale-line-items.tsx) —
          // repeated here so a stale/typed-over value can't slip through on
          // submit even if the inline warning was missed.
          const selectedItem = items.find((i) => i.id === line.inventoryItemId);
          if (selectedItem && qty > selectedItem.availableQuantity) {
            fieldErrors.quantity = `Only ${selectedItem.availableQuantity} in stock.`;
          }
        }
      } else if (line.lineType === "COMBO") {
        // Nothing to validate: the price, contents and stock are all the
        // server's business (record_sale expands it), and the quantity
        // stepper can't go below 1.
      } else {
        if (!line.installationSubtype) fieldErrors.installationSubtype = "Select a fitting type.";
        if (line.installationSubtype === "TYRE_FITTING") {
          const wheels = Math.trunc(Number(line.wheelCount) || 0);
          if (wheels <= 0) fieldErrors.wheelCount = "Enter how many wheels were fitted.";
        } else if (line.installationSubtype === "CUSTOM") {
          if (!line.description.trim()) fieldErrors.description = "Describe what's being installed.";
          if (line.amount.trim() === "" || Number(line.amount) < 0) fieldErrors.amount = "Enter a valid amount.";
        }
      }
      if (Object.keys(fieldErrors).length > 0) nextLineErrors[line.id] = fieldErrors;
    }

    // Mirrors the RPC's own check. The server re-validates against the
    // authoritative total regardless — this only saves a round trip.
    const nextPaymentErrors = validatePayment(draftToPaymentInput(paymentDraft), grandTotal);

    setErrors(next);
    setLineErrors(nextLineErrors);
    setPaymentErrors(nextPaymentErrors);
    return (
      Object.keys(next).length === 0 &&
      Object.keys(nextLineErrors).length === 0 &&
      Object.keys(nextPaymentErrors).length === 0
    );
  }

  async function handleSubmit() {
    if (!validate()) return;

    const input: SaleInput = {
      customerName: customerName.trim(),
      customerMobile: customerMobile.trim(),
      customerAddress: customerAddress.trim() || undefined,
      gstApplicable,
      gstAmount: gstNum,
      discountApplicable,
      discountAmount: discountNum,
      soldById: soldById === UNASSIGNED_VALUE ? undefined : soldById,
      payment: draftToPaymentInput(paymentDraft),
      lines: lines.map((line) =>
        line.lineType === "PRODUCT"
          ? {
              lineType: "PRODUCT" as const,
              inventoryItemId: line.inventoryItemId ?? undefined,
              quantity: Math.trunc(Number(line.quantity) || 0),
              // Only sent when actually negotiated. Undefined means "use the
              // catalogue price", which is what the server did before this
              // existed — so an untouched line behaves exactly as before.
              unitSellingPrice:
                (line.unitPrice ?? "").trim() !== "" && Number(line.unitPrice) > 0
                  ? Number(line.unitPrice)
                  : undefined,
            }
          : line.lineType === "COMBO"
          ? {
              // Id and quantity only — the server expands the rest.
              lineType: "COMBO" as const,
              comboId: line.comboId,
              quantity: Math.trunc(Number(line.quantity) || 1),
            }
          : {
              lineType: "INSTALLATION" as const,
              installationSubtype: line.installationSubtype ?? undefined,
              wheelCount:
                line.installationSubtype === "TYRE_FITTING" ? Math.trunc(Number(line.wheelCount) || 0) : undefined,
              description: line.installationSubtype === "CUSTOM" ? line.description.trim() : undefined,
              amount: line.amount.trim() !== "" ? Number(line.amount) : undefined,
              installedBy: line.installedBy.trim() || undefined,
            }
      ),
    };

    setIsSubmitting(true);
    const result = await runWithLoader(() =>
      isEdit ? editSaleAction({ saleId: existingSale!.id, input }) : recordSaleAction(input)
    );
    setIsSubmitting(false);

    if (result.success) {
      toast.success(isEdit ? `Invoice ${result.data.invoiceNumber} updated.` : `Sale recorded — Invoice ${result.data.invoiceNumber}.`);
      // Straight to the printable invoice (doc/billing-invoice-scope.md §4)
      // — the customer is typically still at the counter waiting for a bill.
      router.push(`/sales/${result.data.id}/invoice`);
    } else {
      setErrors((prev) => ({ ...prev, form: result.error }));
      toast.error(result.error);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Button asChild variant="secondary" size="sm" className="rounded-[10px]">
        <Link href="/sales">
          <ArrowLeft className="size-4" />
          Back to Sales
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-2.5">
          <FileText className="mt-1 size-6 shrink-0 text-primary" />
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">New Sale</h1>
            <p className="mt-1 text-sm text-neutral-500">Enter customer details, add items, and complete the sale.</p>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-neutral-500">Invoice No.</Label>
            <div className="flex h-9 items-center rounded-[10px] border border-neutral-200 bg-neutral-50 px-3 font-mono text-sm text-neutral-500">
              assigned on save
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-neutral-500">Invoice Date</Label>
            <div className="flex h-9 items-center gap-2 rounded-[10px] border border-neutral-200 bg-neutral-50 px-3 text-sm font-medium text-neutral-900">
              <CalendarDays className="size-4 text-neutral-400" />
              {todayLabel}
            </div>
          </div>
        </div>
      </div>

      {/* Two columns on a desktop monitor: what the admin types flows down
          the left, while the running total and Complete Sale stay pinned on
          the right instead of sitting below the fold. Same shape as the
          reworked Service form. */}
      <fieldset disabled={isSubmitting} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="space-y-6">
        <div className="rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <User className="size-4 text-primary" />
            <Label className="text-sm font-semibold text-neutral-900">Customer Details</Label>
          </div>
          <CustomerField
            name={customerName}
            mobile={customerMobile}
            address={customerAddress}
            customers={customers}
            
            onChangeMobile={(v) => {
              setCustomerMobile(v);
              setErrors((prev) => ({ ...prev, customerMobile: undefined }));
            }}
            onChangeName={(v) => {
              setCustomerName(v);
              setErrors((prev) => ({ ...prev, customerName: undefined }));
            }}
            onChangeAddress={setCustomerAddress}
            disabled={isSubmitting}
            errors={{ name: errors.customerName, mobile: errors.customerMobile }}
          />
        </div>

        {/* Its own card, same placement Service gives Assigned Mechanic —
            who made the sale is decided at the counter alongside the
            customer, not tucked in with GST/Discount below. */}
        <div className="rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <UserCog className="size-4 text-primary" />
            <Label className="text-sm font-semibold text-neutral-900">Sold By</Label>
          </div>
          <Select value={soldById} onValueChange={setSoldById} disabled={isSubmitting}>
            <SelectTrigger size="sm" className="h-9 w-full rounded-[10px] sm:max-w-xs">
              <SelectValue placeholder="Unassigned" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
              {salespeople.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3 rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <ShoppingCart className="size-4 text-primary" />
            <Label className="text-sm font-semibold text-neutral-900">Sale Items</Label>
          </div>

          <SaleLinePicker entries={pickerEntries} suggestedWheelCount={suggestedWheelCount} disabled={isSubmitting} onResolve={handlePicked} />

          <SaleLineItems
            lines={lines}
            items={items}
            errors={lineErrors}
            disabled={isSubmitting}
            canSellBelowCost={canSellBelowCost}
            onUpdate={updateLine}
            onRemove={removeLine}
          />

          {/* The money guard. Nothing else connects "there are tyres here" to
              "there should be a fitting charge", and an invoice missing one
              looks completely normal. Advisory by confirmed decision — a
              customer fitting tyres elsewhere is a real case. */}
          {fittingNudge?.kind === "SUGGEST_FITTING" && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-warning/30 bg-warning/5 px-3 py-2.5">
              <p className="text-sm text-neutral-700">
                <span className="font-semibold">
                  {fittingNudge.wheelCount} {fittingNudge.wheelCount === 1 ? "tyre" : "tyres"}, no fitting charge.
                </span>{" "}
                Add tyre fitting — {formatINR(fittingNudge.amount)}?
              </p>
              <div className="flex shrink-0 gap-2">
                <Button type="button" size="sm" className="h-8 rounded-[10px]" onClick={() => acceptFittingNudge(fittingNudge.wheelCount)}>
                  <Wrench className="size-3.5" />
                  Add fitting
                </Button>
                <Button type="button" size="sm" variant="secondary" className="h-8 rounded-[10px]" onClick={() => setFittingDismissed(true)}>
                  Not needed
                </Button>
              </div>
            </div>
          )}

          {fittingNudge?.kind === "ALREADY_IN_COMBO" && (
            <p className="rounded-[10px] border border-danger/30 bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger">
              This combo already includes fitting — the separate fitting line will bill the customer twice.
            </p>
          )}

          {errors.lines && <p className="text-sm text-danger">{errors.lines}</p>}
        </div>

        </div>

        <div className="space-y-6 lg:sticky lg:top-6">
          <div className="rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Percent className="size-4 text-primary" />
              <Label className="text-sm font-semibold text-neutral-900">Charges &amp; Totals</Label>
            </div>

            <div className="space-y-4">
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
                          setErrors((prev) => ({ ...prev, gstPercent: undefined }));
                        }}
                      />
                      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-neutral-400">
                        %
                      </span>
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
                      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-neutral-400">
                        ₹
                      </span>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        className="pl-7"
                        value={discountAmount}
                        aria-invalid={Boolean(errors.discountAmount) || undefined}
                        onChange={(e) => {
                          setDiscountAmount(e.target.value);
                          setErrors((prev) => ({ ...prev, discountAmount: undefined }));
                        }}
                      />
                    </div>
                    {errors.discountAmount && <p className="text-xs text-danger">{errors.discountAmount}</p>}
                  </div>
                )}
              </div>
            </div>

              <div className="space-y-1.5 border-t border-neutral-100 pt-3 text-sm">
              <div className="flex items-center justify-between text-neutral-600">
                <span>Subtotal</span>
                <span className="font-medium text-neutral-900">{formatINR(subtotal)}</span>
              </div>
              {/* Not part of the arithmetic — the subtotal above is already
                  net of it. Shown so whoever approves the bill sees the
                  margin given away before pressing Complete Sale, rather
                  than finding it in a report next month. */}
              {negotiatedDiscount > 0 && (
                <div className="flex items-center justify-between text-warning">
                  <span>Price negotiated down</span>
                  <span className="font-medium">−{formatINR(negotiatedDiscount)}</span>
                </div>
              )}
              {installationTotal > 0 && (
                <div className="flex items-center justify-between text-neutral-600">
                  <span>Installation Charges</span>
                  <span className="font-medium text-neutral-900">{formatINR(installationTotal)}</span>
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
                  <span>Grand Total</span>
                  <span>{formatINR(grandTotal)}</span>
                </div>
              </div>
            </div>
          </div>

          <PaymentCapture
            grandTotal={grandTotal}
            draft={paymentDraft}
            errors={paymentErrors}
            onChange={(next) => {
              setPaymentDraft(next);
              // Same rule as every other field on this form: an edit clears
              // its own error rather than leaving a stale message behind.
              setPaymentErrors({});
            }}
          />

          {errors.form && <p className="text-sm text-danger">{errors.form}</p>}

          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => router.push("/sales")} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="button" className="flex-1 bg-danger hover:bg-danger/90" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? "Recording..." : "Complete Sale"}
            </Button>
          </div>
        </div>
      </fieldset>
    </div>
  );
}
