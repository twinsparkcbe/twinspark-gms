"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { IndianRupee } from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TrendGranularity } from "@/services/dashboard";
import type { RevenuePoint } from "@/services/reports";
import { downloadXlsx, todayForFilename, type XlsxColumn } from "@/lib/xlsx-export";

import { BackToReports } from "./back-to-reports";
import { DownloadXlsxButton } from "./download-xlsx-button";

const GRANULARITY_TABS: { value: TrendGranularity; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: RevenuePoint }[] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-[10px] border border-neutral-200 bg-white px-3 py-2 shadow-md">
      <p className="text-xs font-medium text-neutral-500">{point.fullLabel}</p>
      <p className="text-sm font-bold text-neutral-900">Sales: {formatINR(point.salesAmount)}</p>
      <p className="text-sm font-bold text-neutral-900">Service: {formatINR(point.serviceAmount)}</p>
    </div>
  );
}

const STAT_CARD_CLASS = "rounded-xl border border-neutral-200 bg-white p-5 shadow-sm";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={STAT_CARD_CLASS}>
      <div className="flex items-center gap-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-success-bg text-success">
          <IndianRupee className="size-4" />
        </div>
        <p className="text-sm font-medium text-neutral-500">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight text-neutral-900">{value}</p>
    </div>
  );
}

export function RevenueReportClient({ daily, weekly, monthly }: { daily: RevenuePoint[]; weekly: RevenuePoint[]; monthly: RevenuePoint[] }) {
  const [granularity, setGranularity] = useState<TrendGranularity>("daily");
  const data = granularity === "daily" ? daily : granularity === "weekly" ? weekly : monthly;
  const hasActivity = data.some((p) => p.salesAmount > 0 || p.serviceAmount > 0);

  const totalSales = data.reduce((sum, p) => sum + p.salesAmount, 0);
  const totalService = data.reduce((sum, p) => sum + p.serviceAmount, 0);

  const REVENUE_COLUMNS: XlsxColumn<RevenuePoint>[] = [
    { header: "Period", accessor: (p) => p.fullLabel },
    { header: "Sales Amount", accessor: (p) => p.salesAmount },
    { header: "Service Amount", accessor: (p) => p.serviceAmount },
  ];

  function handleDownload() {
    downloadXlsx(`twinspark-revenue-report-${granularity}-${todayForFilename()}`, "Revenue Trend", REVENUE_COLUMNS, data);
  }

  return (
    <div className="space-y-6">
      <BackToReports />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">Revenue Report</h1>
          <p className="mt-1 text-sm text-neutral-500">Sales + Service revenue trend. Online Order revenue is tracked separately.</p>
        </div>
        <DownloadXlsxButton onClick={handleDownload} disabled={data.length === 0} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label={`Sales Revenue (shown period)`} value={formatINR(totalSales)} />
        <StatCard label={`Service Revenue (shown period)`} value={formatINR(totalService)} />
      </div>

      <div className="rounded-[14px] border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-neutral-900">Revenue Trend</h2>
          <Tabs value={granularity} onValueChange={(v) => setGranularity(v as TrendGranularity)}>
            <TabsList>
              {GRANULARITY_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className={cn("mt-4 h-[300px]", !hasActivity && "flex items-center justify-center")}>
          {hasActivity ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-neutral-100)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--color-neutral-500)" }} tickLine={false} axisLine={{ stroke: "var(--color-neutral-200)" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--color-neutral-500)" }} tickLine={false} axisLine={false} width={48} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--color-neutral-50)" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="salesAmount" name="Sales" fill="var(--color-brand-red)" radius={[4, 4, 0, 0]} maxBarSize={32} />
                <Bar dataKey="serviceAmount" name="Service" fill="var(--color-info)" radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-neutral-500">No Sales or Service revenue in this period yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
