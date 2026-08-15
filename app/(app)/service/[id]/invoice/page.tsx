import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireServiceAccess } from "@/lib/auth/require-service-access";
import { BUSINESS_INFO } from "@/lib/business-info";
import { createClient } from "@/lib/supabase/server";
import { getServiceJob, ServiceJobNotFoundError } from "@/services/service";
import { buildServiceInvoiceView, ServiceInvoiceNotAvailableError } from "@/services/shared/invoice";

import { ServiceInvoiceView } from "@/components/service/service-invoice-view";

type Params = { id: string };

const getCachedServiceJob = cache((id: string) => createClient().then((supabase) => getServiceJob(supabase, id)));

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const job = await getCachedServiceJob(id);
    return { title: job.invoiceNumber ? `Invoice ${job.invoiceNumber}` : "Service Invoice" };
  } catch {
    return { title: "Service Invoice" };
  }
}

// Only ever reachable for a COMPLETED job (doc §18) — redirect-to-detail
// keeps this from ever rendering a blank/broken invoice for an open job,
// same principle as buildServiceInvoiceView() throwing instead of guessing.
export default async function ServiceInvoicePage({ params }: { params: Promise<Params> }) {
  await requireServiceAccess();
  const { id } = await params;

  const job = await getCachedServiceJob(id).catch((error) => {
    if (error instanceof ServiceJobNotFoundError) notFound();
    throw error;
  });

  let invoice;
  try {
    invoice = buildServiceInvoiceView(job, BUSINESS_INFO);
  } catch (error) {
    if (error instanceof ServiceInvoiceNotAvailableError) notFound();
    throw error;
  }

  return <ServiceInvoiceView invoice={invoice} />;
}
