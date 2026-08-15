"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingDown, TrendingUp } from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TrendGranularity } from "@/services/dashboard";
import type { ProfitPoint } from "@/services/reports";
import { downloadXlsx, todayForFilename, type XlsxColumn } from "@/lib/xlsx-export";

import { BackToReports } from "./back-to-reports";
import { DownloadXlsxButton } from "./download-xlsx-button";

const GRANULARITY_TABS: { value: TrendGranularity; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: ProfitPoint }[] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-[10px] border border-neutral-200 bg-white px-3 py-2 shadow-md">
      <p className="text-xs font-medium text-neutral-500">{point.fullLabel}</p>
      <p className="text-sm text-neutral-700">Sales: {formatINR(point.salesAmount)}</p>
      <p className="text-sm text-neutral-700">Cost of Goods Sold: {formatINR(point.cogs)}</p>
      <p className={cn("text-sm font-bold", point.profit >= 0 ? "text-success" : "text-danger")}>Profit: {formatINR(point.profit)}</p>
    </div>
  );
}

const STAT_CARD_CLASS = "rounded-xl border border-neutral-200 bg-white p-5 shadow-sm";

export function ProfitReportClient({ daily, weekly, monthly }: { daily: ProfitPoint[]; weekly: ProfitPoint[]; monthly: ProfitPoint[] }) {
  const [granularity, setGranularity] = useState<TrendGranularity>("daily");
  const data = granularity === "daily" ? daily : granularity === "weekly" ? weekly : monthly;
  const hasActivity = data.some((p) => p.salesAmount > 0 || p.cogs > 0);

  const totalSales = data.reduce((sum, p) => sum + p.salesAmount, 0);
  const totalCogs = data.reduce((sum, p) => sum + p.cogs, 0);
  const totalProfit = totalSales - totalCogs;
  const isProfit = totalProfit >= 0;

  const PROFIT_COLUMNS: XlsxColumn<ProfitPoint>[] = [
    { header: "Period", accessor: (p) => p.fullLabel },
    { header: "Sales Amount", accessor: (p) => p.salesAmount },
    { header: "Cost of Goods Sold", accessor: (p) => p.cogs },
    { header: "Profit", accessor: (p) => p.profit },
  ];

  function handleDownload() {
    downloadXlsx(`twinspark-profit-report-${granularity}-${todayForFilename()}`, "Profit Trend", PROFIT_COLUMNS, data);
  }

  return (
    <div className="space-y-6">
      <BackToReports />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">Profit Report</h1>
          <p className="mt-1 text-sm text-neutral-500">Sales Amount minus actual Cost of Goods Sold — Sales-only, same as the Dashboard.</p>
        </div>
        <DownloadXlsxButton onClick={handleDownload} disabled={data.length === 0} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={STAT_CARD_CLASS}>
          <p className="text-sm font-medium text-neutral-500">Sales Amount (shown period)</p>
          <p className="mt-3 text-2xl font-bold tracking-tight text-neutral-900">{formatINR(totalSales)}</p>
        </div>
        <div className={STAT_CARD_CLASS}>
          <p className="text-sm font-medium text-neutral-500">Cost of Goods Sold (shown period)</p>
          <p className="mt-3 text-2xl font-bold tracking-tight text-neutral-900">{formatINR(totalCogs)}</p>
        </div>
        <div className={STAT_CARD_CLASS}>
          <div className="flex items-center gap-2">
            <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", isProfit ? "bg-success-bg text-success" : "bg-danger-bg text-danger")}>
              {isProfit ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
            </div>
            <p className="text-sm font-medium text-neutral-500">Profit (shown period)</p>
          </div>
          <p className={cn("mt-3 text-2xl font-bold tracking-tight", isProfit ? "text-neutral-900" : "text-danger")}>{formatINR(totalProfit)}</p>
        </div>
      </div>

      <div className="rounded-[14px] border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-neutral-900">Sales vs. Cost of Goods Sold</h2>
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
                <Bar dataKey="salesAmount" name="Sales" fill="var(--color-success)" radius={[4, 4, 0, 0]} maxBarSize={32} />
                <Bar dataKey="cogs" name="Cost of Goods Sold" fill="var(--color-warning)" radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-neutral-500">No Sales activity in this period yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
