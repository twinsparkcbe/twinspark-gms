import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

import { isComboAvailable } from "./availability";
import { comboDuplicateInputSchema, comboInputSchema, mergeDuplicateComponents, type ComboInput } from "./schemas";
import type { ComboComponentRow, ComboRow } from "./types";

/**
 * Combo Offers — data layer (plan §3.A/§3.B).
 *
 * Writes go exclusively through the SECURITY DEFINER functions in
 * `0021_combo_offers.sql` — same "one function is the only path" rule as
 * every other multi-table write here, because creating a combo has to write
 * the combo row and its components atomically.
 *
 * Shared by Service and Sales; nothing in this file knows which module is
 * calling.
 */

export class DuplicateComboError extends Error {
  constructor() {
    super("A combo with this name already exists.");
    this.name = "DuplicateComboError";
  }
}

export class ComboNotFoundError extends Error {
  constructor(id: string) {
    super(`Combo ${id} not found.`);
    this.name = "ComboNotFoundError";
  }
}

export class ComboValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComboValidationError";
  }
}

/** Raised when a combo has history behind it and so can't be deleted. The
 * message from the database names the counts, so it's surfaced verbatim. */
export class ComboInUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComboInUseError";
  }
}

export class ComboAuthError extends Error {
  constructor() {
    super("Only Administrators can manage Combo Offers.");
    this.name = "ComboAuthError";
  }
}

const COMBO_COLUMNS = `
  id, name, description, combo_price, valid_from, valid_to, is_active, created_at,
  combo_components (
    id, position, component_type, general_service_package_id, specific_service_id, inventory_item_id, quantity, pricing,
    general_service_packages (name, service_charge),
    specific_services (name, default_charge),
    inventory_items (product_name, selling_price, purchase_price, available_quantity)
  )
`;

type JoinedName<T> = T | T[] | null;

type ComboComponentJoinedRow = {
  id: string;
  position: number;
  component_type: "PACKAGE" | "SPECIFIC" | "ITEM";
  general_service_package_id: string | null;
  specific_service_id: string | null;
  inventory_item_id: string | null;
  quantity: number;
  pricing: "INCLUDED" | "EXTRA";
  general_service_packages: JoinedName<{ name: string; service_charge: number }>;
  specific_services: JoinedName<{ name: string; default_charge: number | null }>;
  inventory_items: JoinedName<{ product_name: string; selling_price: number; purchase_price: number; available_quantity: number }>;
};

type ComboJoinedRow = {
  id: string;
  name: string;
  description: string | null;
  combo_price: number;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
  created_at: string;
  combo_components: ComboComponentJoinedRow[] | null;
};

/** PostgREST returns an embedded row as an object or a single-element array
 * depending on the relationship it infers — same unwrap as jobs.ts. */
function firstOrSelf<T>(value: JoinedName<T>): T | null {
  if (value === null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function mapComponent(row: ComboComponentJoinedRow): ComboComponentRow {
  const pkg = firstOrSelf(row.general_service_packages);
  const svc = firstOrSelf(row.specific_services);
  const item = firstOrSelf(row.inventory_items);

  // Catalog rows are soft-deactivated, never deleted, so a missing join
  // means genuinely broken data rather than normal lifecycle — surface it
  // rather than rendering a blank row.
  const name = pkg?.name ?? svc?.name ?? item?.product_name ?? "Deleted item";
  const unitPrice = pkg ? pkg.service_charge : svc ? svc.default_charge : item ? item.selling_price : null;

  return {
    id: row.id,
    position: row.position,
    componentType: row.component_type,
    generalServicePackageId: row.general_service_package_id,
    specificServiceId: row.specific_service_id,
    inventoryItemId: row.inventory_item_id,
    quantity: row.quantity,
    pricing: row.pricing,
    name,
    unitPrice,
    unitPurchasePrice: item ? item.purchase_price : null,
    availableQuantity: item ? item.available_quantity : null,
  };
}

function mapCombo(row: ComboJoinedRow): ComboRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    comboPrice: Number(row.combo_price),
    validFrom: row.valid_from,
    validTo: row.valid_to,
    isActive: row.is_active,
    createdAt: row.created_at,
    components: (row.combo_components ?? []).map(mapComponent).sort((a, b) => a.position - b.position),
  };
}

function toRpcComponents(input: ComboInput) {
  return mergeDuplicateComponents(input.components).map((component) => ({
    component_type: component.componentType,
    general_service_package_id: component.generalServicePackageId ?? null,
    specific_service_id: component.specificServiceId ?? null,
    inventory_item_id: component.inventoryItemId ?? null,
    quantity: component.quantity,
    pricing: component.pricing,
  }));
}

/** Maps Postgres error codes to typed errors, matching the existing catalog
 * conventions (0017 raises the same codes). */
function throwMapped(error: { code?: string; message: string }): never {
  if (error.code === "23505") throw new DuplicateComboError();
  if (error.code === "23503") throw new ComboInUseError(error.message);
  if (error.code === "P0002") throw new ComboValidationError(error.message);
  if (error.code === "42501") throw new ComboAuthError();
  if (error.code === "22023") throw new ComboValidationError(error.message);
  throw new Error(error.message);
}

export async function getCombo(supabase: SupabaseClient<Database>, id: string): Promise<ComboRow> {
  const { data, error } = await supabase.from("combos").select(COMBO_COLUMNS).eq("id", id).maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new ComboNotFoundError(id);

  return mapCombo(data as unknown as ComboJoinedRow);
}

/**
 * @param activeOnly True for the pickers (Service job, Sale) — false for the
 *   management screen, which must still show switched-off combos so they can
 *   be switched back on.
 */
export async function listCombos(supabase: SupabaseClient<Database>, activeOnly = false): Promise<ComboRow[]> {
  let query = supabase.from("combos").select(COMBO_COLUMNS).order("name", { ascending: true });
  if (activeOnly) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as ComboJoinedRow[]).map(mapCombo);
}

export async function createCombo(supabase: SupabaseClient<Database>, rawInput: ComboInput): Promise<ComboRow> {
  const input = comboInputSchema.parse(rawInput);

  const { data, error } = await supabase.rpc("create_combo", {
    p_name: input.name,
    p_description: input.description ?? null,
    p_combo_price: input.comboPrice,
    p_valid_from: input.validFrom ?? null,
    p_valid_to: input.validTo ?? null,
    p_components: toRpcComponents(input),
  });

  if (error) throwMapped(error);

  return getCombo(supabase, data as unknown as string);
}

export async function updateCombo(supabase: SupabaseClient<Database>, id: string, rawInput: ComboInput): Promise<ComboRow> {
  const input = comboInputSchema.parse(rawInput);

  const { error } = await supabase.rpc("update_combo", {
    p_id: id,
    p_name: input.name,
    p_description: input.description ?? null,
    p_combo_price: input.comboPrice,
    p_valid_from: input.validFrom ?? null,
    p_valid_to: input.validTo ?? null,
    p_components: toRpcComponents(input),
  });

  if (error) throwMapped(error);

  return getCombo(supabase, id);
}

/**
 * Clone for the next tyre fitment (plan §6.1). The copy comes back inactive
 * on purpose — a half-edited clone still carrying the donor's tyres must not
 * be sellable before someone has swapped them.
 */
export async function duplicateCombo(supabase: SupabaseClient<Database>, comboId: string, newName: string): Promise<ComboRow> {
  const input = comboDuplicateInputSchema.parse({ comboId, newName });

  const { data, error } = await supabase.rpc("duplicate_combo", { p_id: input.comboId, p_new_name: input.newName });

  if (error) throwMapped(error);

  return getCombo(supabase, data as unknown as string);
}

export async function setComboActive(supabase: SupabaseClient<Database>, id: string, isActive: boolean): Promise<ComboRow> {
  const { error } = await supabase.rpc("set_combo_active", { p_id: id, p_is_active: isActive });

  if (error) throwMapped(error);

  return getCombo(supabase, id);
}

/**
 * Hard delete — only ever succeeds for a combo nothing references (see
 * `0023_catalog_delete.sql` for why). Anything with history behind it must be
 * deactivated instead, and the error explains that.
 */
export async function deleteCombo(supabase: SupabaseClient<Database>, id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_combo", { p_id: id });
  if (error) throwMapped(error);
}

/**
 * Combos that can be added to a job or sale right now — active *and* inside
 * their offer window.
 *
 * The window check happens here, on the server, rather than in the picker:
 * evaluating `new Date()` during a client render makes the output differ
 * between the server pass and hydration, which is exactly the class of
 * time-dependent render the project's SSR standard rules out. One clock, one
 * answer.
 */
export async function listSellableCombos(supabase: SupabaseClient<Database>, now: Date = new Date()): Promise<ComboRow[]> {
  const combos = await listCombos(supabase, true);
  return combos.filter((combo) => isComboAvailable({ isActive: combo.isActive, validFrom: combo.validFrom, validTo: combo.validTo }, now));
}
