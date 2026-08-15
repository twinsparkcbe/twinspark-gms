"use client";

import { useEffect } from "react";

/**
 * Fires the browser's print dialog as soon as the labels page mounts — same
 * "arrive to print, not to read" reasoning as Sales/Service's
 * AutoPrintInvoice, but simpler: labels have no images to wait on, so this
 * just prints on the next tick after mount.
 */
export function AutoPrintLabels() {
  useEffect(() => {
    const handle = setTimeout(() => window.print(), 100);
    return () => clearTimeout(handle);
  }, []);

  return null;
}
