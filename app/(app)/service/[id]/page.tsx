import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cache } from "react";

import { canSetServicePaymentStatus } from "@/lib/auth/permissions";
import { requireServiceAccess } from "@/lib/auth/require-service-access";
import { createClient } from "@/lib/supabase/server";
import { getServiceJob, ServiceJobNotFoundError } from "@/services/service";

import { ServiceJobDetailClient } from "@/components/service/service-job-detail-client";

type Params = { id: string };

const getCachedServiceJob = cache((id: string) => createClient().then((supabase) => getServiceJob(supabase, id)));

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const job = await getCachedServiceJob(id);
    return { title: `Service Job ${job.jobNumber}` };
  } catch {
    return { title: "Service Job" };
  }
}

export default async function ServiceJobDetailPage({ params }: { params: Promise<Params> }) {
  const { role } = await requireServiceAccess();
  const { id } = await params;

  const job = await getCachedServiceJob(id).catch((error) => {
    if (error instanceof ServiceJobNotFoundError) notFound();
    throw error;
  });

  return <ServiceJobDetailClient initialJob={job} canSetPaymentStatus={canSetServicePaymentStatus(role)} isAdmin={role === "admin"} />;
}
