"use client";

import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// Toasts: top-right, auto-dismiss, colored left border per semantic type
// (twinspark-style-guide.md §7, Feedback).
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      position="top-right"
      // print:hidden — a toast from the action that navigated here (e.g.
      // "Service Job completed") can still be on screen when an invoice
      // page's AutoPrintInvoice fires; without this it gets captured in
      // the print preview, overlapping the invoice header/logo.
      className="toaster group print:hidden"
      icons={{
        success: <CircleCheckIcon className="size-4 text-success" />,
        info: <InfoIcon className="size-4 text-info" />,
        warning: <TriangleAlertIcon className="size-4 text-warning" />,
        error: <OctagonXIcon className="size-4 text-danger" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast: "rounded-lg border shadow-md",
          success: "border-l-4 border-l-success",
          error: "border-l-4 border-l-danger",
          warning: "border-l-4 border-l-warning",
          info: "border-l-4 border-l-info",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
