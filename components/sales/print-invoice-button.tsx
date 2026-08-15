"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Isolated to its own tiny client component so the invoice page itself
 * (and the bulk of the invoice markup) can stay a server component —
 * window.print() is the only bit of interactivity this document needs. */
export function PrintInvoiceButton() {
  return (
    <Button type="button" variant="primary" size="sm" onClick={() => window.print()}>
      <Printer className="size-4" />
      Print Invoice
    </Button>
  );
}
