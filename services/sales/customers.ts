import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

export class CustomerNotFoundError extends Error {
  constructor(id: string) {
    super(`Customer ${id} not found.`);
    this.name = "CustomerNotFoundError";
  }
}

export interface CustomerRow {
  id: string;
  name: string;
  mobileNumber: string;
  address: string | null;
  createdAt: string;
}

type CustomerDbRow = {
  id: string;
  name: string;
  mobile_number: string;
  address: string | null;
  created_at: string;
};

const SELECT_COLUMNS = "id, name, mobile_number, address, created_at";

function mapRow(row: CustomerDbRow): CustomerRow {
  return {
    id: row.id,
    name: row.name,
    mobileNumber: row.mobile_number,
    address: row.address,
    createdAt: row.created_at,
  };
}

/**
 * Auto-suggest as staff types a mobile number (or name) into the Customer
 * field (scope doc §2) — matches on either, since a returning customer might
 * be easier to find by name. Capped at 10 results; this is a suggestion
 * dropdown, not a paginated directory search.
 */
export async function searchCustomers(
  supabase: SupabaseClient<Database>,
  query: string
): Promise<CustomerRow[]> {
  const term = query.trim().replace(/[,()]/g, " ");
  if (!term) return [];

  const { data, error } = await supabase
    .from("customers")
    .select(SELECT_COLUMNS)
    .or(`name.ilike.%${term}%,mobile_number.ilike.%${term}%`)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) throw new Error(error.message);
  return ((data ?? []) as CustomerDbRow[]).map(mapRow);
}

/** Exact match by mobile number — auto-fills name/address on a known number (SALE-002). */
export async function getCustomerByMobile(
  supabase: SupabaseClient<Database>,
  mobileNumber: string
): Promise<CustomerRow | null> {
  const { data, error } = await supabase
    .from("customers")
    .select(SELECT_COLUMNS)
    .eq("mobile_number", mobileNumber.trim())
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? mapRow(data as CustomerDbRow) : null;
}

/**
 * Full customer list for the New Sale picker, fetched once at page load so
 * the Mobile Number field can filter client-side as staff type — no
 * per-keystroke network round trip (that was the slow, debounced-search
 * version this replaces). A single garage's customer base stays small enough
 * (low thousands at most) for "fetch everything up front" to be the right
 * call; capped at 5000 as a sanity ceiling, not an expected real limit.
 */
export async function listAllCustomersForPicker(supabase: SupabaseClient<Database>): Promise<CustomerRow[]> {
  const { data, error } = await supabase
    .from("customers")
    .select(SELECT_COLUMNS)
    .order("name", { ascending: true })
    .limit(5000);

  if (error) throw new Error(error.message);
  return ((data ?? []) as CustomerDbRow[]).map(mapRow);
}

/** Powers the Customer Detail page (doc/customer-vehicle-scope.md §2b). */
export async function getCustomerById(supabase: SupabaseClient<Database>, id: string): Promise<CustomerRow> {
  const { data, error } = await supabase.from("customers").select(SELECT_COLUMNS).eq("id", id).maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new CustomerNotFoundError(id);
  return mapRow(data as CustomerDbRow);
}

export interface CustomerFilters {
  search?: string;
  page: number;
  pageSize: number;
}

/** Search/filter by name or mobile for the Customer directory (doc/customer-vehicle-scope.md §2a). */
export async function listCustomers(
  supabase: SupabaseClient<Database>,
  filters: CustomerFilters
): Promise<{ customers: CustomerRow[]; total: number }> {
  const from = (filters.page - 1) * filters.pageSize;
  const to = from + filters.pageSize - 1;

  let query = supabase
    .from("customers")
    .select(SELECT_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (filters.search) {
    const term = filters.search.trim().replace(/[,()]/g, " ");
    if (term) {
      query = query.or(`name.ilike.%${term}%,mobile_number.ilike.%${term}%`);
    }
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  return {
    customers: ((data ?? []) as CustomerDbRow[]).map(mapRow),
    total: count ?? 0,
  };
}
