import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { InsufficientStockError, StockAdjustmentAuthError } from "@/services/shared/stock";
import type { PaymentMode } from "@/services/shared/payment";
import type {
  Database,
  ServiceDeliveryStatus,
  ServiceImageType,
  ServiceJobEventType,
  ServiceJobStatus,
  ServiceLineType,
  ServicePaymentStatus,
} from "@/types/database.types";

import {
  completedServiceJobEditInputSchema,
  serviceDeliveryStatusInputSchema,
  serviceJobInputSchema,
  serviceJobStatusInputSchema,
  servicePaymentStatusInputSchema,
  serviceReversalInputSchema,
  type CompletedServiceJobEditInput,
  type ServiceDeliveryStatusInput,
  type ServiceJobFilters,
  type ServiceJobInput,
  type ServiceJobStatusInput,
  type ServicePaymentInput,
  type ServicePaymentStatusInput,
  type ServiceReversalInput,
} from "./schemas";

export class ServiceJobNotFoundError extends Error {
  constructor(id: string) {
    super(`Service Job ${id} not found.`);
    this.name = "ServiceJobNotFoundError";
  }
}

export class ServiceJobValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceJobValidationError";
  }
}

export class ServiceCatalogEntryUnavailableError extends Error {
  constructor(detail?: string) {
    super(detail ?? "One of the services/packages on this job doesn't exist or is no longer active.");
    this.name = "ServiceCatalogEntryUnavailableError";
  }
}

export interface ServiceJobLineRow {
  id: string;
  position: number;
  lineType: ServiceLineType;
  generalServicePackageId: string | null;
  specificServiceId: string | null;
  /** Combo Offers (0022) — set only on a COMBO line. */
  comboId: string | null;
  /** Snapshotted content list printed beneath a COMBO line, unpriced. */
  comboContents: string[];
  /** What the bundle was worth separately, snapshotted when it was sold —
   * the basis for the invoice's "You saved ₹X" line. */
  comboListValue: number | null;
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

export interface ServiceInventoryUsageRow {
  id: string;
  inventoryItemId: string;
  itemName: string;
  quantityUsed: number;
  unitPrice: number;
  lineTotal: number;
  /** Combo Offers (0022) — which combo brought this part in, if any. */
  comboId: string | null;
  /** Billed at ₹0 because the combo price covers it. Stock still moves, so
   * the FIFO cost still reaches the Profit report. */
  includedInCombo: boolean;
}

export interface ServiceJobEventRow {
  id: string;
  eventType: ServiceJobEventType;
  detail: string | null;
  createdAt: string;
}

export interface ServiceJobImageRow {
  id: string;
  imageType: ServiceImageType;
  storagePath: string;
  createdAt: string;
}

export interface ServiceJobRow {
  id: string;
  jobNumber: string;
  invoiceNumber: string | null;
  customerId: string;
  customerName: string;
  customerMobile: string;
  customerAddress: string | null;
  vehicleId: string;
  vehicleNumber: string;
  vehicleModel: string;
  odometerReading: number;
  status: ServiceJobStatus;
  complaintNotes: string | null;
  /** Internal only — callers building a customer-facing view (Job Card,
   * Invoice) must never render this field (doc §14). */
  mechanicNotes: string | null;
  expectedDeliveryAt: string | null;
  completedAt: string | null;
  deliveredAt: string | null;
  paymentStatus: ServicePaymentStatus | null;
  /** How the job was paid (0027). Null on a free service, an unpaid job, or
   * a job completed before the feature existed. */
  paymentMode: PaymentMode | null;
  cashAmount: number;
  upiAmount: number;
  deliveryStatus: ServiceDeliveryStatus | null;
  gstApplicable: boolean;
  gstAmount: number;
  discountApplicable: boolean;
  discountAmount: number;
  subtotal: number;
  inventoryTotal: number;
  grandTotal: number;
  /** Assigned Mechanic (0026) — null when nobody is on the job yet. The
   * name is joined for display; the id is what the filter/picker use. */
  assignedMechanicId: string | null;
  assignedMechanicName: string | null;
  createdAt: string;
  lines: ServiceJobLineRow[];
  usage: ServiceInventoryUsageRow[];
  events: ServiceJobEventRow[];
  images: ServiceJobImageRow[];
}

export interface ServiceStats {
  /** Gross revenue across COMPLETED jobs in range, including FREE_SERVICE ones. */
  grossCompletedRevenue: number;
  /** Same set, excluding FREE_SERVICE — what was actually meant to be collected (doc §23). */
  collectedRevenue: number;
  completedJobCount: number;
}

type JoinedRow = {
  id: string;
  job_number: string;
  invoice_number: string | null;
  customer_id: string;
  vehicle_id: string;
  odometer_reading: number;
  status: ServiceJobStatus;
  complaint_notes: string | null;
  mechanic_notes: string | null;
  expected_delivery_at: string | null;
  completed_at: string | null;
  delivered_at: string | null;
  payment_status: ServicePaymentStatus | null;
  payment_mode: PaymentMode | null;
  cash_amount: number | null;
  upi_amount: number | null;
  delivery_status: ServiceDeliveryStatus | null;
  gst_applicable: boolean;
  gst_amount: number;
  discount_applicable: boolean;
  discount_amount: number;
  subtotal: number;
  inventory_total: number;
  grand_total: number;
  assigned_mechanic_id: string | null;
  created_at: string;
  assigned_mechanic: { full_name: string } | { full_name: string }[] | null;
  customers: { name: string; mobile_number: string; address: string | null } | { name: string; mobile_number: string; address: string | null }[] | null;
  vehicles: { vehicle_number: string; vehicle_model: string } | { vehicle_number: string; vehicle_model: string }[] | null;
  service_job_lines: {
    id: string;
    position: number;
    line_type: ServiceLineType;
    general_service_package_id: string | null;
    specific_service_id: string | null;
    combo_id: string | null;
    combo_contents: string[] | null;
    combo_list_value: number | null;
    description: string;
    quantity: number;
    rate: number;
    amount: number;
  }[];
  service_inventory_usage: {
    id: string;
    inventory_item_id: string;
    item_name_snapshot: string;
    quantity_used: number;
    unit_price_snapshot: number;
    line_total: number;
    combo_id: string | null;
    included_in_combo: boolean;
  }[];
  service_job_events: { id: string; event_type: ServiceJobEventType; detail: string | null; created_at: string }[];
  service_job_images: { id: string; image_type: ServiceImageType; storage_path: string; created_at: string }[];
};

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function mapServiceJob(row: JoinedRow): ServiceJobRow {
  const customer = firstOrSelf(row.customers);
  const vehicle = firstOrSelf(row.vehicles);

  return {
    id: row.id,
    jobNumber: row.job_number,
    invoiceNumber: row.invoice_number,
    customerId: row.customer_id,
    customerName: customer?.name ?? "Unknown customer",
    customerMobile: customer?.mobile_number ?? "",
    customerAddress: customer?.address ?? null,
    vehicleId: row.vehicle_id,
    vehicleNumber: vehicle?.vehicle_number ?? "",
    vehicleModel: vehicle?.vehicle_model ?? "",
    odometerReading: row.odometer_reading,
    status: row.status,
    complaintNotes: row.complaint_notes,
    mechanicNotes: row.mechanic_notes,
    expectedDeliveryAt: row.expected_delivery_at,
    completedAt: row.completed_at,
    deliveredAt: row.delivered_at,
    paymentStatus: row.payment_status,
    paymentMode: row.payment_mode ?? null,
    cashAmount: Number(row.cash_amount ?? 0),
    upiAmount: Number(row.upi_amount ?? 0),
    deliveryStatus: row.delivery_status,
    gstApplicable: row.gst_applicable,
    gstAmount: Number(row.gst_amount),
    discountApplicable: row.discount_applicable,
    discountAmount: Number(row.discount_amount),
    subtotal: Number(row.subtotal),
    inventoryTotal: Number(row.inventory_total),
    grandTotal: Number(row.grand_total),
    assignedMechanicId: row.assigned_mechanic_id ?? null,
    assignedMechanicName: firstOrSelf(row.assigned_mechanic)?.full_name ?? null,
    createdAt: row.created_at,
    lines: (row.service_job_lines ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        id: l.id,
        position: l.position,
        lineType: l.line_type,
        generalServicePackageId: l.general_service_package_id,
        specificServiceId: l.specific_service_id,
        comboId: l.combo_id,
        comboContents: l.combo_contents ?? [],
        comboListValue: l.combo_list_value === null || l.combo_list_value === undefined ? null : Number(l.combo_list_value),
        description: l.description,
        quantity: l.quantity,
        rate: Number(l.rate),
        amount: Number(l.amount),
      })),
    usage: (row.service_inventory_usage ?? []).map((u) => ({
      id: u.id,
      inventoryItemId: u.inventory_item_id,
      itemName: u.item_name_snapshot,
      quantityUsed: u.quantity_used,
      unitPrice: Number(u.unit_price_snapshot),
      lineTotal: Number(u.line_total),
      comboId: u.combo_id,
      includedInCombo: u.included_in_combo ?? false,
    })),
    events: (row.service_job_events ?? [])
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((e) => ({ id: e.id, eventType: e.event_type, detail: e.detail, createdAt: e.created_at })),
    images: (row.service_job_images ?? []).map((i) => ({
      id: i.id,
      imageType: i.image_type,
      storagePath: i.storage_path,
      createdAt: i.created_at,
    })),
  };
}

const SERVICE_JOB_SELECT_COLUMNS =
  "id, job_number, invoice_number, customer_id, vehicle_id, odometer_reading, status, complaint_notes, mechanic_notes, expected_delivery_at, completed_at, delivered_at, payment_status, payment_mode, cash_amount, upi_amount, delivery_status, gst_applicable, gst_amount, discount_applicable, discount_amount, subtotal, inventory_total, grand_total, assigned_mechanic_id, created_at, assigned_mechanic:profiles!service_jobs_assigned_mechanic_id_fkey(full_name), customers!inner(name, mobile_number, address), vehicles!inner(vehicle_number, vehicle_model), service_job_lines(id, position, line_type, general_service_package_id, specific_service_id, combo_id, combo_contents, combo_list_value, description, quantity, rate, amount), service_inventory_usage(id, inventory_item_id, item_name_snapshot, quantity_used, unit_price_snapshot, line_total, combo_id, included_in_combo), service_job_events(id, event_type, detail, created_at), service_job_images(id, image_type, storage_path, created_at)";

export async function getServiceJob(supabase: SupabaseClient<Database>, id: string): Promise<ServiceJobRow> {
  const { data, error } = await supabase.from("service_jobs").select(SERVICE_JOB_SELECT_COLUMNS).eq("id", id).maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new ServiceJobNotFoundError(id);

  return mapServiceJob(data as unknown as JoinedRow);
}

/**
 * Resolves the unified search term (Vehicle Number, Customer Name, Mobile
 * Number, Job Number, or Invoice Number — doc §20) into a base-table
 * `.or()` filter. Mirrors Sales' applyFilters: PostgREST can't combine a
 * base-table column with a related-table column in one `.or()` string, so
 * matching customers/vehicles are resolved first, then folded in as
 * `customer_id.in.(...)` / `vehicle_id.in.(...)`.
 */
async function applyFilters<T>(
  supabase: SupabaseClient<Database>,
  query: T,
  filters: Pick<ServiceJobFilters, "search" | "status" | "assignedMechanicId" | "dateFrom" | "dateTo">
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = query as any;

  if (filters.search) {
    const term = filters.search.replace(/[,()]/g, " ").trim();
    if (term) {
      const [{ data: matchingCustomers, error: customerErr }, { data: matchingVehicles, error: vehicleErr }] = await Promise.all([
        supabase.from("customers").select("id").or(`name.ilike.%${term}%,mobile_number.ilike.%${term}%`),
        supabase.from("vehicles").select("id").ilike("vehicle_number", `%${term}%`),
      ]);
      if (customerErr) throw new Error(customerErr.message);
      if (vehicleErr) throw new Error(vehicleErr.message);

      const orParts = [`job_number.ilike.%${term}%`, `invoice_number.ilike.%${term}%`];
      const customerIds = (matchingCustomers ?? []).map((c) => c.id);
      const vehicleIds = (matchingVehicles ?? []).map((v) => v.id);
      if (customerIds.length > 0) orParts.push(`customer_id.in.(${customerIds.join(",")})`);
      if (vehicleIds.length > 0) orParts.push(`vehicle_id.in.(${vehicleIds.join(",")})`);
      q = q.or(orParts.join(","));
    }
  }
  if (filters.status) q = q.eq("status", filters.status);
  // "UNASSIGNED" is a filter value, not an id — nobody is on the job yet.
  if (filters.assignedMechanicId === "UNASSIGNED") {
    q = q.is("assigned_mechanic_id", null);
  } else if (filters.assignedMechanicId) {
    q = q.eq("assigned_mechanic_id", filters.assignedMechanicId);
  }
  if (filters.dateFrom) q = q.gte("created_at", filters.dateFrom.toISOString());
  if (filters.dateTo) q = q.lte("created_at", filters.dateTo.toISOString());

  return q as T;
}

export async function listServiceJobs(
  supabase: SupabaseClient<Database>,
  filters: ServiceJobFilters
): Promise<{ jobs: ServiceJobRow[]; total: number }> {
  const from = (filters.page - 1) * filters.pageSize;
  const to = from + filters.pageSize - 1;

  const baseQuery = supabase
    .from("service_jobs")
    .select(SERVICE_JOB_SELECT_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  const filteredQuery = await applyFilters(supabase, baseQuery, filters);
  const { data, error, count } = await filteredQuery;
  if (error) throw new Error(error.message);

  return {
    jobs: ((data ?? []) as unknown as JoinedRow[]).map(mapServiceJob),
    total: count ?? 0,
  };
}

/** Pending Job Detection (doc §19) — active (non-terminal) jobs on this
 * vehicle, most recent first. Non-blocking by design: the caller shows this
 * as an advisory banner, never a hard stop. */
export async function findActiveServiceJobsForVehicle(
  supabase: SupabaseClient<Database>,
  vehicleId: string
): Promise<ServiceJobRow[]> {
  const { data, error } = await supabase
    .from("service_jobs")
    .select(SERVICE_JOB_SELECT_COLUMNS)
    .eq("vehicle_id", vehicleId)
    .in("status", ["DRAFT", "IN_PROGRESS", "READY_FOR_DELIVERY"])
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as JoinedRow[]).map(mapServiceJob);
}

export async function listServiceJobsForVehicle(
  supabase: SupabaseClient<Database>,
  vehicleId: string
): Promise<ServiceJobRow[]> {
  const { data, error } = await supabase
    .from("service_jobs")
    .select(SERVICE_JOB_SELECT_COLUMNS)
    .eq("vehicle_id", vehicleId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as JoinedRow[]).map(mapServiceJob);
}

export async function listServiceJobsForCustomer(
  supabase: SupabaseClient<Database>,
  customerId: string
): Promise<ServiceJobRow[]> {
  const { data, error } = await supabase
    .from("service_jobs")
    .select(SERVICE_JOB_SELECT_COLUMNS)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as JoinedRow[]).map(mapServiceJob);
}

/** Translates a ServiceJobInput's lines/usage arrays into the jsonb shapes
 * create_service_job()/update_service_job() expect (0016_service_schema.sql
 * §9's header comment) — same field-name-translation-in-one-place principle
 * as Sales' toRpcLines. */
function toRpcLines(input: ServiceJobInput) {
  return input.lines.map((line) => ({
    line_type: line.lineType,
    general_service_package_id: line.lineType === "PACKAGE" ? line.generalServicePackageId : null,
    specific_service_id: line.lineType === "SPECIFIC" ? line.specificServiceId : null,
    combo_id: line.lineType === "COMBO" ? line.comboId : null,
    combo_contents: line.lineType === "COMBO" ? (line.comboContents ?? []) : null,
    description: line.lineType === "CUSTOM" ? line.description : null,
    quantity: line.quantity,
    rate: line.rate,
  }));
}

function toRpcUsage(input: ServiceJobInput) {
  return input.usage.map((u) => ({
    inventory_item_id: u.inventoryItemId,
    quantity_used: u.quantityUsed,
    combo_id: u.comboId ?? null,
    included_in_combo: u.includedInCombo ?? false,
  }));
}

function mapCreateUpdateError(error: { code?: string; message: string }): Error {
  if (error.code === "42501") return new StockAdjustmentAuthError("You don't have permission to manage Service Jobs.");
  if (error.code === "P0002") return new ServiceCatalogEntryUnavailableError(error.message);
  if (error.code === "22023") return new ServiceJobValidationError(error.message);
  return new Error(error.message);
}

/** The only way to create a Service Job — always lands in DRAFT (doc §6). */
export async function createServiceJob(supabase: SupabaseClient<Database>, rawInput: ServiceJobInput): Promise<ServiceJobRow> {
  const input = serviceJobInputSchema.parse(rawInput);

  const { data, error } = await supabase.rpc("create_service_job", {
    p_customer_name: input.customerName,
    p_customer_mobile: input.customerMobile,
    p_customer_address: input.customerAddress ?? null,
    p_vehicle_number: input.vehicleNumber,
    p_vehicle_model: input.vehicleModel,
    p_odometer_reading: input.odometerReading,
    p_complaint_notes: input.complaintNotes ?? null,
    p_mechanic_notes: input.mechanicNotes ?? null,
    p_expected_delivery_at: input.expectedDeliveryAt ? input.expectedDeliveryAt.toISOString() : null,
    p_gst_applicable: input.gstApplicable,
    p_gst_amount: input.gstAmount,
    p_discount_applicable: input.discountApplicable,
    p_discount_amount: input.discountAmount,
    p_lines: toRpcLines(input),
    p_usage: toRpcUsage(input),
    p_assigned_mechanic_id: input.assignedMechanicId ?? null,
  });

  if (error) throw mapCreateUpdateError(error);
  if (typeof data !== "string") throw new Error("Unexpected response from create_service_job.");

  return getServiceJob(supabase, data);
}

/**
 * Quick Intake (doc §21, Revision 4) — logs a bike the moment it's dropped
 * off with only the minimum fields (Customer, Vehicle, Odometer, optional
 * Complaint — zero lines/usage, both already optional on createServiceJob).
 * Immediately nudges the job from DRAFT to IN_PROGRESS, since the bike really
 * has been accepted for service at this point — Draft is for the full-detail
 * path where someone genuinely wants to save an unfinished job card. The
 * advisor fills in what was actually done later, either via the Edit screen
 * or straight into the Complete & Bill flow on this same job.
 */
export async function createServiceJobIntake(supabase: SupabaseClient<Database>, rawInput: ServiceJobInput): Promise<ServiceJobRow> {
  const job = await createServiceJob(supabase, rawInput);
  return updateServiceJobStatus(supabase, { serviceJobId: job.id, newStatus: "IN_PROGRESS" });
}

/** Edits a Service Job while it's still Draft/In Progress — rejected
 * server-side otherwise (doc §6 note, mirrors Sales' immutability past
 * that point). Full-replace on lines/usage. */
export async function updateServiceJob(
  supabase: SupabaseClient<Database>,
  serviceJobId: string,
  rawInput: ServiceJobInput
): Promise<ServiceJobRow> {
  const input = serviceJobInputSchema.parse(rawInput);

  const { error } = await supabase.rpc("update_service_job", {
    p_service_job_id: serviceJobId,
    p_customer_name: input.customerName,
    p_customer_mobile: input.customerMobile,
    p_customer_address: input.customerAddress ?? null,
    p_vehicle_number: input.vehicleNumber,
    p_vehicle_model: input.vehicleModel,
    p_odometer_reading: input.odometerReading,
    p_complaint_notes: input.complaintNotes ?? null,
    p_mechanic_notes: input.mechanicNotes ?? null,
    p_expected_delivery_at: input.expectedDeliveryAt ? input.expectedDeliveryAt.toISOString() : null,
    p_gst_applicable: input.gstApplicable,
    p_gst_amount: input.gstAmount,
    p_discount_applicable: input.discountApplicable,
    p_discount_amount: input.discountAmount,
    p_lines: toRpcLines(input),
    p_usage: toRpcUsage(input),
    p_assigned_mechanic_id: input.assignedMechanicId ?? null,
  });

  if (error) {
    if (error.code === "P0002") throw new ServiceJobNotFoundError(serviceJobId);
    throw mapCreateUpdateError(error);
  }

  return getServiceJob(supabase, serviceJobId);
}

/** Every status transition EXCEPT the one into COMPLETED — see
 * completeServiceJob() below. Server-side enforces the transition table
 * (doc §5); an invalid jump raises ServiceJobValidationError. */
export async function updateServiceJobStatus(
  supabase: SupabaseClient<Database>,
  rawInput: ServiceJobStatusInput
): Promise<ServiceJobRow> {
  const input = serviceJobStatusInputSchema.parse(rawInput);

  const { error } = await supabase.rpc("update_service_job_status", {
    p_service_job_id: input.serviceJobId,
    p_new_status: input.newStatus,
    p_note: input.note ?? null,
  });

  if (error) {
    if (error.code === "P0002") throw new ServiceJobNotFoundError(input.serviceJobId);
    if (error.code === "42501") throw new StockAdjustmentAuthError("You don't have permission to change a Service Job's status.");
    if (error.code === "22023") throw new ServiceJobValidationError(error.message);
    throw new Error(error.message);
  }

  return getServiceJob(supabase, input.serviceJobId);
}

/**
 * The one function that finalizes a Service Job (doc §7): deducts stock for
 * every inventory-usage line via the existing adjust_stock() (reason
 * SERVICE_USAGE), assigns the invoice number, computes final totals, and
 * moves status to COMPLETED — all atomically. An insufficient-stock error
 * here leaves the job exactly as it was (nothing partially committed).
 */
export async function completeServiceJob(supabase: SupabaseClient<Database>, serviceJobId: string): Promise<ServiceJobRow> {
  const { error } = await supabase.rpc("complete_service_job", { p_service_job_id: serviceJobId });

  if (error) {
    if (error.code === "P0001") throw new InsufficientStockError("Not enough stock available for one of the parts used on this job.");
    if (error.code === "P0002") throw new ServiceJobNotFoundError(serviceJobId);
    if (error.code === "42501") throw new StockAdjustmentAuthError("You don't have permission to complete Service Jobs.");
    if (error.code === "22023") throw new ServiceJobValidationError(error.message);
    throw new Error(error.message);
  }

  return getServiceJob(supabase, serviceJobId);
}

/**
 * Reverses a completion (doc/service-edit-undo-scope.md §3) — the only way
 * out of COMPLETED. Restores every part to stock, voids the invoice number and
 * drops the job back to In Progress, so it can be re-billed from scratch.
 *
 * Administrator-only and reason-required, enforced in the RPC. Deliberately
 * permitted on a paid or delivered job: refusing would leave a genuinely wrong
 * bill uncorrectable, which is the problem this exists to solve. The
 * confirmation dialog states both facts before the admin commits.
 *
 * Re-completing afterwards draws a FRESH invoice number — the voided one is
 * never reissued, so the TW-J- series gains a gap. That's the accepted trade
 * (doc §1): a printed number and a stored number never disagree.
 */
export async function undoServiceCompletion(
  supabase: SupabaseClient<Database>,
  rawInput: ServiceReversalInput
): Promise<ServiceJobRow> {
  const input = serviceReversalInputSchema.parse(rawInput);

  const { error } = await supabase.rpc("undo_service_completion", {
    p_service_job_id: input.serviceJobId,
    p_reason: input.reason,
  });

  if (error) {
    if (error.code === "P0002") throw new ServiceJobNotFoundError(input.serviceJobId);
    if (error.code === "42501") throw new StockAdjustmentAuthError("Only Administrators can undo a completed Service Job.");
    if (error.code === "22023") throw new ServiceJobValidationError(error.message);
    throw new Error(error.message);
  }

  return getServiceJob(supabase, input.serviceJobId);
}

/**
 * The pre-completion half of "undo" (doc §4): a job that was never billed has
 * no stock movement and no invoice to reverse, so voiding it is just the
 * existing CANCELLED transition — with a reason attached, and gated to
 * Administrators at the action layer so the row action means the same thing
 * whatever status it's sitting on.
 */
export async function cancelServiceJob(
  supabase: SupabaseClient<Database>,
  rawInput: ServiceReversalInput
): Promise<ServiceJobRow> {
  const input = serviceReversalInputSchema.parse(rawInput);

  return updateServiceJobStatus(supabase, {
    serviceJobId: input.serviceJobId,
    newStatus: "CANCELLED",
    note: input.reason,
  });
}

/**
 * Corrects a job that's already been billed (doc §2), keeping its invoice
 * number. Stock is reconciled to the corrected parts list — the old deduction
 * is reversed and the new one applied inside one transaction, so a quantity
 * typed as 4 instead of 2 puts 2 back.
 *
 * The tender travels with the edit because the total usually moves with it:
 * payment_status is re-derived server-side against the corrected total, per
 * the 0027 rule that a status is never passed in. If the corrected total lands
 * *below* what was already collected the RPC refuses rather than quietly
 * rewriting the amounts — money owed back to a customer is a refund decision,
 * not a rounding detail.
 */
export async function editCompletedServiceJob(
  supabase: SupabaseClient<Database>,
  rawInput: CompletedServiceJobEditInput
): Promise<ServiceJobRow> {
  const { serviceJobId, input, payment } = completedServiceJobEditInputSchema.parse(rawInput);

  const { error } = await supabase.rpc("edit_completed_service_job", {
    p_service_job_id: serviceJobId,
    p_customer_name: input.customerName,
    p_customer_mobile: input.customerMobile,
    p_customer_address: input.customerAddress ?? null,
    p_vehicle_number: input.vehicleNumber,
    p_vehicle_model: input.vehicleModel,
    p_odometer_reading: input.odometerReading,
    p_complaint_notes: input.complaintNotes ?? null,
    p_mechanic_notes: input.mechanicNotes ?? null,
    p_expected_delivery_at: input.expectedDeliveryAt ? input.expectedDeliveryAt.toISOString() : null,
    p_gst_applicable: input.gstApplicable,
    p_gst_amount: input.gstAmount,
    p_discount_applicable: input.discountApplicable,
    p_discount_amount: input.discountAmount,
    p_lines: toRpcLines(input),
    p_usage: toRpcUsage(input),
    p_assigned_mechanic_id: input.assignedMechanicId ?? null,
    p_payment_mode: payment.freeService ? null : payment.mode,
    p_cash_amount: payment.freeService ? 0 : payment.cashAmount,
    p_upi_amount: payment.freeService ? 0 : payment.upiAmount,
    p_free_service: payment.freeService ?? false,
  });

  if (error) {
    if (error.code === "P0001") throw new InsufficientStockError("Not enough stock available for one of the parts on the corrected job.");
    if (error.code === "P0002") throw new ServiceJobNotFoundError(serviceJobId);
    if (error.code === "42501") throw new StockAdjustmentAuthError("Only Administrators can edit a completed Service Job.");
    if (error.code === "22023") throw new ServiceJobValidationError(error.message);
    throw new Error(error.message);
  }

  return getServiceJob(supabase, serviceJobId);
}

export async function updateServicePaymentStatus(
  supabase: SupabaseClient<Database>,
  rawInput: ServicePaymentStatusInput
): Promise<ServiceJobRow> {
  const input = servicePaymentStatusInputSchema.parse(rawInput);

  const { error } = await supabase.rpc("update_service_payment_status", {
    p_service_job_id: input.serviceJobId,
    p_payment_mode: input.payment.freeService ? null : input.payment.mode,
    p_cash_amount: input.payment.freeService ? 0 : input.payment.cashAmount,
    p_upi_amount: input.payment.freeService ? 0 : input.payment.upiAmount,
    p_free_service: input.payment.freeService ?? false,
  });

  if (error) {
    if (error.code === "42501") throw new StockAdjustmentAuthError("Only Administrators can update payment status.");
    if (error.code === "P0002") throw new ServiceJobNotFoundError(input.serviceJobId);
    if (error.code === "22023") throw new ServiceJobValidationError(error.message);
    throw new Error(error.message);
  }

  return getServiceJob(supabase, input.serviceJobId);
}

/**
 * "Service-First, Billing-Later" — the one-shot completion flow for how
 * staff actually run the shop (doc §21, Revision 4): the bike gets fixed
 * first, and only once it's done does the advisor sit down and enter
 * everything at once — services, parts, GST/discount — then bill it
 * immediately. This wraps the existing create/update → transition →
 * complete → payment-status calls behind one function so the UI only needs
 * one button. No new RPC: every step below is a call this module already
 * exposes, just chained instead of requiring four separate screens/saves.
 *
 * If `serviceJobId` is omitted, a new job is created first (find-or-create
 * customer/vehicle, same as createServiceJob). Either way the job is then
 * nudged from DRAFT to IN_PROGRESS if needed (complete_service_job() only
 * accepts IN_PROGRESS/READY_FOR_DELIVERY), completed (deducts stock,
 * assigns the invoice number), and — if a payment status was captured on
 * the same screen — stamped immediately after, since payment_status can
 * only be set once a job is COMPLETED.
 *
 * A failure partway through (e.g. insufficient stock at the complete step)
 * leaves the job saved with whatever lines were entered, sitting at
 * whatever status it reached — nothing is lost, and the same button can be
 * retried once the issue (e.g. stock) is fixed.
 */
export async function saveAndCompleteServiceJob(
  supabase: SupabaseClient<Database>,
  params: {
    serviceJobId?: string;
    jobInput: ServiceJobInput;
    /** Captured on the completion screen. Applied after completion, since
     * update_service_payment_status() rejects a job that isn't COMPLETED. */
    payment?: ServicePaymentInput;
    /** Set when the bike is handed over at the same counter visit it's
     * billed at — the common case. Applied after completion because
     * update_service_delivery_status() rejects a job that isn't COMPLETED. */
    deliveryStatus?: ServiceDeliveryStatus;
  }
): Promise<ServiceJobRow> {
  let job = params.serviceJobId
    ? await updateServiceJob(supabase, params.serviceJobId, params.jobInput)
    : await createServiceJob(supabase, params.jobInput);

  if (job.status === "DRAFT") {
    job = await updateServiceJobStatus(supabase, { serviceJobId: job.id, newStatus: "IN_PROGRESS" });
  }

  job = await completeServiceJob(supabase, job.id);

  // Only when something was actually collected (or the job was marked free).
  // "Not paid yet" deliberately skips the call: update_service_payment_status()
  // is admin-only, and a Mechanic completing a job would otherwise hit a
  // permission error *after* the job is already completed and stock deducted.
  // Skipping leaves the PENDING that completion sets, which is the same
  // outcome the old `if (params.paymentStatus)` guard produced.
  if (params.payment && (params.payment.freeService || params.payment.mode !== null)) {
    job = await updateServicePaymentStatus(supabase, { serviceJobId: job.id, payment: params.payment });
  }

  if (params.deliveryStatus) {
    job = await updateServiceDeliveryStatus(supabase, { serviceJobId: job.id, deliveryStatus: params.deliveryStatus });
  }

  return job;
}

export async function updateServiceDeliveryStatus(
  supabase: SupabaseClient<Database>,
  rawInput: ServiceDeliveryStatusInput
): Promise<ServiceJobRow> {
  const input = serviceDeliveryStatusInputSchema.parse(rawInput);

  const { error } = await supabase.rpc("update_service_delivery_status", {
    p_service_job_id: input.serviceJobId,
    p_delivery_status: input.deliveryStatus,
  });

  if (error) {
    if (error.code === "P0002") throw new ServiceJobNotFoundError(input.serviceJobId);
    if (error.code === "22023") throw new ServiceJobValidationError(error.message);
    throw new Error(error.message);
  }

  return getServiceJob(supabase, input.serviceJobId);
}

export interface LastServiceSummary {
  jobNumber: string;
  invoiceNumber: string | null;
  completedAt: string;
}

/**
 * Powers the "Last service: ..." hint shown once a vehicle is resolved on
 * the Service Job form (doc §2) — lets staff see at a glance whether this
 * bike has been in before and when, without opening its full history. A
 * deliberately lean query (3 columns, latest row only) rather than reusing
 * listServiceJobsForVehicle, which joins in lines/usage/events/images that
 * this hint doesn't need.
 */
export async function getLastCompletedServiceForVehicle(
  supabase: SupabaseClient<Database>,
  vehicleId: string
): Promise<LastServiceSummary | null> {
  const { data, error } = await supabase
    .from("service_jobs")
    .select("job_number, invoice_number, completed_at")
    .eq("vehicle_id", vehicleId)
    .eq("status", "COMPLETED")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || !data.completed_at) return null;

  return { jobNumber: data.job_number, invoiceNumber: data.invoice_number, completedAt: data.completed_at };
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Dashboard/Reports data contract (doc §23) — COMPLETED jobs only; a
 * Draft/Cancelled job never counts as revenue, and FREE_SERVICE jobs are
 * split out of the "collected" figure while still counting toward gross
 * completed work. */
export async function getServiceStats(
  supabase: SupabaseClient<Database>,
  range?: { from?: Date; to?: Date }
): Promise<ServiceStats> {
  const from = range?.from ?? startOfMonth(new Date());
  const to = range?.to ?? new Date();

  const { data, error } = await supabase
    .from("service_jobs")
    .select("grand_total, payment_status")
    .eq("status", "COMPLETED")
    .gte("completed_at", from.toISOString())
    .lte("completed_at", to.toISOString());

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { grand_total: number; payment_status: ServicePaymentStatus | null }[];
  const grossCompletedRevenue = rows.reduce((sum, row) => sum + Number(row.grand_total), 0);
  const collectedRevenue = rows
    .filter((row) => row.payment_status !== "FREE_SERVICE")
    .reduce((sum, row) => sum + Number(row.grand_total), 0);

  return { grossCompletedRevenue, collectedRevenue, completedJobCount: rows.length };
}
