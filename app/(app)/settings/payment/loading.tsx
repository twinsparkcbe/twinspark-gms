import { FullScreenLoader } from "@/components/shared/full-screen-loader";

// Definition of Done: every server-fetching page ships with a loading.tsx —
// present now so Settings / Payment is covered as soon as it gains real data
// fetching (same convention as settings/users/loading.tsx).
export default function SettingsPaymentLoading() {
  return <FullScreenLoader />;
}
