import type { Metadata } from "next";

import { requireOnlineOrdersAccess } from "@/lib/auth/require-online-orders-access";
import { createClient } from "@/lib/supabase/server";
import { listOnlineOrdersByIds } from "@/services/online-orders";

import { CourierLabelsView } from "@/components/online-orders/courier-labels-view";

export const metadata: Metadata = { title: "Courier Labels" };

type SearchParams = { ids?: string };

// Courier Label Export (spec §3.17) — same access tier as the rest of
// Online Orders (both Administrator and Sales Person). `ids` is a
// comma-separated list of online_orders ids selected from the queue table.
export default async function CourierLabelsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireOnlineOrdersAccess();
  const { ids } = await searchParams;
  const orderIds = (ids ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const supabase = await createClient();
  const orders = await listOnlineOrdersByIds(supabase, orderIds);

  return <CourierLabelsView orders={orders} />;
}
