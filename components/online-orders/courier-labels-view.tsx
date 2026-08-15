import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BUSINESS_INFO } from "@/lib/business-info";
import type { OnlineOrderRow } from "@/services/online-orders";

import { AutoPrintLabels } from "./auto-print-labels";
import { PrintLabelsButton } from "./print-labels-button";

function quantityLabel(order: OnlineOrderRow): string {
  const parts: string[] = [];
  if (order.quantityFront > 0) parts.push(`${order.quantityFront} Front`);
  if (order.quantityBack > 0) parts.push(`${order.quantityBack} Back`);
  return parts.join(", ") || "—";
}

/** First 8 characters of the order id, uppercased — a courier never needs
 * the full UUID, just something short staff can match back to the order if
 * a package ever needs tracing. */
function orderRef(order: OnlineOrderRow): string {
  return order.id.slice(0, 8).toUpperCase();
}

/**
 * Courier Label Export (spec §3.17) — classic shipping-label layout: a
 * FROM (this garage) / TO (customer) address block split by a vertical
 * rule, with an Order Ref / Quantity strip underneath split by the same
 * rule — same shape as a standard courier "ship from / ship to" label
 * template. One label per row, full page width (labels get cut and taped
 * to individual packages, not read side by side). `break-inside: avoid` so
 * a label never splits across a page boundary. Same browser-print approach
 * as the Sales/Service invoices — no PDF library.
 */
export function CourierLabelsView({ orders }: { orders: OnlineOrderRow[] }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4 print:max-w-none print:space-y-0">
      <AutoPrintLabels />
      <div className="flex items-center justify-between print:hidden">
        <Button asChild variant="secondary" size="sm">
          <Link href="/online-orders">
            <ArrowLeft className="size-4" />
            Back to Online Orders
          </Link>
        </Button>
        <PrintLabelsButton />
      </div>

      {orders.length === 0 ? (
        <p className="text-sm text-neutral-500 print:hidden">No orders found for the selected labels.</p>
      ) : (
        <div className="flex flex-col gap-6 print:gap-4">
          {orders.map((order) => (
            <div
              key={order.id}
              className="w-full overflow-hidden rounded-[10px] border-2 border-neutral-900 [break-inside:avoid] print:rounded-none"
            >
              <div className="grid grid-cols-2 divide-x-2 divide-neutral-900">
                <div className="space-y-1 p-4">
                  <p className="text-xs font-bold tracking-wide text-neutral-500 uppercase">From:</p>
                  <p className="font-bold text-neutral-900 uppercase">{BUSINESS_INFO.name}</p>
                  {BUSINESS_INFO.addressLines.map((line) => (
                    <p key={line} className="text-sm text-neutral-700">
                      {line}
                    </p>
                  ))}
                  {BUSINESS_INFO.phone && <p className="text-sm text-neutral-700">{BUSINESS_INFO.phone}</p>}
                </div>

                <div className="space-y-1.5 p-4">
                  <p className="text-xs font-bold tracking-wide text-neutral-500 uppercase">To:</p>
                  <p className="text-sm">
                    <span className="font-semibold text-neutral-500">Name: </span>
                    <span className="font-bold text-neutral-900 uppercase">{order.customerName}</span>
                  </p>
                  <p className="text-sm">
                    <span className="font-semibold text-neutral-500">Address: </span>
                    <span className="text-neutral-700">{order.address}</span>
                  </p>
                  <p className="text-sm">
                    <span className="font-semibold text-neutral-500">PIN Code: </span>
                    <span className="font-semibold text-neutral-900">{order.pinCode}</span>
                  </p>
                  <p className="text-sm">
                    <span className="font-semibold text-neutral-500">Mobile Number: </span>
                    {/* Highlighted — the one detail a courier is most likely to
                        need to read at a glance/call if the address is unclear. */}
                    <span className="inline-block rounded bg-yellow-200 px-1.5 py-0.5 font-mono text-base font-bold text-neutral-900">
                      {order.mobileNumber}
                    </span>
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 divide-x-2 divide-neutral-900 border-t-2 border-neutral-900">
                <div className="p-4 text-sm">
                  <span className="font-semibold text-neutral-500">Order Ref: </span>
                  <span className="font-mono font-bold text-neutral-900">{orderRef(order)}</span>
                </div>
                <div className="p-4 text-sm">
                  <span className="font-semibold text-neutral-500">Quantity: </span>
                  <span className="font-bold text-neutral-900">{quantityLabel(order)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
