import { Skeleton } from "@/components/ui/skeleton";

// Every server-fetching route gets one (nextjs_ssr_hydration_standard) — this
// page awaits the sale plus five pickers, so without it the counter stares at a
// blank screen while an edit loads.
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Skeleton className="h-9 w-32 rounded-[10px]" />
      <Skeleton className="h-12 w-72 rounded-[10px]" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="space-y-6">
          <Skeleton className="h-44 rounded-[14px]" />
          <Skeleton className="h-72 rounded-[14px]" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-56 rounded-[14px]" />
          <Skeleton className="h-40 rounded-[14px]" />
        </div>
      </div>
    </div>
  );
}
