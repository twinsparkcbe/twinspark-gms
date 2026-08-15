import { FullScreenLoader } from "@/components/shared/full-screen-loader";

// Definition of Done: every server-fetching page ships with a loading.tsx.
// Uses the same overlay as every other module (Inventory, Purchases, Sales,
// …) rather than a bespoke skeleton — the project's UI consistency rule wants
// one pattern for repeated behaviours, and a per-page skeleton here would be
// the only one in the app.
export default function DashboardLoading() {
  return <FullScreenLoader />;
}
