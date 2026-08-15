import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import {
  getDashboardStats,
  getOpenWorkCounts,
  getStockAlerts,
  getTrackTyreSalesTrend,
  istGreeting,
  istTodayLabel,
} from "@/services/dashboard";

import { DashboardActionBar } from "@/components/dashboard/dashboard-action-bar";
import { DashboardStatsSection } from "@/components/dashboard/dashboard-stats-section";
import { NeedsAttentionPanel } from "@/components/dashboard/needs-attention-panel";
import { TrackTyreSalesChart } from "@/components/dashboard/track-tyre-sales-chart";

// Admin-only per spec §4.2 / §6 permission matrix — Sales Person is
// redirected the same way as every other Admin-only module (Inventory,
// Purchases, Reports, Settings). See doc/dashboard-scope.md §4.
export default async function DashboardPage() {
  await requireAdmin();
  const supabase = await createClient();

  // The greeting and date are resolved here, on the server, and handed down as
  // strings — never derived during a client render (services/dashboard/greeting.ts).
  const now = new Date();

  // All three chart granularities are fetched upfront (each is a tiny
  // 6-14 row result) so the Daily/Weekly/Monthly tab switch is instant,
  // client-side, no extra round trip.
  const [stats, alerts, openWork, dailyTrend, weeklyTrend, monthlyTrend] = await Promise.all([
    getDashboardStats(supabase),
    getStockAlerts(supabase),
    getOpenWorkCounts(supabase),
    getTrackTyreSalesTrend(supabase, "daily"),
    getTrackTyreSalesTrend(supabase, "weekly"),
    getTrackTyreSalesTrend(supabase, "monthly"),
  ]);

  return (
    <div className="space-y-5">
      <DashboardStatsSection
        initialStats={stats}
        greeting={istGreeting(now)}
        todayLabel={istTodayLabel(now)}
        actionBar={<DashboardActionBar ordersToDispatch={openWork.ordersToDispatch} />}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TrackTyreSalesChart daily={dailyTrend} weekly={weeklyTrend} monthly={monthlyTrend} />
        </div>
        <NeedsAttentionPanel alerts={alerts} openWork={openWork} />
      </div>
    </div>
  );
}
