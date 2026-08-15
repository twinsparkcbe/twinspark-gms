import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireServiceAccess } from "@/lib/auth/require-service-access";
import { BUSINESS_INFO } from "@/lib/business-info";
import { createClient } from "@/lib/supabase/server";
import { getServiceJob, ServiceJobNotFoundError } from "@/services/service";
import { buildJobCardView } from "@/services/service/job-card";

import { JobCardView } from "@/components/service/job-card-view";

type Params = { id: string };

const getCachedServiceJob = cache((id: string) => createClient().then((supabase) => getServiceJob(supabase, id)));

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const job = await getCachedServiceJob(id);
    return { title: `Job Card ${job.jobNumber}` };
  } catch {
    return { title: "Job Card" };
  }
}

// Available at ANY job status, including Draft — printable before
// completion (doc §17), unlike the Invoice which only exists once Completed.
export default async function ServiceJobCardPage({ params }: { params: Promise<Params> }) {
  await requireServiceAccess();
  const { id } = await params;

  const job = await getCachedServiceJob(id).catch((error) => {
    if (error instanceof ServiceJobNotFoundError) notFound();
    throw error;
  });

  const card = buildJobCardView(job, BUSINESS_INFO);

  return <JobCardView card={card} />;
}
