import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, ItemType } from "@/types/database.types";

import { brandInputSchema } from "./schemas";

export class DuplicateBrandError extends Error {
  constructor() {
    super("A brand with this name already exists for this item type.");
    this.name = "DuplicateBrandError";
  }
}

export class BrandInUseError extends Error {
  constructor() {
    super("This brand is used by at least one inventory item and can't be deleted.");
    this.name = "BrandInUseError";
  }
}

export interface BrandRow {
  id: string;
  name: string;
  itemType: ItemType;
}

/**
 * Brands are scoped per item type (see 0006_brand_per_item_type.sql). Pass an
 * `itemType` to get only that type's brands (used by the Add/Edit Item form);
 * omit it to list every brand across all types.
 */
export async function listBrands(
  supabase: SupabaseClient<Database>,
  itemType?: ItemType
): Promise<BrandRow[]> {
  let query = supabase.from("brands").select("id, name, item_type").order("name");
  if (itemType) query = query.eq("item_type", itemType);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ id: row.id, name: row.name, itemType: row.item_type }));
}

export async function createBrand(
  supabase: SupabaseClient<Database>,
  rawInput: { name: string; itemType: ItemType }
): Promise<BrandRow> {
  const input = brandInputSchema.parse(rawInput);

  const { data, error } = await supabase
    .from("brands")
    .insert({ name: input.name, item_type: input.itemType })
    .select("id, name, item_type")
    .single();

  if (error) {
    if (error.code === "23505") throw new DuplicateBrandError();
    throw new Error(error.message);
  }
  return { id: data.id, name: data.name, itemType: data.item_type };
}

export async function deleteBrand(supabase: SupabaseClient<Database>, id: string): Promise<void> {
  const { error, data } = await supabase
    .from("brands")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23503") throw new BrandInUseError();
    throw new Error(error.message);
  }
  if (!data) throw new Error("Brand not found.");
}
