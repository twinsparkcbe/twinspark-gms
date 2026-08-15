"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Isolated to its own client component so CourierLabelsView (the bulk of
 * the labels markup) can stay a Server Component — window.print() is the
 * only interactivity this page needs. A Server Component can't pass an
 * inline onClick (a function) as a prop, only a Client Component can; same
 * split already used for Sales' PrintInvoiceButton. */
export function PrintLabelsButton() {
  return (
    <Button type="button" variant="primary" size="sm" onClick={() => window.print()}>
      <Printer className="size-4" />
      Print Labels
    </Button>
  );
}
