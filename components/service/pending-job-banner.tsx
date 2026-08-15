"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ServiceJobRow } from "@/services/service";

import { JOB_STATUS_LABELS } from "./status-badge";

/**
 * Pending Job Detection (doc §19) — non-blocking advisory shown when the
 * selected vehicle already has an active (non-terminal) Service Job. Staff
 * can open it or dismiss and continue creating a new one regardless — this
 * never blocks the form (doc §21's "don't interrupt with unnecessary
 * restrictions").
 */
export function PendingJobBanner({ jobs, onDismiss }: { jobs: ServiceJobRow[]; onDismiss: () => void }) {
  if (jobs.length === 0) return null;
  const job = jobs[0];

  return (
    <div className="flex items-start gap-3 rounded-[10px] border border-warning/40 bg-warning/10 px-4 py-3">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-neutral-900">
          This vehicle already has an active Service Job — {job.jobNumber} ({JOB_STATUS_LABELS[job.status]}).
        </p>
        {jobs.length > 1 && <p className="mt-0.5 text-neutral-600">{jobs.length - 1} more active job(s) on this vehicle.</p>}
        <div className="mt-2 flex gap-2">
          <Button asChild variant="secondary" size="sm" className="rounded-[8px]">
            <Link href={`/service/${job.id}`}>Open {job.jobNumber}</Link>
          </Button>
          <Button type="button" variant="ghost" size="sm" className="rounded-[8px]" onClick={onDismiss}>
            Continue anyway
          </Button>
        </div>
      </div>
    </div>
  );
}
