import { FullScreenLoader } from "@/components/shared/full-screen-loader";

// Definition of Done: every server-fetching page ships with a loading.tsx.
// This page itself has no data fetch, but the shared shell keeps the same
// convention as every other route in the app.
export default function PublicOrderLoading() {
  return <FullScreenLoader />;
}
