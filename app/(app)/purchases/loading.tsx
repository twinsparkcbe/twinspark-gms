import { FullScreenLoader } from "@/components/shared/full-screen-loader";

// Next.js auto-wraps page.tsx in a Suspense boundary using this file as the
// fallback (Definition of Done: every server-fetching page ships with a
// loading.tsx). Shows the same overlay as every other loading state in the
// app — see components/shared/global-loader.tsx.
export default function PurchasesLoading() {
  return <FullScreenLoader />;
}
