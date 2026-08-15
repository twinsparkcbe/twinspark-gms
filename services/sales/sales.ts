import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { InsufficientStockError, StockAdjustmentAuthError } from "@/services/shared/stock";
import type { Database, InstallationSubtype, ItemType, SaleLineType, SalePaymentStatus } from "@/types/database.types";

import type { PaymentMode } from "@/services/shared/payment";

import {
  saleEditInputSchema,
  saleInputSchema,
  salePaymentInputSchema,
  voidSaleInputSchema,
  UNASSIGNED_SOLD_BY,
  type SaleEditInput,
  type SaleFilters,
  type SaleInput,
  type SalePaymentUpdateInput,
  type VoidSaleInput,
} from "./schemas";

export class SaleItemUnavailableError extends Error {
  constructor(detail?: string) {
    super(detail ?? "One of the items in this sale doesn't exist or is no longer active.");
    this.name = "SaleItemUnavailableError";
  }
}

export class SaleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaleValidationError";
  }
}

export class SaleNotFoundError extends Error {
  constructor(id: string) {
    super(`Sale ${id} not found.`);
    this.name = "SaleNotFoundError";
  }
}

export interface SaleLineItemRow {
  id: string;
  position: number;
  lineType: SaleLineType;
  inventoryItemId: string | null;
  itemName: string | null;
  itemSkuCode: string | null;
  /** Null for an INSTALLATION line (nothing to join against) or a deleted
   * item. Powers Reports' Sales-by-item-type breakdown and Customer
   * Follow-Up's "what they last bought" (doc/reports-scope.md §3/§5). */
  itemType: ItemType | null;
  quantity: number | null;
  unitSellingPrice: number | null;
  installationSubtype: InstallationSubtype | null;
  wheelCount: number | null;
  description: string | null;
  amount: number | null;
  installedBy: string | null;
  /** Combo Offers (0022) — set on a COMBO line, and on the product rows the
   * server expanded out of it. */
  comboId: string | null;
  /** Snapshotted breakdown printed under a COMBO line. */
  comboContents: string[];
  /** Snapshotted worth of the bundle bought separately — drives "You saved". */
  comboListValue: number | null;
  /** Billed at ₹0 because the combo price covers it; stock still moved. */
  includedInCombo: boolean;
  lineTotal: number;
  /** Sum of sale_returns.quantity against this line (0 when none) — shown
   * in the Sales list so a returned line is visible without opening the
   * Return dialog again (SALE-return-visibility). */
  returnedQuantity: number;
}

export interface SaleRow {
  id: string;
  customerId: string;
  customerName: string;
  customerMobile: string;
  /** Null when the customer record has no address on file — invoice's
   * bill-to block simply omits the address line in that case. */
  customerAddress: string | null;
  saleDate: string;
  gstApplicable: boolean;
  gstAmount: number;
  discountApplicable: boolean;
  discountAmount: number;
  subtotal: number;
  installationTotal: number;
  grandTotal: number;
  invoiceNumber: string;
  /** Whether the money was collected (0024). Sales are otherwise immutable;
   * this and the tender fields below are what legitimately change later.
   * Derived from the amounts by the database (0027) — never set directly. */
  paymentStatus: SalePaymentStatus;
  /** How it was tendered (0027). Null on rows recorded before the feature
   * existed — the invoice and reports treat that as "unrecorded", never as
   * cash. */
  paymentMode: PaymentMode | null;
  cashAmount: number;
  upiAmount: number;
  needsServiceFollowup: boolean;
  serviceFollowupNote: string | null;
  /** Who made the sale (0029) — mirrors service_jobs' assigned mechanic. Null
   * is a real state: sales recorded before the field existed, or by an account
   * that has since been removed. */
  soldById: string | null;
  soldByName: string | null;
  /** Set when the sale was voided (0029). A voided sale keeps its invoice
   * number and stays in the list, but contributes nothing to any revenue
   * figure — every read path that adds up money filters it out. */
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  lineItems: SaleLineItemRow[];
}

export interface SalesStats {
  /** Sum of grand_total for sales within the queried date range. */
  totalSalesAmount: number;
  saleCount: number;
}

type SaleItemJoinedRow = {
  id: string;
  position: number;
  line_type: SaleLineType;
  inventory_item_id: string | null;
  quantity: number | null;
  unit_selling_price: number | null;
  installation_subtype: InstallationSubtype | null;
  wheel_count: number | null;
  description: string | null;
  amount: number | null;
  installed_by: string | null;
  combo_id: string | null;
  combo_contents: string[] | null;
  combo_list_value: number | null;
  included_in_combo: boolean | null;
  line_total: number;
  inventory_items:
    | { product_name: string; sku_code: string; item_type: ItemType }
    | { product_name: string; sku_code: string; item_type: ItemType }[]
    | null;
  sale_returns: { quantity: number }[] | null;
};

type SaleJoinedRow = {
  id: string;
  customer_id: string;
  sale_date: string;
  gst_applicable: boolean;
  gst_amount: number;
  discount_applicable: boolean;
  discount_amount: number;
  subtotal: number;
  installation_total: number;
  grand_total: number;
  invoice_number: string;
  payment_status: SalePaymentStatus | null;
  payment_mode: PaymentMode | null;
  cash_amount: number | null;
  upi_amount: number | null;
  needs_service_followup: boolean;
  service_followup_note: string | null;
  sold_by_id: string | null;
  voided_at: string | null;
  void_reason: string | null;
  sold_by: { full_name: string } | { full_name: string }[] | null;
  created_at: string;
  customers:
    | { name: string; mobile_number: string; address: string | null }
    | { name: string; mobile_number: string; address: string | null }[]
    | null;
  sale_items: SaleItemJoinedRow[];
};

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function mapLineItem(row: SaleItemJoinedRow): SaleLineItemRow {
  const item = firstOrSelf(row.inventory_items);
  return {
    id: row.id,
    position: row.position,
    lineType: row.line_type,
    inventoryItemId: row.inventory_item_id,
    itemName: item?.product_name ?? (row.inventory_item_id ? "Deleted item" : null),
    itemSkuCode: item?.sku_code ?? null,
    itemType: item?.item_type ?? null,
    quantity: row.quantity,
    unitSellingPrice: row.unit_selling_price !== null ? Number(row.unit_selling_price) : null,
    installationSubtype: row.installation_subtype,
    wheelCount: row.wheel_count,
    description: row.description,
    amount: row.amount !== null ? Number(row.amount) : null,
    installedBy: row.installed_by,
    comboId: row.combo_id ?? null,
    comboContents: row.combo_contents ?? [],
    comboListValue: row.combo_list_value === null || row.combo_list_value === undefined ? null : Number(row.combo_list_value),
    includedInCombo: row.included_in_combo ?? false,
    lineTotal: Number(row.line_total),
    returnedQuantity: (row.sale_returns ?? []).reduce((sum, r) => sum + r.quantity, 0),
  };
}

function mapSale(row: SaleJoinedRow): SaleRow {
  const customer = firstOrSelf(row.customers);
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: customer?.name ?? "Unknown customer",
    customerMobile: customer?.mobile_number ?? "",
    customerAddress: customer?.address ?? null,
    saleDate: row.sale_date,
    gstApplicable: row.gst_applicable,
    gstAmount: Number(row.gst_amount),
    discountApplicable: row.discount_applicable,
    discountAmount: Number(row.discount_amount),
    subtotal: Number(row.subtotal),
    installationTotal: Number(row.installation_total),
    grandTotal: Number(row.grand_total),
    invoiceNumber: row.invoice_number,
    paymentStatus: (row.payment_status ?? "PAID") as SalePaymentStatus,
    paymentMode: row.payment_mode ?? null,
    cashAmount: Number(row.cash_amount ?? 0),
    upiAmount: Number(row.upi_amount ?? 0),
    needsServiceFollowup: row.needs_service_followup,
    serviceFollowupNote: row.service_followup_note,
    soldById: row.sold_by_id ?? null,
    soldByName: firstOrSelf(row.sold_by)?.full_name ?? null,
    voidedAt: row.voided_at ?? null,
    voidReason: row.void_reason ?? null,
    createdAt: row.created_at,
    lineItems: (row.sale_items ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(mapLineItem),
  };
}

const SALE_SELECT_COLUMNS =
  "id, customer_id, sale_date, gst_applicable, gst_amount, discount_applicable, discount_amount, subtotal, installation_total, grand_total, invoice_number, payment_status, payment_mode, cash_amount, upi_amount, needs_service_followup, service_followup_note, sold_by_id, voided_at, void_reason, created_at, sold_by:profiles!sales_sold_by_id_fkey(full_name), customers!inner(name, mobile_number, address), sale_items(id, position, line_type, inventory_item_id, quantity, unit_selling_price, installation_subtype, wheel_count, description, amount, installed_by, line_total, combo_id, combo_contents, combo_list_value, included_in_combo, inventory_items(product_name, sku_code, item_type), sale_returns(quantity))";

export async function getSale(supabase: SupabaseClient<Database>, id: string): Promise<SaleRow> {
  const { data, error } = await supabase.from("sales").select(SALE_SELECT_COLUMNS).eq("id", id).maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new SaleNotFoundError(id);

  return mapSale(data as unknown as SaleJoinedRow);
}

/**
 * invoice_number lives on the base "sales" table while name/mobile_number
 * live on the joined "customers" table. PostgREST's `.or()` can't combine a
 * base-table column with a related-table column in one filter string (that's
 * only supported via its embedded-resource null-filtering trick, which needs
 * extra aliased embeds and is overkill here) — so we resolve matching
 * customers first, then OR that in against sales' own customer_id column.
 * Every condition in the final `.or()` stays on the base table.
 */
async function applyFilters<T>(
  supabase: SupabaseClient<Database>,
  query: T,
  filters: Pick<SaleFilters, "search" | "dateFrom" | "dateTo" | "soldById">
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = query as any;

  if (filters.search) {
    const term = filters.search.replace(/[,()]/g, " ").trim();
    if (term) {
      const { data: matchingCustomers, error: customerLookupError } = await supabase
        .from("customers")
        .select("id")
        .or(`name.ilike.%${term}%,mobile_number.ilike.%${term}%`);

      if (customerLookupError) throw new Error(customerLookupError.message);

      const orParts = [`invoice_number.ilike.%${term}%`];
      const customerIds = (matchingCustomers ?? []).map((c) => c.id);
      if (customerIds.length > 0) {
        orParts.push(`customer_id.in.(${customerIds.join(",")})`);
      }
      q = q.or(orParts.join(","));
    }
  }
  if (filters.dateFrom) q = q.gte("sale_date", filters.dateFrom.toISOString());
  if (filters.dateTo) q = q.lte("sale_date", filters.dateTo.toISOString());
  if (filters.soldById === UNASSIGNED_SOLD_BY) {
    q = q.is("sold_by_id", null);
  } else if (filters.soldById) {
    q = q.eq("sold_by_id", filters.soldById);
  }

  return q as T;
}

function applySort<T>(query: T, sortBy: SaleFilters["sortBy"] | undefined): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = query as any;
  switch (sortBy ?? "newest") {
    case "amount":
      return q.order("grand_total", { ascending: false }) as T;
    case "newest":
    default:
      return q.order("created_at", { ascending: false }) as T;
  }
}

export async function listSales(
  supabase: SupabaseClient<Database>,
  filters: SaleFilters
): Promise<{ sales: SaleRow[]; total: number }> {
  const from = (filters.page - 1) * filters.pageSize;
  const to = from + filters.pageSize - 1;

  const baseQuery = applySort(
    supabase.from("sales").select(SALE_SELECT_COLUMNS, { count: "exact" }),
    filters.sortBy
  ).range(from, to);

  const filteredQuery = await applyFilters(supabase, baseQuery, filters);
  const { data, error, count } = await filteredQuery;
  if (error) throw new Error(error.message);

  return {
    sales: ((data ?? []) as unknown as SaleJoinedRow[]).map(mapSale),
    total: count ?? 0,
  };
}

/**
 * Builds the jsonb line array record_sale() expects — see
 * 0013_sales_schema.sql's header comment on record_sale() for the exact
 * shape. Keeps the field-name translation (camelCase -> snake_case) in one
 * place rather than scattered across callers.
 */
function toRpcLines(input: SaleInput) {
  return input.lines.map((line) => {
    if (line.lineType === "PRODUCT") {
      return {
        line_type: "PRODUCT",
        inventory_item_id: line.inventoryItemId,
        quantity: line.quantity,
      };
    }
    if (line.lineType === "COMBO") {
      // Only the id and quantity — the server expands the bundle itself, so a
      // tampered client can't mis-state what was in it or skip a deduction.
      return { line_type: "COMBO", combo_id: line.comboId, quantity: line.quantity ?? 1 };
    }
    return {
      line_type: "INSTALLATION",
      installation_subtype: line.installationSubtype,
      wheel_count: line.wheelCount ?? null,
      description: line.description ?? null,
      amount: line.amount ?? null,
      installed_by: line.installedBy ?? null,
    };
  });
}

/**
 * The only way to record a Sale — calls record_sale_with_payment()
 * (0027_payment_split.sql), which wraps record_sale() (0013): atomically
 * finds/creates the Customer, inserts every line (deducting FIFO stock per
 * PRODUCT line via the shared adjust_stock() path), computes the totals, then
 * applies the payment and derives payment_status from it. Returns the full
 * joined row so the UI can render the invoice immediately without a
 * follow-up refetch.
 *
 * payment_status is deliberately not sent — the server derives it from the
 * amounts against the authoritative grand total, which only exists after
 * every line has been priced.
 */
export async function recordSale(supabase: SupabaseClient<Database>, rawInput: SaleInput): Promise<SaleRow> {
  const input = saleInputSchema.parse(rawInput);

  const { data, error } = await supabase.rpc("record_sale_with_payment", {
    p_customer_name: input.customerName,
    p_customer_mobile: input.customerMobile,
    p_customer_address: input.customerAddress ?? null,
    p_gst_applicable: input.gstApplicable,
    p_gst_amount: input.gstAmount,
    p_discount_applicable: input.discountApplicable,
    p_discount_amount: input.discountAmount,
    p_lines: toRpcLines(input),
    p_payment_mode: input.payment.mode,
    p_cash_amount: input.payment.cashAmount,
    p_upi_amount: input.payment.upiAmount,
    p_sold_by_id: input.soldById ?? null,
  });

  if (error) {
    if (error.code === "P0001") {
      throw new InsufficientStockError("Not enough stock available for one of the items in this sale.");
    }
    if (error.code === "42501") {
      throw new StockAdjustmentAuthError("You don't have permission to record sales.");
    }
    if (error.code === "P0002") {
      throw new SaleItemUnavailableError();
    }
    if (error.code === "22023") {
      throw new SaleValidationError(error.message);
    }
    throw new Error(error.message);
  }
  if (typeof data !== "string") {
    throw new Error("Unexpected response from record_sale.");
  }

  return getSale(supabase, data);
}

/**
 * Corrects a recorded sale in place (doc/sales-edit-void-scope.md §3), keeping
 * its invoice number. Stock is reconciled to the corrected lines — the old
 * deduction is reversed and the new one applied in one transaction — and
 * payment_status is re-derived against the new total.
 *
 * Two refusals worth knowing about, both raised as ServiceValidationError-style
 * 22023s with a message meant to be shown verbatim:
 *
 *  - the sale has a Sale Return against it. `sale_returns.sale_item_id` is
 *    `on delete restrict`, so replacing the lines is physically impossible
 *    while a return points at one; the RPC turns that foreign-key error into
 *    "undo the return first".
 *  - the corrected total lands below what was already collected. That means
 *    money is going back to the customer, which is a refund decision — the
 *    amounts are never silently rewritten to fit.
 *
 * Price rule: a line whose item was already on this invoice keeps the price the
 * customer was actually charged; only a newly added or swapped item takes
 * today's master price. Without that, fixing a typo on a June bill in August
 * would restate June's revenue at August prices.
 */
export async function editSale(supabase: SupabaseClient<Database>, rawInput: SaleEditInput): Promise<SaleRow> {
  const { saleId, input } = saleEditInputSchema.parse(rawInput);

  const { error } = await supabase.rpc("edit_sale", {
    p_sale_id: saleId,
    p_customer_name: input.customerName,
    p_customer_mobile: input.customerMobile,
    p_customer_address: input.customerAddress ?? null,
    p_gst_applicable: input.gstApplicable,
    p_gst_amount: input.gstAmount,
    p_discount_applicable: input.discountApplicable,
    p_discount_amount: input.discountAmount,
    p_lines: toRpcLines(input),
    p_sold_by_id: input.soldById ?? null,
    p_payment_mode: input.payment.mode,
    p_cash_amount: input.payment.cashAmount,
    p_upi_amount: input.payment.upiAmount,
  });

  if (error) {
    if (error.code === "P0001") throw new InsufficientStockError("Not enough stock available for one of the items on the corrected sale.");
    if (error.code === "P0002") throw new SaleItemUnavailableError();
    if (error.code === "42501") throw new StockAdjustmentAuthError("You don't have permission to edit sales.");
    if (error.code === "22023") throw new SaleValidationError(error.message);
    throw new Error(error.message);
  }

  return getSale(supabase, saleId);
}

/**
 * Marks a sale as never having happened (§4). Stock fully restored, tender
 * cleared, and the row stamped so every revenue read path skips it — but the
 * row itself stays, with its invoice number, so the TW-S- series has no
 * unexplained gap.
 *
 * Not reversible by design. If a void was itself a mistake, the sale is
 * recorded again; un-voiding would mean re-deducting stock that may since have
 * been sold to someone else.
 */
export async function voidSale(supabase: SupabaseClient<Database>, rawInput: VoidSaleInput): Promise<SaleRow> {
  const input = voidSaleInputSchema.parse(rawInput);

  const { error } = await supabase.rpc("void_sale", {
    p_sale_id: input.saleId,
    p_reason: input.reason,
  });

  if (error) {
    if (error.code === "P0002") throw new SaleNotFoundError(input.saleId);
    if (error.code === "42501") throw new StockAdjustmentAuthError("You don't have permission to void sales.");
    if (error.code === "22023") throw new SaleValidationError(error.message);
    throw new Error(error.message);
  }

  return getSale(supabase, input.saleId);
}

/**
 * Settles a bill after the fact — the customer came back and paid, or paid
 * the balance on a part-paid invoice. Calls update_sales_payment_status()
 * (0027), which re-derives payment_status from the amounts.
 *
 * Overwrites the tender figures rather than appending an instalment: a
 * running payment history per invoice is an explicit non-goal
 * (doc/payment-split-scope.md §11), since the shop settles a bill in at most
 * two touches.
 */
export async function updateSalePayment(
  supabase: SupabaseClient<Database>,
  rawInput: SalePaymentUpdateInput
): Promise<SaleRow> {
  const input = salePaymentInputSchema.parse(rawInput);

  const { error } = await supabase.rpc("update_sales_payment_status", {
    p_sale_id: input.saleId,
    p_payment_mode: input.payment.mode,
    p_cash_amount: input.payment.cashAmount,
    p_upi_amount: input.payment.upiAmount,
  });

  if (error) {
    if (error.code === "42501") throw new StockAdjustmentAuthError("You don't have permission to update this sale.");
    if (error.code === "P0002") throw new SaleNotFoundError(input.saleId);
    if (error.code === "22023") throw new SaleValidationError(error.message);
    throw new Error(error.message);
  }

  return getSale(supabase, input.saleId);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Aggregate Sales Amount for a date range — feeds the future Dashboard's
 * Profit = Sales - Purchase calc and the Sales Report (scope doc §9), and
 * the Sales list's stat cards. Defaults to the current month when no range
 * is given; `search` (optional) narrows the aggregate to match whatever the
 * list's own search filter currently has applied, via the same
 * applyFilters() the list uses, so the cards and the table never disagree
 * about what's being summarized.
 */
export async function getSalesStats(
  supabase: SupabaseClient<Database>,
  range?: { from?: Date; to?: Date; search?: string }
): Promise<SalesStats> {
  const from = range?.from ?? startOfMonth(new Date());
  const to = range?.to ?? new Date();

  // No longer needs to join customers — the search filter now resolves
  // matching customer ids separately (see applyFilters).
  //
  // Voided sales are excluded here and nowhere else in this file: listSales(),
  // getSale() and listSalesForCustomer() deliberately keep showing them, badged
  // — they are records, not revenue, and hiding the row is exactly what the
  // badge exists to avoid (0029).
  const baseQuery = supabase.from("sales").select("grand_total").is("voided_at", null);
  const filteredQuery = await applyFilters(supabase, baseQuery, { search: range?.search, dateFrom: from, dateTo: to });
  const { data, error } = await filteredQuery;

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { grand_total: number }[];
  return {
    totalSalesAmount: rows.reduce((sum, row) => sum + Number(row.grand_total), 0),
    saleCount: rows.length,
  };
}

/** Powers a customer's sale history (scope doc §2). */
export async function listSalesForCustomer(
  supabase: SupabaseClient<Database>,
  customerId: string
): Promise<SaleRow[]> {
  const { data, error } = await supabase
    .from("sales")
    .select(SALE_SELECT_COLUMNS)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as SaleJoinedRow[]).map(mapSale);
}
