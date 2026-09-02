import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/shared/brand-mark";
import { formatDate, formatINR } from "@/lib/format";
import type { BusinessInfo } from "@/services/shared/invoice";
import type { OnlineOrderRow } from "@/services/online-orders";

import { PrintInvoiceButton } from "@/components/sales/print-invoice-button";
import { BusinessContacts } from "@/components/shared/business-contacts";
import { BillPageSize } from "@/components/shared/bill-page-size";

/**
 * Print-ready invoice for a dispatched online order
 * (doc/online-orders-revenue-scope.md §4). Laid out to match the Sales
 * invoice so a customer who buys online and later walks into the shop gets
 * two documents that look like they came from the same business.
 *
 * Kept separate from SalesInvoiceView rather than generalised: an online
 * order has no line-level GST, no installation charges, no combos and no
 * tender split — it is always two possible tyre lines paid in full by UPI.
 * Bending the sales view around those absences would make both harder to
 * read than having two small, honest components.
 *
 * No `<AutoPrintInvoice />`: a sale opens its invoice the moment it is rung
 * up, so auto-printing is right there. This page is only ever reached by
 * someone deliberately clicking Invoice on an already-dispatched order, and
 * firing the print dialog at them uninvited would be a surprise.
 */
export function OnlineOrderInvoiceView({ order, business }: { order: OnlineOrderRow; business: BusinessInfo }) {
  const lines: { description: string; unitPrice: number | null; quantity: number }[] = [];
  if (order.quantityFront > 0) {
    lines.push({ description: "Track Tyre — Front", unitPrice: order.unitPriceFront, quantity: order.quantityFront });
  }
  if (order.quantityBack > 0) {
    lines.push({ description: "Track Tyre — Back", unitPrice: order.unitPriceBack, quantity: order.quantityBack });
  }

  const linesTotal = lines.reduce((sum, line) => sum + (line.unitPrice ?? 0) * line.quantity, 0);
  // When the customer entered the amount they were quoted, the tyre lines do
  // not add up to what they paid. Printing the two figures with no
  // explanation makes the invoice look like it cannot do arithmetic, so the
  // difference is shown as its own labelled line.
  const adjustment = Math.round((order.totalAmount - linesTotal) * 100) / 100;

  return (
    <div className="bill-page mx-auto max-w-3xl space-y-4 print:max-w-none print:space-y-0">
      <BillPageSize />
      <div className="flex items-center justify-between print:hidden">
        <Button asChild variant="secondary" size="sm">
          <Link href="/online-orders">
            <ArrowLeft className="size-4" />
            Back to Online Orders
          </Link>
        </Button>
        <PrintInvoiceButton />
      </div>

      <div className="bill-sheet rounded-[14px] border border-neutral-200 bg-white p-8 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <div className="bill-accent -mx-8 -mt-8 mb-6 h-2 bg-brand-gold print:mx-0 print:mt-0" />

        <div className="bill-header flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <BrandMark variant="invoice" className="bill-logo size-14" />
            <div>
              <p className="bill-business-name text-lg font-extrabold text-neutral-900">{business.name}</p>
              {business.addressLines.map((line) => (
                <p key={line} className="text-sm text-neutral-500">
                  {line}
                </p>
              ))}
              {business.phone && <p className="text-sm text-neutral-500">{business.phone}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="bill-title font-serif text-4xl font-bold tracking-tight text-neutral-900">INVOICE</p>
            {/* No GSTIN: an online order carries no GST at all (there are no
                tax fields on it), and printing the registration number on a
                bill that charges no tax would be wrong. */}
            <p className="mt-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase">Online Order</p>
            <BusinessContacts contacts={business.contacts} className="bill-contacts" />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-1 border-t border-b border-neutral-300 py-2 text-sm">
          <p>
            <span className="font-bold text-neutral-500">Invoice No.</span>{" "}
            <span className="font-mono font-medium text-neutral-900">{order.invoiceNumber}</span>
          </p>
          <p>
            <span className="font-bold text-neutral-500">Date:</span>{" "}
            <span className="font-medium text-neutral-900">
              {order.dispatchedAt ? formatDate(order.dispatchedAt) : "—"}
            </span>
          </p>
          <p>
            <span className="font-bold text-neutral-500">Order Ref:</span>{" "}
            <span className="font-mono text-xs text-neutral-600">{order.id}</span>
          </p>
        </div>

        <div className="mt-4 space-y-0.5">
          <p className="text-sm font-bold text-neutral-900">DELIVER TO:</p>
          <div className="mt-1 flex flex-wrap gap-x-8 text-sm text-neutral-700">
            <p>
              <span className="font-bold text-neutral-500">Customer Name:</span> {order.customerName}
            </p>
            <p>
              <span className="font-bold text-neutral-500">Mobile Number:</span> {order.mobileNumber}
            </p>
          </div>
          <p className="text-sm text-neutral-700">
            <span className="font-bold text-neutral-500">Address:</span> {order.address}
          </p>
          <p className="text-sm text-neutral-700">
            <span className="font-bold text-neutral-500">PIN Code:</span> {order.pinCode}
          </p>
        </div>

        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="bg-neutral-100 text-xs font-bold tracking-wide text-neutral-700 uppercase">
              <th className="w-12 border border-neutral-300 px-3 py-2 text-left">#</th>
              <th className="border border-neutral-300 px-3 py-2 text-left">Description</th>
              <th className="w-32 border border-neutral-300 px-3 py-2 text-right">Price</th>
              <th className="w-20 border border-neutral-300 px-3 py-2 text-right">Qty</th>
              <th className="w-32 border border-neutral-300 px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={line.description}>
                <td className="border border-neutral-300 px-3 py-2 align-top text-neutral-500">{index + 1}</td>
                <td className="border border-neutral-300 px-3 py-2 align-top font-medium text-neutral-900">
                  {line.description}
                </td>
                <td className="border border-neutral-300 px-3 py-2 text-right align-top text-neutral-600">
                  {line.unitPrice === null ? "—" : formatINR(line.unitPrice)}
                </td>
                <td className="border border-neutral-300 px-3 py-2 text-right align-top text-neutral-600">
                  {line.quantity}
                </td>
                <td className="border border-neutral-300 px-3 py-2 text-right align-top font-medium text-neutral-900">
                  {line.unitPrice === null ? "—" : formatINR(line.unitPrice * line.quantity)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 flex justify-end">
          <div className="bill-totals w-full max-w-xs space-y-1.5 border border-neutral-300 p-4 text-sm">
            <div className="flex justify-between text-neutral-600">
              <span>Subtotal</span>
              <span className="font-medium text-neutral-900">{formatINR(linesTotal)}</span>
            </div>
            {adjustment !== 0 && (
              <div className="flex justify-between text-neutral-600">
                <span>{adjustment < 0 ? "Discount" : "Adjustment"}</span>
                <span className="font-medium text-neutral-900">
                  {adjustment < 0 ? "− " : "+ "}
                  {formatINR(Math.abs(adjustment))}
                </span>
              </div>
            )}
            <div className="bill-grand-total flex justify-between border-t border-neutral-300 pt-2 text-base font-bold text-neutral-900">
              <span>Grand Total</span>
              <span>{formatINR(order.totalAmount)}</span>
            </div>
            <div className="flex justify-between border-t border-neutral-200 pt-2 text-neutral-600">
              <span>Paid by</span>
              <span className="font-medium text-neutral-900">UPI</span>
            </div>
          </div>
        </div>

        <p className="bill-footer mt-8 text-center text-xs text-neutral-400">
          Thank you for your order. Paid online before dispatch — no balance due.
        </p>
      </div>
    </div>
  );
}
