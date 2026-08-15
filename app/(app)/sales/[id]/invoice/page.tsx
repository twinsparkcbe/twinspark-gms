import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireSalesAccess } from "@/lib/auth/require-sales-access";
import { BUSINESS_INFO } from "@/lib/business-info";
import { createClient } from "@/lib/supabase/server";
import { getSale, SaleNotFoundError } from "@/services/sales";
import { buildSalesInvoiceView } from "@/services/shared/invoice";

import { SalesInvoiceView } from "@/components/sales/sales-invoice-view";

type Params = { id: string };

// Deduped per request (same pattern as lib/auth/get-cached-user.ts) —
// generateMetadata() and the page component both need the sale, and
// without this they'd each hit Supabase separately for the same row.
const getCachedSale = cache((id: string) => createClient().then((supabase) => getSale(supabase, id)));

// Drives the browser tab title *and* the filename Chrome's "Save as PDF"
// print destination suggests, so a printed/saved invoice is named after its
// invoice number instead of a generic page title.
export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const sale = await getCachedSale(id);
    return { title: `Invoice ${sale.invoiceNumber}` };
  } catch {
    return { title: "Invoice" };
  }
}

// Reprint entry point (SalesTable's "Invoice" button) and the immediate
// post-sale redirect both land here — same access rule as the rest of
// Sales (doc/billing-invoice-scope.md §3): both Administrator and Sales
// Person can view/print.
export default async function SaleInvoicePage({ params }: { params: Promise<Params> }) {
  await requireSalesAccess();
  const { id } = await params;

  const sale = await getCachedSale(id).catch((error) => {
    if (error instanceof SaleNotFoundError) notFound();
    throw error;
  });

  const invoice = buildSalesInvoiceView(sale, BUSINESS_INFO);

  return <SalesInvoiceView invoice={invoice} />;
}
