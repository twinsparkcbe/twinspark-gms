// Single presentational overlay reused in two places: (1) every route's
// loading.tsx, where Next.js renders it as the Suspense fallback while a
// server-fetching page resolves, and (2) GlobalLoaderProvider's overlay,
// shown for client-side async work (table refetches, form submits). Keeping
// one component means both cases always look identical.
export function FullScreenLoader() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-white/70 backdrop-blur-[1px]"
    >
      <div className="flex items-center gap-3 rounded-[14px] border border-neutral-200 bg-white px-5 py-4 shadow-lg">
        <span className="size-6 shrink-0 animate-spin rounded-full border-2 border-neutral-200 border-t-brand-red" />
        <span className="text-sm font-semibold text-neutral-700">Loading…</span>
      </div>
    </div>
  );
}
