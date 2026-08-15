import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/shared/brand-mark";
import { AutoPrintInvoice } from "@/components/sales/auto-print-invoice";
import { PrintInvoiceButton } from "@/components/sales/print-invoice-button";
import type { ServiceInvoiceView as ServiceInvoiceViewModel } from "@/services/shared/invoice";

/**
 * Renders a built ServiceInvoiceView (services/shared/invoice.ts) — same
 * print-ready A4 layout convention as SalesInvoiceView, but with two
 * separate line-item tables (Service Lines, then Inventory Used) instead
 * of one, per the strict "never blended" rule (doc §18). Labour/service
 * charges never appear on a Sales invoice and vice versa — this is Service's
 * own distinct layout on the same shared engine.
 */
export function ServiceInvoiceView({ invoice }: { invoice: ServiceInvoiceViewModel }) {
  const { business, customer, vehicle, serviceLines, inventoryLines, totals } = invoice;

  return (
    <div className="mx-auto max-w-3xl space-y-4 print:max-w-none print:space-y-0">
      <AutoPrintInvoice />
      <div className="flex items-center justify-between print:hidden">
        <Button asChild variant="secondary" size="sm">
          <Link href="/service">
            <ArrowLeft className="size-4" />
            Back to Service
          </Link>
        </Button>
        <PrintInvoiceButton />
      </div>

      <div className="rounded-[14px] border border-neutral-200 bg-white p-8 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <div className="-mx-8 -mt-8 mb-6 h-2 bg-brand-gold print:mx-0 print:mt-0" />

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <BrandMark variant="invoice" className="size-14" />
            <div>
              <p className="text-lg font-extrabold text-neutral-900">{business.name}</p>
              {business.addressLines.map((line) => (
                <p key={line} className="text-sm text-neutral-500">
                  {line}
                </p>
              ))}
              {business.phone && <p className="text-sm text-neutral-500">{business.phone}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="font-serif text-4xl font-bold tracking-tight text-neutral-900">SERVICE INVOICE</p>
            {/* Printed only when this bill actually charges GST — the garage
                also raises non-GST bills, which must not carry the
                registration number. */}
            {business.gstin && totals.gst && (
              <p className="mt-3 text-sm font-bold text-neutral-900">
                GSTIN: <span className="font-mono">{business.gstin}</span>
              </p>
            )}
          </div>
        </div>

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

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-0.5">
            <p className="text-sm font-bold text-neutral-900">BILL TO:</p>
            <p className="text-sm text-neutral-700">{customer.name}</p>
            <p className="text-sm text-neutral-700">{customer.mobile}</p>
            {customer.addressLines.length > 0 && <p className="text-sm text-neutral-700">{customer.addressLines.join(", ")}</p>}
          </div>
          <div className="space-y-0.5">
            <p className="text-sm font-bold text-neutral-900">VEHICLE:</p>
            <p className="text-sm text-neutral-700">
              {vehicle.number} — {vehicle.model}
            </p>
            <p className="text-sm text-neutral-700">Odometer: {vehicle.odometerLabel}</p>
          </div>
        </div>

        <p className="mt-5 text-xs font-bold tracking-wide text-neutral-500 uppercase">Service Charges</p>
        <table className="mt-1 w-full border-collapse text-sm">
          <thead>
            <tr className="bg-neutral-100 text-xs font-bold tracking-wide text-neutral-700 uppercase">
              <th className="w-12 border border-neutral-300 px-3 py-2 text-left">#</th>
              <th className="border border-neutral-300 px-3 py-2 text-left">Description</th>
              <th className="w-20 border border-neutral-300 px-3 py-2 text-right">Qty</th>
              <th className="w-28 border border-neutral-300 px-3 py-2 text-right">Rate</th>
              <th className="w-28 border border-neutral-300 px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {serviceLines.map((line) => (
              <tr key={line.slNo}>
                <td className="border border-neutral-300 px-3 py-2 align-top text-neutral-500">{line.slNo}</td>
                <td className="border border-neutral-300 px-3 py-2 align-top font-medium text-neutral-900">
                  {line.description}
                  {/* A combo bills as one price; its contents print here
                      unpriced so the customer can see what it covered. */}
                  {line.comboContents && (
                    <ul className="mt-1 ml-2 space-y-0.5 font-normal text-neutral-600">
                      {line.comboContents.map((content, i) => (
                        <li key={i}>· {content}</li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="border border-neutral-300 px-3 py-2 text-right align-top text-neutral-600">{line.quantityLabel}</td>
                <td className="border border-neutral-300 px-3 py-2 text-right align-top text-neutral-600">{line.unitPriceLabel}</td>
                <td className="border border-neutral-300 px-3 py-2 text-right align-top font-medium text-neutral-900">{line.amountLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {inventoryLines.length > 0 && (
          <>
            <p className="mt-5 text-xs font-bold tracking-wide text-neutral-500 uppercase">Parts &amp; Consumables Used</p>
            <table className="mt-1 w-full border-collapse text-sm">
              <thead>
                <tr className="bg-neutral-100 text-xs font-bold tracking-wide text-neutral-700 uppercase">
                  <th className="w-12 border border-neutral-300 px-3 py-2 text-left">#</th>
                  <th className="border border-neutral-300 px-3 py-2 text-left">Description</th>
                  <th className="w-20 border border-neutral-300 px-3 py-2 text-right">Qty</th>
                  <th className="w-28 border border-neutral-300 px-3 py-2 text-right">Unit Price</th>
                  <th className="w-28 border border-neutral-300 px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {inventoryLines.map((line) => (
                  <tr key={line.slNo}>
                    <td className="border border-neutral-300 px-3 py-2 align-top text-neutral-500">{line.slNo}</td>
                    <td className="border border-neutral-300 px-3 py-2 align-top font-medium text-neutral-900">{line.description}</td>
                    <td className="border border-neutral-300 px-3 py-2 text-right align-top text-neutral-600">{line.quantityLabel}</td>
                    <td className="border border-neutral-300 px-3 py-2 text-right align-top text-neutral-600">{line.unitPriceLabel}</td>
                    <td className="border border-neutral-300 px-3 py-2 text-right align-top font-medium text-neutral-900">{line.amountLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="mt-6 flex justify-end">
          <div className="w-full max-w-xs space-y-1.5 border border-neutral-300 p-4 text-sm">
            <div className="flex justify-between text-neutral-600">
              <span>Service Subtotal</span>
              <span className="font-medium text-neutral-900">{totals.subtotalLabel}</span>
            </div>
            {totals.inventoryTotalLabel && (
              <div className="flex justify-between text-neutral-600">
                <span>Parts Used</span>
                <span className="font-medium text-neutral-900">{totals.inventoryTotalLabel}</span>
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
            <div className="flex justify-between border-t border-neutral-300 pt-2 text-base font-bold text-neutral-900">
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
            {/* Sits below the total on purpose: it's a message to the
                customer, not a line in the arithmetic above it. */}
            {totals.comboSavingsLabel && (
              <div className="flex justify-between border-t border-neutral-200 pt-2 font-semibold text-success">
                <span>You saved</span>
                <span>{totals.comboSavingsLabel}</span>
              </div>
            )}
          </div>
        </div>

        <p className="mt-8 text-center text-sm text-neutral-500">Thank you for your business!</p>
      </div>
    </div>
  );
}
