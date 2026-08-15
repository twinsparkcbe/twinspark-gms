import { FullScreenLoader } from "@/components/shared/full-screen-loader";

// Definition of Done: every server-fetching page ships with a loading.tsx —
// present now so Reports is covered as soon as it gains real data fetching.
export default function ReportsLoading() {
  return <FullScreenLoader />;
}
