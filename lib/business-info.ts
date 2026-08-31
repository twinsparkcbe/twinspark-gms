import type { BusinessInfo } from "@/services/shared/invoice";

/**
 * Invoice header identity — confirmed name/address (BILL-040). No Settings
 * module exists to hold this in the database, so it's a source-controlled
 * constant the developer edits directly rather than a per-invoice input.
 *
 * `phone` is deliberately left unset (BILL-041): the invoice views hide that
 * row entirely when omitted rather than printing a blank line — drop the real
 * value in here once available, no other code changes needed.
 *
 * `gstin` is the garage's registered GSTIN. It prints in the invoice header
 * only on invoices that actually charge GST — a non-GST bill must not carry
 * the number.
 *
 * `contacts` prints in the top-right of every bill (components/shared/
 * business-contacts.tsx). Edit the numbers here and all four bills follow —
 * Sales Invoice, Service Invoice, Online Order Invoice and the Job Card.
 */
export const BUSINESS_INFO: BusinessInfo = {
  name: "Twinspark Tyres And Bike Garage",
  addressLines: ["2a, FCI Rd, Ex.Servicemen Colony, VG Rao Nagar, Ganapathy", "Coimbatore, Tamil Nadu 641006"],
  gstin: "33FUWPP1730B1ZM",
  // phone: "",
  contacts: [
    { label: "Office", numbers: ["7200351766"] },
    { label: "Online", numbers: ["7418847085", "8438907759"] },
    { label: "Customer care", numbers: ["9361017105"] },
  ],
};
