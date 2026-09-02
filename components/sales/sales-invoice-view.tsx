import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/shared/brand-mark";
import { BusinessContacts } from "@/components/shared/business-contacts";
import { BillPageSize } from "@/components/shared/bill-page-size";
import type { SalesInvoiceView as SalesInvoiceViewModel } from "@/services/shared/invoice";

import { AutoPrintInvoice } from "./auto-print-invoice";
import { PrintInvoiceButton } from "./print-invoice-button";

/**
 * Renders a built SalesInvoiceView (services/shared/invoice.ts) as a
 * print-ready A4 document, matching the reference layout the owner asked
 * for: bold "INVOICE" heading top-right, Invoice No./Date on one line under
 * a rule, BILL TO block, a fully-gridded QTY/DESCRIPTION/PRICE/TOTAL table,
 * and a boxed totals panel with Grand Total set off inside it.
 *
 * Deliberately a real <table> for the line items (rather than the app's
 * usual div/role="table" grid) — browsers paginate and repeat <thead>
 * across print page breaks far more reliably than a CSS grid does, and this
 * document only ever needs to be read or printed, never interacted with.
 *
 * Installation Charges/GST/Discount rows fold into the same boxed totals
 * panel (the reference template only shows Subtotal/Tax/Discount/Grand
 * Total, but doc/sales-module-scope.md §4/§7 requires Installation Charges
 * to appear as its own line, never blended into Subtotal) — shown only
 * when the sale actually has one.
 *
 * The toolbar (Back / Print) carries `print:hidden` so only the invoice
 * sheet itself is sent to the printer — see app/(app)/layout.tsx for the
 * matching print:hidden on the nav shell.
 */
export function SalesInvoiceView({ invoice }: { invoice: SalesInvoiceViewModel }) {
  const { business, customer, lines, totals } = invoice;

  return (
    <div className="bill-page mx-auto max-w-3xl space-y-4 print:max-w-none print:space-y-0">
      <BillPageSize />
      <AutoPrintInvoice />
      <div className="flex items-center justify-between print:hidden">
        <Button asChild variant="secondary" size="sm">
          <Link href="/sales">
            <ArrowLeft className="size-4" />
            Back to Sales
          </Link>
        </Button>
        <PrintInvoiceButton />
      </div>

      <div className="bill-sheet rounded-[14px] border border-neutral-200 bg-white p-8 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
        {/* Thin brand accent instead of the reference's full watercolor
            wash — a decorative full-bleed background would burn ink on
            every printout; this keeps a touch of identity for free. */}
        <div className="bill-accent -mx-8 -mt-8 mb-6 h-2 bg-brand-gold print:mx-0 print:mt-0" />

        {/* Header: logo + business identity (left) + big INVOICE heading (right) */}
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
            {/* Printed only when this bill actually charges GST — the garage
                also raises non-GST bills, which must not carry the
                registration number. */}
            {business.gstin && totals.gst && (
              <p className="mt-3 text-sm font-bold text-neutral-900">
                GSTIN: <span className="font-mono">{business.gstin}</span>
              </p>
            )}
            <BusinessContacts contacts={business.contacts} className="bill-contacts" />
          </div>
        </div>

        {/* Invoice No. / Date — one line under a rule, per the reference */}
        <div className="mt-4 flex items-center gap-8 border-t border-b border-neutral-300 py-2 text-sm">
          <p>
            <span className="font-bold text-neutral-500">Invoice No.</span>{" "}
            <span className="font-mono font-medium text-neutral-900">{invoice.invoiceNumber}</span>
          </p>
          <p>
            <span className="font-bold text-neutral-500">Date:</span>{" "}
            <span className="font-medium text-neutral-900">{invoice.invoiceDateLabel}</span>
          </p>
        </div>

        {/* Bill To — name + mobile side by side, address on its own row below */}
        <div className="mt-4 space-y-0.5">
          <p className="text-sm font-bold text-neutral-900">BILL TO:</p>
          <div className="mt-1 flex flex-wrap gap-x-8 text-sm text-neutral-700">
            <p>
              <span className="font-bold text-neutral-500">Customer Name:</span> {customer.name}
            </p>
            <p>
              <span className="font-bold text-neutral-500">Mobile Number:</span> {customer.mobile}
            </p>
          </div>
          {customer.addressLines.length > 0 && (
            <p className="text-sm text-neutral-700">
              <span className="font-bold text-neutral-500">Address:</span> {customer.addressLines.join(", ")}
            </p>
          )}
        </div>

        {/* Line items — fully-gridded table, SL NO | DESCRIPTION | PRICE | QTY | TOTAL */}
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
            {lines.map((line) => (
              <tr key={line.slNo}>
                <td className="border border-neutral-300 px-3 py-2 align-top text-neutral-500">{line.slNo}</td>
                <td className="border border-neutral-300 px-3 py-2 align-top">
                  <p className="font-medium text-neutral-900">{line.description}</p>
                  {line.detail && <p className="text-xs text-neutral-500">{line.detail}</p>}
                  {/* A combo bills as one price; its contents print here
                      unpriced so the customer sees what it covered. */}
                  {line.comboContents && (
                    <ul className="mt-1 ml-2 space-y-0.5 text-xs text-neutral-600">
                      {line.comboContents.map((content, i) => (
                        <li key={i}>· {content}</li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="border border-neutral-300 px-3 py-2 text-right align-top text-neutral-600">
                  {line.unitPriceLabel}
                </td>
                <td className="border border-neutral-300 px-3 py-2 text-right align-top text-neutral-600">
                  {line.quantityLabel}
                </td>
                <td className="border border-neutral-300 px-3 py-2 text-right align-top font-medium text-neutral-900">
                  {line.amountLabel}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals — boxed panel, Grand Total set off inside it */}
        <div className="mt-6 flex justify-end">
          <div className="bill-totals w-full max-w-xs space-y-1.5 border border-neutral-300 p-4 text-sm">
            <div className="flex justify-between text-neutral-600">
              <span>Subtotal</span>
              <span className="font-medium text-neutral-900">{totals.subtotalLabel}</span>
            </div>
            {totals.installationTotalLabel && (
              <div className="flex justify-between text-neutral-600">
                <span>Installation Charges</span>
                <span className="font-medium text-neutral-900">{totals.installationTotalLabel}</span>
              </div>
            )}
            {totals.gst && (
              <div className="flex justify-between text-neutral-600">
                <span>Tax ({totals.gst.ratePercentLabel})</span>
                <span className="font-medium text-neutral-900">+ {totals.gst.amountLabel}</span>
              </div>
            )}
            {totals.discount && (
              <div className="flex justify-between text-neutral-600">
                <span>Discount</span>
                <span className="font-medium text-neutral-900">− {totals.discount.amountLabel}</span>
              </div>
            )}
            <div className="bill-grand-total flex justify-between border-t border-neutral-300 pt-2 text-base font-bold text-neutral-900">
              <span>Grand Total</span>
              <span>{totals.grandTotalLabel}</span>
            </div>
            {/* Tender breakdown (0027) — only printed when it was recorded,
                so invoices raised before the feature look unchanged. */}
            {totals.paidByLabel && (
              <div className="flex justify-between border-t border-neutral-200 pt-2 text-neutral-600">
                <span>Paid by</span>
                <span className="font-medium text-neutral-900">{totals.paidByLabel}</span>
              </div>
            )}
            {totals.balanceDueLabel && (
              <div className="flex justify-between font-semibold text-danger">
                <span>Balance due</span>
                <span>{totals.balanceDueLabel}</span>
              </div>
            )}
            {/* Below the total on purpose: a message to the customer, not a
                line in the arithmetic above it. */}
            {totals.comboSavingsLabel && (
              <div className="flex justify-between border-t border-neutral-200 pt-2 font-semibold text-success">
                <span>You saved</span>
                <span>{totals.comboSavingsLabel}</span>
              </div>
            )}
            {totals.paymentPendingLabel && (
              <div className="mt-1 rounded-[6px] border border-danger/40 px-2 py-1 text-center text-xs font-semibold tracking-wide text-danger uppercase">
                {totals.paymentPendingLabel}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="bill-footer mt-8 text-center text-sm text-neutral-500">Thank you for your business!</p>
      </div>
    </div>
  );
}
