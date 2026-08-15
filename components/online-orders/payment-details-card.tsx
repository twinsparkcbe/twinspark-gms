"use client";

import { useState } from "react";
import { Check, Copy, ImageOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Read-only "where to pay" card — rendered on the public /order form above
 * the payment screenshot upload (doc/payment-qr-config-scope.md §3), and
 * reused verbatim inside the Settings / Payment admin form dialog as the
 * "exactly what the customer will see" live preview (§2). One component,
 * one markup, so the two surfaces can never quietly drift apart.
 *
 * QR-first layout: the code is what a customer actually scans, so it's the
 * dominant element (large, centered, full-width up to a cap) with the payee
 * details as supporting text underneath — not the small side-by-side
 * thumbnail this started as, which made the QR too small to scan comfortably
 * off a phone screen.
 *
 * No `label` prop, on purpose — the admin's config label ("Twinspark GPay",
 * "Backup UPI", etc.) is an internal identifier for telling configs apart in
 * Settings / Payment, never something a customer should see here.
 *
 * `qrImageUrl` is deliberately just a URL, not a config id — the admin
 * preview passes a local blob: object URL for an unsaved file, the public
 * page passes the storage public URL. Display only: no validation,
 * reconciliation, or link to any order record (out of scope by design).
 */
export function PaymentDetailsCard({
  upiId,
  payeeName,
  qrImageUrl,
  className,
}: {
  upiId: string;
  payeeName: string;
  qrImageUrl: string | null;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(upiId);
      setCopied(true);
      toast.success("UPI ID copied.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — copy the UPI ID manually.");
    }
  }

  return (
    <div className={cn("rounded-[14px] border border-neutral-200 bg-neutral-50 p-5", className)}>
      <p className="text-center text-xs font-semibold tracking-wide text-neutral-500 uppercase">Scan &amp; Pay</p>

      <div className="mx-auto mt-3 flex aspect-square w-full max-w-[280px] items-center justify-center overflow-hidden rounded-[12px] border border-neutral-200 bg-white">
        {qrImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Supabase public storage URL / local blob preview, not a next/image-optimizable remote asset list
          <img src={qrImageUrl} alt={`${payeeName} payment QR code`} className="size-full object-contain p-3" />
        ) : (
          <ImageOff className="size-12 text-neutral-300" />
        )}
      </div>

      <div className="mt-4 flex flex-col items-center gap-1 text-center">
        <p className="text-sm text-neutral-500">Pay to</p>
        <p className="text-lg font-semibold text-neutral-900">{payeeName}</p>

        <div className="mt-1 flex items-center gap-2">
          <span className="rounded-[8px] bg-white px-3 py-1.5 font-mono text-sm text-neutral-900">{upiId}</span>
          <Button type="button" variant="ghost" size="icon" className="size-9" aria-label="Copy UPI ID" onClick={handleCopy}>
            {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
          </Button>
        </div>

        <p className="mt-3 max-w-xs text-xs text-neutral-500">
          Scan the QR code or pay to this UPI ID, then upload your payment screenshot below.
        </p>
      </div>
    </div>
  );
}
