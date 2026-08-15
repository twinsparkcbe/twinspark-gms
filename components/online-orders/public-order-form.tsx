"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ImageOff, Loader2, Minus, Plus, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatINR } from "@/lib/format";
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
import { mobileNumberSchema, pinCodeSchema } from "@/services/online-orders/schemas";
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

function QuantityStepper({
  label,
  value,
  price,
  isLoadingPrice,
  onChange,
}: {
  label: string;
  value: number;
  /** null = no active item priced yet for this position. */
  price: number | null;
  isLoadingPrice: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <p className="text-xs text-neutral-500">
        {isLoadingPrice ? "Loading price..." : price !== null ? `${formatINR(price)} / tyre` : "Price unavailable"}
      </p>
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

  // Display-only — the authoritative price is looked up again server-side
  // at submit time (submitOnlineOrder never trusts a client-supplied
  // amount), so this can't be used to under-report what's actually owed.
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

  const totalAmount = quantityFront * (prices.front ?? 0) + quantityBack * (prices.back ?? 0);
  const hasUnpricedSelection = (quantityFront > 0 && prices.front === null) || (quantityBack > 0 && prices.back === null);

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
            price={prices.front}
            isLoadingPrice={isLoadingPrices}
            onChange={(next) => {
              setQuantityFront(next);
              setErrors((prev) => ({ ...prev, quantityFront: "" }));
            }}
          />
          <QuantityStepper
            label="Track Tyre — Back"
            value={quantityBack}
            price={prices.back}
            isLoadingPrice={isLoadingPrices}
            onChange={(next) => {
              setQuantityBack(next);
              setErrors((prev) => ({ ...prev, quantityFront: "" }));
            }}
          />
        </div>
        {errors.quantityFront && <p className="-mt-2 text-sm text-danger">{errors.quantityFront}</p>}

        {(quantityFront > 0 || quantityBack > 0) && (
          <div className="flex items-center justify-between rounded-[10px] bg-neutral-100 px-4 py-3">
            <span className="text-sm font-medium text-neutral-600">Total Amount</span>
            <span className="text-lg font-bold text-neutral-900">{formatINR(totalAmount)}</span>
          </div>
        )}
        {hasUnpricedSelection && (
          <p className="-mt-2 text-xs text-neutral-500">
            One of your selected positions doesn&apos;t have a price set yet — our team will confirm the amount with
            you directly.
          </p>
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
