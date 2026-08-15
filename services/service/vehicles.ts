import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

export class VehicleNotFoundError extends Error {
  constructor(id: string) {
    super(`Vehicle ${id} not found.`);
    this.name = "VehicleNotFoundError";
  }
}

export interface VehicleRow {
  id: string;
  customerId: string;
  vehicleNumber: string;
  vehicleModel: string;
  latestOdometerReading: number | null;
  createdAt: string;
}

type VehicleDbRow = {
  id: string;
  customer_id: string;
  vehicle_number: string;
  vehicle_model: string;
  latest_odometer_reading: number | null;
  created_at: string;
};

const SELECT_COLUMNS = "id, customer_id, vehicle_number, vehicle_model, latest_odometer_reading, created_at";

function mapRow(row: VehicleDbRow): VehicleRow {
  return {
    id: row.id,
    customerId: row.customer_id,
    vehicleNumber: row.vehicle_number,
    vehicleModel: row.vehicle_model,
    latestOdometerReading: row.latest_odometer_reading,
    createdAt: row.created_at,
  };
}

export interface VehicleWithOwnerRow extends VehicleRow {
  customerName: string;
  customerMobile: string;
}

type OwnerJoin = { name: string; mobile_number: string };

type VehicleWithOwnerDbRow = VehicleDbRow & {
  customers: OwnerJoin | OwnerJoin[] | null;
};

// Same single-object-vs-array ambiguity every other embedded-relation mapper
// in this codebase handles (see services/service/jobs.ts's firstOrSelf) —
// PostgREST returns a single joined row as an object for a to-one relation,
// but the generated types don't always narrow it that way.
function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function mapVehicleWithOwner(row: VehicleWithOwnerDbRow): VehicleWithOwnerRow {
  const owner = firstOrSelf(row.customers);
  return {
    ...mapRow(row),
    customerName: owner?.name ?? "Unknown customer",
    customerMobile: owner?.mobile_number ?? "",
  };
}

/**
 * Full vehicle list for the New/Edit Service Job picker, fetched once at
 * page load so the Vehicle Number field can filter client-side as staff
 * type — same "fetch everything up front, filter locally" call as Sales'
 * listAllCustomersForPicker (doc §22 — keyboard-first, no per-keystroke
 * network round trip).
 */
export async function listAllVehiclesForPicker(supabase: SupabaseClient<Database>): Promise<VehicleRow[]> {
  const { data, error } = await supabase
    .from("vehicles")
    .select(SELECT_COLUMNS)
    .order("vehicle_number", { ascending: true })
    .limit(5000);

  if (error) throw new Error(error.message);
  return ((data ?? []) as VehicleDbRow[]).map(mapRow);
}

/** Every vehicle registered to one customer — used by the customer detail
 * view (doc §8) and to pre-filter the Vehicle field once a returning
 * customer is selected. */
export async function listVehiclesForCustomer(
  supabase: SupabaseClient<Database>,
  customerId: string
): Promise<VehicleRow[]> {
  const { data, error } = await supabase
    .from("vehicles")
    .select(SELECT_COLUMNS)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as VehicleDbRow[]).map(mapRow);
}

/**
 * Full vehicle list with owner name/mobile joined in — powers the Vehicles
 * tab of the Customer & Vehicle module (doc/customer-vehicle-scope.md §2c),
 * where a mechanic looks a bike up by plate number without knowing whose it
 * is. Same "fetch once, filter client-side" shape as
 * listAllVehiclesForPicker; Admin-only in practice since the tab itself is
 * hidden from Sales Person, but the function has no role logic of its own —
 * that's enforced by the page/component calling it, same separation every
 * other query function in this codebase keeps.
 */
export async function listVehiclesWithOwner(supabase: SupabaseClient<Database>): Promise<VehicleWithOwnerRow[]> {
  const { data, error } = await supabase
    .from("vehicles")
    .select(`${SELECT_COLUMNS}, customers!inner(name, mobile_number)`)
    .order("vehicle_number", { ascending: true })
    .limit(5000);

  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as VehicleWithOwnerDbRow[]).map(mapVehicleWithOwner);
}

/** Powers the Vehicle Detail page (doc/customer-vehicle-scope.md §2d). */
export async function getVehicleWithOwner(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<VehicleWithOwnerRow> {
  const { data, error } = await supabase
    .from("vehicles")
    .select(`${SELECT_COLUMNS}, customers!inner(name, mobile_number)`)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new VehicleNotFoundError(id);
  return mapVehicleWithOwner(data as unknown as VehicleWithOwnerDbRow);
}
