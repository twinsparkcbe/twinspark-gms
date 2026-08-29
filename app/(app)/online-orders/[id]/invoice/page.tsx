import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireOnlineOrdersAccess } from "@/lib/auth/require-online-orders-access";
import { BUSINESS_INFO } from "@/lib/business-info";
import { createClient } from "@/lib/supabase/server";
import { getOnlineOrder, OnlineOrderNotFoundError } from "@/services/online-orders";

import { OnlineOrderInvoiceView } from "@/components/online-orders/online-order-invoice-view";

type Params = { id: string };

// Deduped per request (same pattern as app/(app)/sales/[id]/invoice/page.tsx)
// — generateMetadata() and the page component both need the order.
const getCachedOrder = cache((id: string) => createClient().then((supabase) => getOnlineOrder(supabase, id)));

// Drives the browser tab title *and* the filename Chrome's "Save as PDF"
// destination suggests, so a saved invoice is named after its number.
export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const order = await getCachedOrder(id);
    return { title: order.invoiceNumber ? `Invoice ${order.invoiceNumber}` : "Invoice" };
  } catch {
    return { title: "Invoice" };
  }
}

/**
 * Invoice for a dispatched online order. Same access rule as the rest of the
 * Online Orders module — Administrator, Sales Person and Mechanic can all
 * view and print it.
 *
 * A 404 for anything not yet dispatched, rather than a half-filled document:
 * the invoice number is only assigned at dispatch (0037), so an order still
 * waiting has nothing to print. The Invoice button only appears on
 * dispatched rows, so this is a guard against a hand-typed URL, not a path
 * anyone reaches by clicking.
 */
export default async function OnlineOrderInvoicePage({ params }: { params: Promise<Params> }) {
  await requireOnlineOrdersAccess();
  const { id } = await params;

  const order = await getCachedOrder(id).catch((error) => {
    if (error instanceof OnlineOrderNotFoundError) notFound();
    throw error;
  });

  if (order.status !== "DISPATCHED" || !order.invoiceNumber) notFound();

  return <OnlineOrderInvoiceView order={order} business={BUSINESS_INFO} />;
}
