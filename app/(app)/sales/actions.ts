"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { requireSalesAccess } from "@/lib/auth/require-sales-access";
import { listActiveSalespeople, type StaffOption } from "@/services/users";
import { createClient } from "@/lib/supabase/server";
import { listAllInventoryItemsForExport, listBrands, type BrandRow, type InventoryItemRow } from "@/services/inventory";
import {
  escalateSaleToService,
  getCustomerByMobile,
  getSale,
  listReturnsForSale,
  listSales,
  recordSale,
  recordSaleReturn,
  updateSalePayment,
  searchCustomers,
  getSalesStats,
  editSale,
  undoSaleReturn,
  voidSale,
  type CustomerRow,
  type EscalateSaleInput,
  type SaleFilters,
  type SaleInput,
  type SaleReturnInput,
  type SaleReturnRow,
  type SaleRow,
  type SalePaymentUpdateInput,
  type SalesStats,
  type SaleEditInput,
  type UndoSaleReturnInput,
  type VoidSaleInput,
} from "@/services/sales";

type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

function toErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Every action re-checks access server-side — never trust the client.
 * Sales is the one module both Administrator and Sales Person can use
 * (doc/sales-module-scope.md §1). */
async function salesClient() {
  await requireSalesAccess();
  return createClient();
}

/** Sale Return is admin-only (mirrors Purchase Return's precedent — see
 * migration 0013's comment on adjust_stock's SALE_REASON authorization). */
async function adminClient() {
  await requireAdmin();
  return createClient();
}

/**
 * Editing and voiding a recorded sale — Administrator or Sales Person, but NOT
 * Mechanic. requireSalesAccess() would let a Mechanic through (0026 gave them
 * sales access so they can sell parts at the counter), and voiding is the one
 * action whose misuse is invisible in the totals. Mirrors can_correct_sales()
 * in migration 0029, which re-checks this server-side regardless.
 */
async function saleCorrectionClient() {
  const { role } = await requireSalesAccess();
  if (role !== "admin" && role !== "sales_person") {
    throw new Error("You don't have permission to edit or void sales.");
  }
  return createClient();
}

function revalidateBoth() {
  revalidatePath("/sales");
  revalidatePath("/inventory"); // stock just changed
}

export async function fetchSalesAction(
  filters: SaleFilters
): Promise<ActionResult<{ sales: SaleRow[]; total: number }>> {
  try {
    const supabase = await salesClient();
    const data = await listSales(supabase, filters);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load sales.") };
  }
}

export async function recordSaleAction(input: SaleInput): Promise<ActionResult<SaleRow>> {
  try {
    const supabase = await salesClient();
    const data = await recordSale(supabase, input);
    revalidateBoth();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to record sale.") };
  }
}

/**
 * Correct a recorded sale (doc/sales-edit-void-scope.md §3). Stock moves, so
 * Inventory is revalidated alongside Sales — and so do the report figures,
 * which read through the same routes.
 */
export async function editSaleAction(input: SaleEditInput): Promise<ActionResult<SaleRow>> {
  try {
    const supabase = await saleCorrectionClient();
    const data = await editSale(supabase, input);
    revalidateBoth();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to save changes to this sale.") };
  }
}

/** Void a sale (§4) — stock back, row kept and stamped, out of every revenue
 * figure. */
export async function voidSaleAction(input: VoidSaleInput): Promise<ActionResult<SaleRow>> {
  try {
    const supabase = await saleCorrectionClient();
    const data = await voidSale(supabase, input);
    revalidateBoth();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to void this sale.") };
  }
}

/** Powers the "Sold by" picker and the list's Sold-by filter (§2). */
export async function fetchSalespeopleAction(): Promise<ActionResult<StaffOption[]>> {
  try {
    const supabase = await salesClient();
    const data = await listActiveSalespeople(supabase);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load staff.") };
  }
}

/**
 * Settling a bill after the fact. Sales-access (not admin-only): the person
 * who takes the money at the counter is the person who records it, same
 * rule the RPC enforces.
 *
 * Only /sales is revalidated — unlike recording a sale, collecting payment
 * moves no stock.
 */
export async function updateSalePaymentAction(input: SalePaymentUpdateInput): Promise<ActionResult<SaleRow>> {
  try {
    const supabase = await salesClient();
    const data = await updateSalePayment(supabase, input);
    revalidatePath("/sales");
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to record payment.") };
  }
}

export async function fetchSalesStatsAction(range?: {
  from?: string;
  to?: string;
  search?: string;
}): Promise<ActionResult<SalesStats>> {
  try {
    const supabase = await salesClient();
    const data = await getSalesStats(
      supabase,
      range
        ? {
            from: range.from ? new Date(range.from) : undefined,
            to: range.to ? new Date(range.to) : undefined,
            search: range.search,
          }
        : undefined
    );
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load sales stats.") };
  }
}

// Powers the Customer field's auto-suggest dropdown (scope doc §2).
export async function searchCustomersAction(query: string): Promise<ActionResult<CustomerRow[]>> {
  try {
    const supabase = await salesClient();
    const data = await searchCustomers(supabase, query);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to search customers.") };
  }
}

// Exact-match auto-fill when a full mobile number is typed/pasted (SALE-002).
export async function getCustomerByMobileAction(mobileNumber: string): Promise<ActionResult<CustomerRow | null>> {
  try {
    const supabase = await salesClient();
    const data = await getCustomerByMobile(supabase, mobileNumber);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to look up customer.") };
  }
}

// Powers the New Sale item picker — reuses Inventory's existing unpaginated
// active-items query, same pattern as Purchases' fetchActiveItemsForPickerAction.
export async function fetchActiveItemsForSalePickerAction(): Promise<ActionResult<InventoryItemRow[]>> {
  try {
    const supabase = await salesClient();
    const data = await listAllInventoryItemsForExport(supabase, {});
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load items.") };
  }
}

export async function fetchBrandsForSaleAction(): Promise<ActionResult<BrandRow[]>> {
  try {
    const supabase = await salesClient();
    const data = await listBrands(supabase);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load brands.") };
  }
}

/**
 * Sale Return is admin-only (unlike creating a sale) — mirrors Purchase
 * Return's precedent, see migration 0013's comment on adjust_stock().
 */
export async function recordSaleReturnAction(input: SaleReturnInput): Promise<ActionResult<SaleReturnRow>> {
  try {
    const supabase = await adminClient();
    const data = await recordSaleReturn(supabase, input);
    revalidateBoth();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to record sale return.") };
  }
}

// Powers the Return dialog's "existing returns, with Undo" list (doc/sales-
// module-scope.md §6a) — admin-only, same tier as recording/undoing a return.
export async function listReturnsForSaleAction(saleId: string): Promise<ActionResult<SaleReturnRow[]>> {
  try {
    const supabase = await adminClient();
    const data = await listReturnsForSale(supabase, saleId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load returns for this sale.") };
  }
}

/** Undo Sale Return is admin-only, same as recording one (doc/sales-module-
 * scope.md §6a). */
export async function undoSaleReturnAction(input: UndoSaleReturnInput): Promise<ActionResult<undefined>> {
  try {
    const supabase = await adminClient();
    await undoSaleReturn(supabase, input);
    revalidateBoth();
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to undo sale return.") };
  }
}

// Refetches one sale (with its line items) after a return, so the UI can
// show updated remaining quantities without a full list refetch.
export async function fetchSaleByIdAction(saleId: string): Promise<ActionResult<SaleRow>> {
  try {
    const supabase = await salesClient();
    const data = await getSale(supabase, saleId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load sale.") };
  }
}

export async function escalateSaleToServiceAction(input: EscalateSaleInput): Promise<ActionResult<SaleRow>> {
  try {
    const supabase = await salesClient();
    const data = await escalateSaleToService(supabase, input);
    revalidatePath("/sales");
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to escalate sale to Service.") };
  }
}
