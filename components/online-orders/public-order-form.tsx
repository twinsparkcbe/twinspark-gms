"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ImageOff, Loader2, Minus, Plus, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { maskAmountInput } from "@/lib/input-masks";
import { cn } from "@/lib/utils";

import { PaymentDetailsCard } from "@/components/online-orders/payment-details-card";

import {
  fetchTrackTyrePricesAction,
  submitOnlineOrderAction,
  uploadOnlineOrderScreenshotAction,
} from "@/app/order/actions";
// Imported directly from the leaf schemas module (not the "@/services/
// online-orders" barrel) — this is a Client Component, and the barrel also
// re-exports orders.ts, which is server-only. Reusing the actual Zod schema
// (rather than a hand-copied regex) means client and server validation for
// mobile number/PIN code can never drift apart.
import { MAX_QUOTED_AMOUNT, mobileNumberSchema, pinCodeSchema } from "@/services/online-orders/schemas";
import { MOBILE_NUMBER_LENGTH, sanitizeMobileNumber } from "@/services/shared/mobile";
// From the leaf module, not the "@/services/payments" barrel — same reason
// as the mobileNumberSchema/pinCodeSchema import above: the barrel also
// re-exports qr-config.ts (server-only), and this is a Client Component.
// Type-only, so it's erased at build time either way; passed down from
// app/order/page.tsx, which fetches it server-side
// (doc/payment-qr-config-scope.md §3).
import type { PaymentQrConfigRow } from "@/services/payments/qr-config";

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * No per-tyre price is shown to the customer (confirmed 2026-08-27) — only
 * the order total. The unit prices still drive that total; they are simply
 * not advertised on the public form.
 */
function QuantityStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label={`Decrease ${label}`}
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          <Minus className="size-4" />
        </Button>
        <Input
          type="number"
          step="1"
          min={0}
          inputMode="numeric"
          className="text-center"
          value={value}
          onChange={(e) => onChange(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
        />
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label={`Increase ${label}`}
          onClick={() => onChange(value + 1)}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Public, unauthenticated Track Tyre order form (doc/online-orders-scope.md
 * §1). No account, no login — a submission just gets queued at SUBMITTED
 * for staff to verify/approve/dispatch from the Online Orders module.
 *
 * Front/Back are separate quantity fields (not one "quantity" like the
 * original spec) because Track Tyre Front and Back are now separate
 * inventory items (doc/track-tyre-front-back-split-scope.md) with
 * independent stock — see 0018_online_orders_schema.sql's header comment.
 *
 * `paymentConfig` (doc/payment-qr-config-scope.md §3) is null when no
 * payment config is currently active — the PaymentDetailsCard is simply
 * absent in that case, the rest of the form (including the screenshot
 * upload, still required) is unaffected either way.
 */
export function PublicOrderForm({ paymentConfig }: { paymentConfig: PaymentQrConfigRow | null }) {
  const [customerName, setCustomerName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [address, setAddress] = useState("");
  const [pinCode, setPinCode] = useState("");
  const [quantityFront, setQuantityFront] = useState(0);
  const [quantityBack, setQuantityBack] = useState(0);
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotPreviewUrl, setScreenshotPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [orderId, setOrderId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [prices, setPrices] = useState<{ front: number | null; back: number | null }>({ front: null, back: null });
  const [isLoadingPrices, setIsLoadingPrices] = useState(true);
  const [amountInput, setAmountInput] = useState("");
  // Once the customer types their own figure the field is theirs — see the
  // resync effect below for why this has to be tracked separately.
  const [amountTouched, setAmountTouched] = useState(false);

  // Seeds the Amount to Pay field. The catalogue price is looked up again
  // server-side at submit time, so tampering with what comes back here
  // changes nothing: an untouched field is recomputed from scratch, and a
  // touched one is bounds-checked and flagged for staff review
  // (0036_online_order_amount_override.sql).
  useEffect(() => {
    let cancelled = false;
    fetchTrackTyrePricesAction().then((result) => {
      if (cancelled) return;
      if (result.success) setPrices(result.data);
      setIsLoadingPrices(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const catalogueAmount = quantityFront * (prices.front ?? 0) + quantityBack * (prices.back ?? 0);
  const hasSelection = quantityFront > 0 || quantityBack > 0;
  const hasUnpricedSelection = (quantityFront > 0 && prices.front === null) || (quantityBack > 0 && prices.back === null);

  // Prefill (and keep in step with the quantity steppers) until the customer
  // takes the field over. After that the typed figure stands: most orders
  // here start with a phone call, and silently overwriting the amount the
  // shop quoted because a quantity changed afterwards would be worse than a
  // stale-looking number the customer can see and correct.
  useEffect(() => {
    if (amountTouched || isLoadingPrices) return;
    setAmountInput(hasSelection ? String(catalogueAmount) : "");
  }, [amountTouched, isLoadingPrices, hasSelection, catalogueAmount]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setErrors((prev) => ({ ...prev, screenshot: "Only PNG, JPEG, or WEBP images are allowed." }));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setErrors((prev) => ({ ...prev, screenshot: "Image must be 5MB or smaller." }));
      return;
    }

    setScreenshotFile(file);
    setScreenshotPreviewUrl(URL.createObjectURL(file));
    setErrors((prev) => ({ ...prev, screenshot: "" }));
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!customerName.trim()) next.customerName = "Your name is required.";

    const mobileResult = mobileNumberSchema.safeParse(mobileNumber.trim());
    if (!mobileResult.success) {
      next.mobileNumber = mobileResult.error.issues[0]?.message ?? "Enter a valid mobile number.";
    }

    if (!address.trim()) next.address = "Delivery address is required.";

    const pinResult = pinCodeSchema.safeParse(pinCode.trim());
    if (!pinResult.success) {
      next.pinCode = pinResult.error.issues[0]?.message ?? "Enter a valid PIN code.";
    }

    if (quantityFront === 0 && quantityBack === 0) {
      next.quantityFront = "Order at least one Track Tyre (Front or Back).";
    }

    if (hasSelection) {
      const parsedAmount = Number(amountInput);
      if (!amountInput.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        next.amount = "Enter the amount you were asked to pay.";
      } else if (parsedAmount > MAX_QUOTED_AMOUNT) {
        next.amount = "That amount looks too high — please call us to confirm the price.";
      }
    }

    if (!screenshotFile) next.screenshot = "Upload your payment screenshot.";
    return next;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setIsSubmitting(true);

    const formData = new FormData();
    formData.append("file", screenshotFile as File);
    const uploadResult = await uploadOnlineOrderScreenshotAction(formData);
    if (!uploadResult.success) {
      setIsSubmitting(false);
      setErrors({ form: uploadResult.error });
      return;
    }

    const submitResult = await submitOnlineOrderAction({
      customerName: customerName.trim(),
      mobileNumber: mobileNumber.trim(),
      address: address.trim(),
      pinCode: pinCode.trim(),
      quantityFront,
      quantityBack,
      // Sent only when the customer actually changed it. An untouched field
      // means "charge me your price", and submit_online_order() recomputes
      // that server-side — so a price that moved between page load and
      // submit is picked up rather than frozen, and the order is not
      // wrongly flagged as an override.
      quotedAmount: amountTouched ? Number(amountInput) : undefined,
      paymentScreenshotPath: uploadResult.data.path,
    });
    setIsSubmitting(false);

    if (submitResult.success) {
      setOrderId(submitResult.data.orderId);
    } else {
      setErrors({ form: submitResult.error });
    }
  }

  if (orderId) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <CheckCircle2 className="size-12 text-success" />
        <h2 className="text-xl font-bold text-neutral-900">Order Submitted</h2>
        <p className="max-w-sm text-sm text-neutral-500">
          We&apos;ve received your order and payment screenshot. Our team will verify your payment and get in touch
          before dispatch.
        </p>
        <p className="mt-2 rounded-[10px] bg-neutral-100 px-4 py-2 font-mono text-xs text-neutral-600">
          Reference: {orderId}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <fieldset disabled={isSubmitting} className="space-y-4">
        <div className="space-y-1.5">
          <Label>Customer Name *</Label>
          <Input
            value={customerName}
            onChange={(e) => {
              setCustomerName(e.target.value);
              setErrors((prev) => ({ ...prev, customerName: "" }));
            }}
            placeholder="Your full name"
          />
          {errors.customerName && <p className="text-sm text-danger">{errors.customerName}</p>}
        </div>

        <div className="space-y-1.5">
          <Label>Mobile Number *</Label>
          <Input
            type="tel"
            inputMode="numeric"
            maxLength={MOBILE_NUMBER_LENGTH}
            value={mobileNumber}
            onChange={(e) => {
              setMobileNumber(sanitizeMobileNumber(e.target.value));
              setErrors((prev) => ({ ...prev, mobileNumber: "" }));
            }}
            placeholder="10-digit mobile number"
          />
          {errors.mobileNumber && <p className="text-sm text-danger">{errors.mobileNumber}</p>}
        </div>

        <div className="space-y-1.5">
          <Label>Delivery Address *</Label>
          <Textarea
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setErrors((prev) => ({ ...prev, address: "" }));
            }}
            placeholder="House/street, area, city, state"
          />
          {errors.address && <p className="text-sm text-danger">{errors.address}</p>}
        </div>

        <div className="space-y-1.5">
          <Label>PIN Code *</Label>
          <Input
            inputMode="numeric"
            maxLength={6}
            value={pinCode}
            onChange={(e) => {
              setPinCode(e.target.value.replace(/\D/g, ""));
              setErrors((prev) => ({ ...prev, pinCode: "" }));
            }}
            placeholder="6-digit PIN code"
          />
          {errors.pinCode && <p className="text-sm text-danger">{errors.pinCode}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <QuantityStepper
            label="Track Tyre — Front"
            value={quantityFront}
            onChange={(next) => {
              setQuantityFront(next);
              setErrors((prev) => ({ ...prev, quantityFront: "" }));
            }}
          />
          <QuantityStepper
            label="Track Tyre — Back"
            value={quantityBack}
            onChange={(next) => {
              setQuantityBack(next);
              setErrors((prev) => ({ ...prev, quantityFront: "" }));
            }}
          />
        </div>
        {errors.quantityFront && <p className="-mt-2 text-sm text-danger">{errors.quantityFront}</p>}

        {hasSelection && (
          <div className="space-y-2 rounded-[10px] bg-neutral-100 px-4 py-3">
            <Label htmlFor="order-amount">Amount to Pay *</Label>
            {isLoadingPrices ? (
              <p className="text-sm text-neutral-500">Calculating...</p>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold text-neutral-500">&#8377;</span>
                  <Input
                    id="order-amount"
                    inputMode="decimal"
                    className="bg-white text-lg font-bold"
                    value={amountInput}
                    onChange={(e) => {
                      setAmountTouched(true);
                      setAmountInput(maskAmountInput(e.target.value));
                      setErrors((prev) => ({ ...prev, amount: "" }));
                    }}
                    placeholder="0.00"
                  />
                </div>
                <p className="text-xs text-neutral-500">
                  {hasUnpricedSelection
                    ? "Enter the amount our team quoted you, then pay that amount below."
                    : "If our team quoted you a different amount, enter it here and pay that amount."}
                </p>
              </>
            )}
            {errors.amount && <p className="text-sm text-danger">{errors.amount}</p>}
          </div>
        )}

        {paymentConfig && (
          <PaymentDetailsCard
            upiId={paymentConfig.upiId}
            payeeName={paymentConfig.payeeName}
            qrImageUrl={paymentConfig.qrImageUrl}
          />
        )}

        <div className="space-y-1.5">
          <Label>Payment Screenshot *</Label>
          <div
            className={cn(
              "flex items-center gap-3 rounded-[10px] border border-dashed p-2 transition-colors",
              "border-neutral-200"
            )}
          >
            <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-neutral-200 bg-neutral-50">
              {screenshotPreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- local object URL preview, not a remote asset
                <img src={screenshotPreviewUrl} alt="" className="size-full object-cover" />
              ) : (
                <ImageOff className="size-5 text-neutral-300" />
              )}
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="size-4" />
              {screenshotFile ? "Replace" : "Upload"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
          {errors.screenshot && <p className="text-sm text-danger">{errors.screenshot}</p>}
        </div>

        {errors.form && <p className="text-sm text-danger">{errors.form}</p>}

        <Button type="submit" variant="primary" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Submitting...
            </>
          ) : (
            "Submit Order"
          )}
        </Button>
      </fieldset>
    </form>
  );
}
