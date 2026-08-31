import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/shared/brand-mark";
import { AutoPrintInvoice } from "@/components/sales/auto-print-invoice";
import { PrintInvoiceButton } from "@/components/sales/print-invoice-button";
import { BusinessContacts } from "@/components/shared/business-contacts";
import type { JobCardView as JobCardViewModel } from "@/services/service/job-card";

/**
 * Renders a built JobCardView (services/service/job-card.ts) as a
 * print-ready A4 document — available at ANY job status, including Draft
 * (doc §17), unlike the Invoice which only exists once Completed. Same
 * print-stylesheet/window.print() pattern Billing established for the
 * Sales Invoice; AutoPrintInvoice/PrintInvoiceButton are generic enough to
 * reuse as-is (no sales-specific logic in either).
 */
export function JobCardView({ card }: { card: JobCardViewModel }) {
  const { business, customer, vehicle, lines } = card;

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
          {/* Wrapped in a column of its own so the contacts stack under the
              title. Left as bare flex children they sat beside it — the other
              three bills already had a text-right wrapper here because they
              carry a GSTIN line; this one had nothing to stack until now. */}
          <div className="text-right">
            <p className="font-serif text-4xl font-bold tracking-tight text-neutral-900">JOB CARD</p>
            <BusinessContacts contacts={business.contacts} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-8 border-t border-b border-neutral-300 py-2 text-sm">
          <p>
            <span className="font-bold text-neutral-500">Job No.</span>{" "}
            <span className="font-mono font-medium text-neutral-900">{card.jobNumber}</span>
          </p>
          <p>
            <span className="font-bold text-neutral-500">Date:</span> <span className="font-medium text-neutral-900">{card.jobDateLabel}</span>
          </p>
          <p>
            <span className="font-bold text-neutral-500">Status:</span> <span className="font-medium text-neutral-900">{card.statusLabel}</span>
          </p>
          {card.assignedMechanicName && (
            <p>
              <span className="font-bold text-neutral-500">Mechanic:</span>{" "}
              <span className="font-medium text-neutral-900">{card.assignedMechanicName}</span>
            </p>
          )}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-0.5">
            <p className="text-sm font-bold text-neutral-900">CUSTOMER:</p>
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

        {card.complaintNotes && (
          <div className="mt-4">
            <p className="text-sm font-bold text-neutral-900">CUSTOMER COMPLAINT:</p>
            <p className="text-sm text-neutral-700">{card.complaintNotes}</p>
          </div>
        )}

        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="bg-neutral-100 text-xs font-bold tracking-wide text-neutral-700 uppercase">
              <th className="w-12 border border-neutral-300 px-3 py-2 text-left">No</th>
              <th className="border border-neutral-300 px-3 py-2 text-left">Description</th>
              <th className="w-20 border border-neutral-300 px-3 py-2 text-right">Qty</th>
              <th className="w-28 border border-neutral-300 px-3 py-2 text-right">Rate</th>
              <th className="w-28 border border-neutral-300 px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={5} className="border border-neutral-300 px-3 py-4 text-center text-neutral-400">
                  No lines yet
                </td>
              </tr>
            ) : (
              lines.map((line) => (
                <tr key={line.slNo}>
                  <td className="border border-neutral-300 px-3 py-2 align-top text-neutral-500">{line.slNo}</td>
                  <td className="border border-neutral-300 px-3 py-2 align-top font-medium text-neutral-900">
                    {line.description}
                    {line.comboContents && (
                      <ul className="mt-1 ml-2 space-y-0.5 font-normal text-neutral-600">
                        {line.comboContents.map((content, i) => (
                          <li key={i}>· {content}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="border border-neutral-300 px-3 py-2 text-right align-top text-neutral-600">{line.quantityLabel}</td>
                  <td className="border border-neutral-300 px-3 py-2 text-right align-top text-neutral-600">{line.rateLabel}</td>
                  <td className="border border-neutral-300 px-3 py-2 text-right align-top font-medium text-neutral-900">{line.amountLabel}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="mt-6 flex justify-end">
          <div className="w-full max-w-xs space-y-1.5 border border-neutral-300 p-4 text-sm">
            <div className="flex justify-between border-t border-neutral-300 pt-2 text-base font-bold text-neutral-900">
              <span>Total</span>
              <span>{card.totalLabel}</span>
            </div>
          </div>
        </div>

        <p className="mt-8 text-center text-sm text-neutral-500">Thank you for choosing {business.name}.</p>
      </div>
    </div>
  );
}
