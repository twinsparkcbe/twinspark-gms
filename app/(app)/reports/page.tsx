import { Boxes, CalendarCheck, FileText, Globe, IndianRupee, PhoneCall, Receipt, ShoppingCart, TrendingUp, Wallet, Wrench } from "lucide-react";

import { requireAdmin } from "@/lib/auth/require-admin";

import { ReportCard } from "@/components/reports/report-card";

// Admin-only per spec §6 — Sales Person has zero access to any report type,
// not even read-only (doc/reports-scope.md §0). A card grid rather than one
// page with nine tabs, since each report has its own distinct filter set.
export default async function ReportsPage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">Reports</h1>
        <p className="mt-1 text-sm text-neutral-500">Pick a report to see how the shop is actually doing.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ReportCard href="/reports/inventory" icon={Boxes} title="Inventory Report" description="Current stock, low/out-of-stock flags, and ageing items by type and brand." />
        <ReportCard href="/reports/purchases" icon={ShoppingCart} title="Purchase Report" description="What you've bought, from whom, and what it cost, over a date range." />
        <ReportCard href="/reports/sales" icon={Receipt} title="Sales Report" description="What's actually selling, by item type, over a date range." />
        <ReportCard href="/reports/service" icon={Wrench} title="Service Report" description="Job volume, labour revenue, and parts consumed, over a date range." />
        <ReportCard href="/reports/service-profit" icon={Wrench} title="Service Profit" description="What service work earns once the spares it used are paid for \u2014 labour, parts sold, parts cost, profit." />
        <ReportCard href="/reports/customer-followup" icon={PhoneCall} title="Customer Follow-Up" description="Customers overdue for a tyre check or service — your call list." />
        <ReportCard href="/reports/ageing-stock" icon={Boxes} title="Ageing Stock" description="Inventory that's been sitting too long — cash tied up on the shelf." />
        <ReportCard href="/reports/revenue" icon={TrendingUp} title="Revenue Report" description="Sales + Service revenue trend, daily, weekly, or monthly." />
        <ReportCard href="/reports/collections" icon={Wallet} title="Collections Report" description="What actually came in, split by cash and UPI, plus what's still outstanding." />
        <ReportCard href="/reports/gst" icon={FileText} title="GST Report" description="Every Sale and Service Job billed with GST — taxable value, rate, and tax collected, for filing." />
        <ReportCard href="/reports/profit" icon={IndianRupee} title="Profit Report" description="Sales Amount minus actual Cost of Goods Sold, trended over time." />
        <ReportCard href="/reports/online-orders" icon={Globe} title="Online Orders Report" description="Track Tyre online channel volume, dispatch, and rejections." />
        {/* Attendance lives in its own module and this is only a link to it —
            no data, service or type crosses between the two. Listed here
            because "where are my reports" is the question this page answers,
            and an admin shouldn't have to know which module owns which
            report. Same Admin-only gate on both sides. */}
        <ReportCard href="/attendance/reports" icon={CalendarCheck} title="Attendance Report" description="Days worked, half days, absences, and salary payable per employee, over any date range." />
      </div>
    </div>
  );
}
