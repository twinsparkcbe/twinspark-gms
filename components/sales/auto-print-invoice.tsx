"use client";

import { useEffect } from "react";

/**
 * Fires the browser's print dialog as soon as the invoice page mounts —
 * every visit to /sales/[id]/invoice or /service/[id]/invoice (fresh
 * sale/completion redirect, or reprint from the table) exists to print, so
 * this skips the extra manual "Print Invoice" click. That button stays on
 * the page as a fallback for anyone who dismisses the dialog and wants to
 * reopen it without a full reload.
 *
 * Waits for every <img> on the page (the business logo, chiefly) to finish
 * loading before printing — calling window.print() unconditionally on mount
 * used to beat next/image's fetch, producing a print preview with a
 * missing/blank logo. A broken image (error) still counts as "settled" so
 * printing is never blocked by it, and a short fallback timeout guarantees
 * print fires even if an image never emits load/error at all.
 */
export function AutoPrintInvoice() {
  useEffect(() => {
    let printed = false;
    function triggerPrint() {
      if (printed) return;
      printed = true;
      window.print();
    }

    const pending = Array.from(document.images).filter((img) => !img.complete);
    if (pending.length === 0) {
      triggerPrint();
      return;
    }

    let remaining = pending.length;
    function onSettle() {
      remaining -= 1;
      if (remaining <= 0) triggerPrint();
    }
    for (const img of pending) {
      img.addEventListener("load", onSettle, { once: true });
      img.addEventListener("error", onSettle, { once: true });
    }

    const fallback = setTimeout(triggerPrint, 1500);

    return () => {
      clearTimeout(fallback);
      for (const img of pending) {
        img.removeEventListener("load", onSettle);
        img.removeEventListener("error", onSettle);
      }
    };
  }, []);

  return null;
}
