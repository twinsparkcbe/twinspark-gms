import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

import { generalServicePackageInputSchema, specificServiceInputSchema } from "./schemas";

export class DuplicateCatalogEntryError extends Error {
  constructor(kind: "General Service Package" | "Specific Service") {
    super(`A ${kind} with this name already exists.`);
    this.name = "DuplicateCatalogEntryError";
  }
}

export class CatalogEntryNotFoundError extends Error {
  constructor(kind: "General Service Package" | "Specific Service") {
    super(`${kind} not found.`);
    this.name = "CatalogEntryNotFoundError";
  }
}

/** Raised when a catalog entry has been used and so can't be deleted. */
export class CatalogEntryInUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogEntryInUseError";
  }
}

export interface CatalogDefaultItemRow {
  inventoryItemId: string;
  itemName: string;
  defaultQuantity: number;
}

export interface GeneralServicePackageRow {
  id: string;
  name: string;
  includedItems: string[];
  serviceCharge: number;
  isActive: boolean;
  createdAt: string;
  /** Auto-populates Parts Used when this package is picked on a job (doc §3, Revision 3). */
  defaultItems: CatalogDefaultItemRow[];
}

export interface SpecificServiceRow {
  id: string;
  name: string;
  defaultCharge: number | null;
  isActive: boolean;
  createdAt: string;
  defaultItems: CatalogDefaultItemRow[];
}

const PACKAGE_COLUMNS =
  "id, name, included_items, service_charge, is_active, created_at, general_service_package_items(inventory_item_id, default_quantity, inventory_items(product_name))";
const SPECIFIC_COLUMNS =
  "id, name, default_charge, is_active, created_at, specific_service_items(inventory_item_id, default_quantity, inventory_items(product_name))";

type DefaultItemJoinedRow = {
  inventory_item_id: string;
  default_quantity: number;
  inventory_items: { product_name: string } | { product_name: string }[] | null;
};

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function mapDefaultItems(rows: DefaultItemJoinedRow[] | null | undefined): CatalogDefaultItemRow[] {
  return (rows ?? []).map((row) => ({
    inventoryItemId: row.inventory_item_id,
    itemName: firstOrSelf(row.inventory_items)?.product_name ?? "Deleted item",
    defaultQuantity: row.default_quantity,
  }));
}

function mapPackage(row: {
  id: string;
  name: string;
  included_items: string[];
  service_charge: number;
  is_active: boolean;
  created_at: string;
  general_service_package_items?: DefaultItemJoinedRow[];
}): GeneralServicePackageRow {
  return {
    id: row.id,
    name: row.name,
    includedItems: row.included_items ?? [],
    serviceCharge: Number(row.service_charge),
    isActive: row.is_active,
    createdAt: row.created_at,
    defaultItems: mapDefaultItems(row.general_service_package_items),
  };
}

function mapSpecific(row: {
  id: string;
  name: string;
  default_charge: number | null;
  is_active: boolean;
  created_at: string;
  specific_service_items?: DefaultItemJoinedRow[];
}): SpecificServiceRow {
  return {
    id: row.id,
    name: row.name,
    defaultCharge: row.default_charge !== null ? Number(row.default_charge) : null,
    isActive: row.is_active,
    createdAt: row.created_at,
    defaultItems: mapDefaultItems(row.specific_service_items),
  };
}

function toRpcItems(items: { inventoryItemId: string; defaultQuantity: number }[]) {
  return items.map((i) => ({ inventory_item_id: i.inventoryItemId, default_quantity: i.defaultQuantity }));
}

/** `activeOnly` powers the New Service Job picker (only offer live
 * packages); the Manage Catalog screen passes false to show deactivated
 * entries too, since they're never deleted (doc §16). */
export async function listGeneralServicePackages(
  supabase: SupabaseClient<Database>,
  activeOnly = false
): Promise<GeneralServicePackageRow[]> {
  let query = supabase.from("general_service_packages").select(PACKAGE_COLUMNS).order("name");
  if (activeOnly) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Parameters<typeof mapPackage>[0][]).map(mapPackage);
}

async function getGeneralServicePackage(supabase: SupabaseClient<Database>, id: string): Promise<GeneralServicePackageRow> {
  const { data, error } = await supabase.from("general_service_packages").select(PACKAGE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new CatalogEntryNotFoundError("General Service Package");
  return mapPackage(data as unknown as Parameters<typeof mapPackage>[0]);
}

/**
 * Creates a General Service Package and atomically links its default
 * inventory items (doc §3, Revision 3) via create_general_service_package()
 * — a single RPC call rather than a package insert followed by a separate
 * items insert, so a failure partway through never leaves a package with a
 * half-written item list.
 */
export async function createGeneralServicePackage(
  supabase: SupabaseClient<Database>,
  rawInput: unknown
): Promise<GeneralServicePackageRow> {
  const input = generalServicePackageInputSchema.parse(rawInput);

  const { data, error } = await supabase.rpc("create_general_service_package", {
    p_name: input.name,
    p_included_items: input.includedItems,
    p_service_charge: input.serviceCharge,
    p_items: toRpcItems(input.defaultItems),
  });

  if (error) {
    if (error.code === "23505") throw new DuplicateCatalogEntryError("General Service Package");
    throw new Error(error.message);
  }
  if (typeof data !== "string") throw new Error("Unexpected response from create_general_service_package.");

  return getGeneralServicePackage(supabase, data);
}

export async function updateGeneralServicePackage(
  supabase: SupabaseClient<Database>,
  id: string,
  rawInput: unknown
): Promise<GeneralServicePackageRow> {
  const input = generalServicePackageInputSchema.parse(rawInput);

  const { error } = await supabase.rpc("update_general_service_package", {
    p_id: id,
    p_name: input.name,
    p_included_items: input.includedItems,
    p_service_charge: input.serviceCharge,
    p_items: toRpcItems(input.defaultItems),
  });

  if (error) {
    if (error.code === "23505") throw new DuplicateCatalogEntryError("General Service Package");
    if (error.code === "P0002") throw new CatalogEntryNotFoundError("General Service Package");
    throw new Error(error.message);
  }

  return getGeneralServicePackage(supabase, id);
}

/** Deactivate only — never hard-deleted (doc §16), since past Service Jobs
 * keep a snapshot of the name/rate they used, but the catalog FK itself
 * must stay resolvable. */
export async function setGeneralServicePackageActive(
  supabase: SupabaseClient<Database>,
  id: string,
  isActive: boolean
): Promise<GeneralServicePackageRow> {
  const { error } = await supabase.from("general_service_packages").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);
  return getGeneralServicePackage(supabase, id);
}

export async function listSpecificServices(
  supabase: SupabaseClient<Database>,
  activeOnly = false
): Promise<SpecificServiceRow[]> {
  let query = supabase.from("specific_services").select(SPECIFIC_COLUMNS).order("name");
  if (activeOnly) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Parameters<typeof mapSpecific>[0][]).map(mapSpecific);
}

async function getSpecificService(supabase: SupabaseClient<Database>, id: string): Promise<SpecificServiceRow> {
  const { data, error } = await supabase.from("specific_services").select(SPECIFIC_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new CatalogEntryNotFoundError("Specific Service");
  return mapSpecific(data as unknown as Parameters<typeof mapSpecific>[0]);
}

export async function createSpecificService(
  supabase: SupabaseClient<Database>,
  rawInput: unknown
): Promise<SpecificServiceRow> {
  const input = specificServiceInputSchema.parse(rawInput);

  const { data, error } = await supabase.rpc("create_specific_service", {
    p_name: input.name,
    p_default_charge: input.defaultCharge ?? null,
    p_items: toRpcItems(input.defaultItems),
  });

  if (error) {
    if (error.code === "23505") throw new DuplicateCatalogEntryError("Specific Service");
    throw new Error(error.message);
  }
  if (typeof data !== "string") throw new Error("Unexpected response from create_specific_service.");

  return getSpecificService(supabase, data);
}

export async function updateSpecificService(
  supabase: SupabaseClient<Database>,
  id: string,
  rawInput: unknown
): Promise<SpecificServiceRow> {
  const input = specificServiceInputSchema.parse(rawInput);

  const { error } = await supabase.rpc("update_specific_service", {
    p_id: id,
    p_name: input.name,
    p_default_charge: input.defaultCharge ?? null,
    p_items: toRpcItems(input.defaultItems),
  });

  if (error) {
    if (error.code === "23505") throw new DuplicateCatalogEntryError("Specific Service");
    if (error.code === "P0002") throw new CatalogEntryNotFoundError("Specific Service");
    throw new Error(error.message);
  }

  return getSpecificService(supabase, id);
}

export async function setSpecificServiceActive(
  supabase: SupabaseClient<Database>,
  id: string,
  isActive: boolean
): Promise<SpecificServiceRow> {
  const { error } = await supabase.from("specific_services").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);
  return getSpecificService(supabase, id);
}

/**
 * Hard delete for a catalog entry that nothing references — the mistake case
 * (typo, accidental duplicate). Anything already used on a job, or contained
 * in a combo, is refused by `0023_catalog_delete.sql` with an explanation;
 * those must be deactivated instead so history keeps resolving (doc §16).
 */
export async function deleteGeneralServicePackage(supabase: SupabaseClient<Database>, id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_general_service_package", { p_id: id });
  if (error) {
    if (error.code === "23503") throw new CatalogEntryInUseError(error.message);
    if (error.code === "P0002") throw new CatalogEntryNotFoundError("General Service Package");
    throw new Error(error.message);
  }
}

export async function deleteSpecificService(supabase: SupabaseClient<Database>, id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_specific_service", { p_id: id });
  if (error) {
    if (error.code === "23503") throw new CatalogEntryInUseError(error.message);
    if (error.code === "P0002") throw new CatalogEntryNotFoundError("Specific Service");
    throw new Error(error.message);
  }
}
