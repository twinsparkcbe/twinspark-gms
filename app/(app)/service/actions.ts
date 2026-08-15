"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { requireServiceAccess } from "@/lib/auth/require-service-access";
import {
  createCombo,
  deleteCombo,
  duplicateCombo,
  listCombos,
  setComboActive,
  updateCombo,
  type ComboInput,
  type ComboRow,
} from "@/services/combos";
import { createClient } from "@/lib/supabase/server";
import { listAllInventoryItemsForExport, type InventoryItemRow } from "@/services/inventory";
import { listAllCustomersForPicker, type CustomerRow } from "@/services/sales";
import {
  cancelServiceJob,
  completeServiceJob,
  createGeneralServicePackage,
  createServiceJob,
  editCompletedServiceJob,
  undoServiceCompletion,
  deleteGeneralServicePackage,
  deleteSpecificService,
  createServiceJobIntake,
  createSpecificService,
  findActiveServiceJobsForVehicle,
  getLastCompletedServiceForVehicle,
  getServiceJob,
  getServiceStats,
  listAllVehiclesForPicker,
  listGeneralServicePackages,
  listServiceJobs,
  listServiceJobsForCustomer,
  listServiceJobsForVehicle,
  listSpecificServices,
  saveAndCompleteServiceJob,
  setGeneralServicePackageActive,
  setSpecificServiceActive,
  updateGeneralServicePackage,
  updateServiceDeliveryStatus,
  updateServiceJob,
  updateServiceJobStatus,
  updateServicePaymentStatus,
  updateSpecificService,
  type CompletedServiceJobEditInput,
  type GeneralServicePackageInput,
  type GeneralServicePackageRow,
  type LastServiceSummary,
  type ServiceReversalInput,
  type ServiceDeliveryStatusInput,
  type ServiceJobFilters,
  type ServiceJobInput,
  type ServiceJobRow,
  type ServiceJobStatusInput,
  type ServicePaymentInput,
  type ServicePaymentStatusInput,
  type ServiceStats,
  type SpecificServiceInput,
  type SpecificServiceRow,
  type VehicleRow,
} from "@/services/service";
import { listActiveMechanics, type MechanicOption } from "@/services/users";
import type { ServiceDeliveryStatus } from "@/types/database.types";

type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

function toErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Every action re-checks access server-side — never trust the client.
 * The Service Job lifecycle is Administrator + Mechanic
 * (doc/mechanic-role-scope.md §4); Sales Person still has zero access. */
async function serviceClient() {
  await requireServiceAccess();
  return createClient();
}

/** The Administrator-only corner of this module: Service Catalog writes
 * (packages, specific services, combo offers) and service payment status.
 * A Mechanic reads the price list through the pickers and can complete and
 * hand over a job, but sets neither prices nor money collected. */
async function adminServiceClient() {
  await requireAdmin();
  return createClient();
}

/**
 * "layout", not the default "page" — a bare revalidatePath("/service") only
 * invalidates that exact route, leaving /service/new, /service/catalog and
 * /service/[id]/edit serving stale server renders. That bit us for real: a
 * newly created combo showed in Manage Catalog (local state) but never
 * appeared in the job form's picker, because /service/new was still replaying
 * a payload rendered before the combo existed.
 */
function revalidateService() {
  revalidatePath("/service", "layout");
}

function revalidateServiceAndStock() {
  revalidatePath("/service", "layout");
  revalidatePath("/inventory", "layout"); // stock just changed (completion deducts parts used)
}

export async function fetchServiceJobsAction(
  filters: ServiceJobFilters
): Promise<ActionResult<{ jobs: ServiceJobRow[]; total: number }>> {
  try {
    const supabase = await serviceClient();
    const data = await listServiceJobs(supabase, filters);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load Service Jobs.") };
  }
}

export async function fetchServiceJobByIdAction(id: string): Promise<ActionResult<ServiceJobRow>> {
  try {
    const supabase = await serviceClient();
    const data = await getServiceJob(supabase, id);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load Service Job.") };
  }
}

export async function fetchMechanicsAction(): Promise<ActionResult<MechanicOption[]>> {
  try {
    const supabase = await serviceClient();
    const data = await listActiveMechanics(supabase);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load mechanics.") };
  }
}

export async function fetchServiceStatsAction(range?: { from?: string; to?: string }): Promise<ActionResult<ServiceStats>> {
  try {
    const supabase = await serviceClient();
    const data = await getServiceStats(
      supabase,
      range ? { from: range.from ? new Date(range.from) : undefined, to: range.to ? new Date(range.to) : undefined } : undefined
    );
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load Service stats.") };
  }
}

// Powers the New/Edit Service Job form's Customer field auto-suggest —
// reuses Sales' customers table/picker directly (doc §2), not duplicated.
export async function fetchCustomersForServicePickerAction(): Promise<ActionResult<CustomerRow[]>> {
  try {
    const supabase = await serviceClient();
    const data = await listAllCustomersForPicker(supabase);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load customers.") };
  }
}

export async function fetchVehiclesForServicePickerAction(): Promise<ActionResult<VehicleRow[]>> {
  try {
    const supabase = await serviceClient();
    const data = await listAllVehiclesForPicker(supabase);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load vehicles.") };
  }
}

// Powers the Parts Used picker — same unpaginated active-items query
// Sales/Purchases already use.
export async function fetchActiveItemsForServicePickerAction(): Promise<ActionResult<InventoryItemRow[]>> {
  try {
    const supabase = await serviceClient();
    const data = await listAllInventoryItemsForExport(supabase, {});
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load items.") };
  }
}

export async function fetchGeneralServicePackagesAction(activeOnly = false): Promise<ActionResult<GeneralServicePackageRow[]>> {
  try {
    const supabase = await serviceClient();
    const data = await listGeneralServicePackages(supabase, activeOnly);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load General Service Packages.") };
  }
}

export async function fetchSpecificServicesAction(activeOnly = false): Promise<ActionResult<SpecificServiceRow[]>> {
  try {
    const supabase = await serviceClient();
    const data = await listSpecificServices(supabase, activeOnly);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load Specific Services.") };
  }
}

// Pending Job Detection (doc §19) — non-blocking lookup fired when a
// vehicle is selected on the New Service Job form.
export async function findActiveServiceJobsForVehicleAction(vehicleId: string): Promise<ActionResult<ServiceJobRow[]>> {
  try {
    const supabase = await serviceClient();
    const data = await findActiveServiceJobsForVehicle(supabase, vehicleId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to check for an existing Service Job on this vehicle.") };
  }
}

// Powers the "Last service: ..." hint shown once a vehicle is resolved on
// the Service Job form — null just means this bike has no completed
// service on record yet, not an error.
export async function fetchLastCompletedServiceForVehicleAction(vehicleId: string): Promise<ActionResult<LastServiceSummary | null>> {
  try {
    const supabase = await serviceClient();
    const data = await getLastCompletedServiceForVehicle(supabase, vehicleId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load last service for this vehicle.") };
  }
}

export async function fetchServiceJobsForVehicleAction(vehicleId: string): Promise<ActionResult<ServiceJobRow[]>> {
  try {
    const supabase = await serviceClient();
    const data = await listServiceJobsForVehicle(supabase, vehicleId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load service history for this vehicle.") };
  }
}

export async function fetchServiceJobsForCustomerAction(customerId: string): Promise<ActionResult<ServiceJobRow[]>> {
  try {
    const supabase = await serviceClient();
    const data = await listServiceJobsForCustomer(supabase, customerId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load service history for this customer.") };
  }
}

export async function createServiceJobAction(input: ServiceJobInput): Promise<ActionResult<ServiceJobRow>> {
  try {
    const supabase = await serviceClient();
    const data = await createServiceJob(supabase, input);
    revalidateService();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to create Service Job.") };
  }
}

export async function updateServiceJobAction(serviceJobId: string, input: ServiceJobInput): Promise<ActionResult<ServiceJobRow>> {
  try {
    const supabase = await serviceClient();
    const data = await updateServiceJob(supabase, serviceJobId, input);
    revalidateService();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to update Service Job.") };
  }
}

// Quick Intake (doc §21) — the optional 10-second drop-off log. Creates the
// job and lands it straight in In Progress (skips Draft — the bike really
// has been accepted).
export async function createServiceJobIntakeAction(input: ServiceJobInput): Promise<ActionResult<ServiceJobRow>> {
  try {
    const supabase = await serviceClient();
    const data = await createServiceJobIntake(supabase, input);
    revalidateService();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to log the vehicle in.") };
  }
}

// "Complete & Generate Invoice" (doc §21) — the one-shot billing flow: saves
// whatever's on the form (creating the job if it doesn't exist yet), moves
// it through to Completed, and optionally stamps a payment status, all in
// one call. Stock just moved (SERVICE_USAGE deduction) — revalidate
// Inventory too. `payment` carries the tender (0027); payment_status is
// derived from it server-side, never passed.
export async function saveAndCompleteServiceJobAction(params: {
  serviceJobId?: string;
  input: ServiceJobInput;
  payment?: ServicePaymentInput;
  deliveryStatus?: ServiceDeliveryStatus;
}): Promise<ActionResult<ServiceJobRow>> {
  try {
    const supabase = await serviceClient();
    const data = await saveAndCompleteServiceJob(supabase, {
      serviceJobId: params.serviceJobId,
      jobInput: params.input,
      payment: params.payment,
      deliveryStatus: params.deliveryStatus,
    });
    revalidateServiceAndStock();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to complete Service Job.") };
  }
}

export async function updateServiceJobStatusAction(input: ServiceJobStatusInput): Promise<ActionResult<ServiceJobRow>> {
  try {
    const supabase = await serviceClient();
    const data = await updateServiceJobStatus(supabase, input);
    revalidateService();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to update Service Job status.") };
  }
}

// Stock just moved (SERVICE_USAGE deduction) — revalidate Inventory too.
export async function completeServiceJobAction(serviceJobId: string): Promise<ActionResult<ServiceJobRow>> {
  try {
    const supabase = await serviceClient();
    const data = await completeServiceJob(supabase, serviceJobId);
    revalidateServiceAndStock();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to complete Service Job.") };
  }
}

/**
 * Undo Completion (doc/service-edit-undo-scope.md §3) — Administrator-only,
 * re-checked in the RPC too. Stock moves back, so Inventory is revalidated
 * alongside Service.
 */
export async function undoServiceCompletionAction(input: ServiceReversalInput): Promise<ActionResult<ServiceJobRow>> {
  try {
    const supabase = await adminServiceClient();
    const data = await undoServiceCompletion(supabase, input);
    revalidateServiceAndStock();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to undo this completed Service Job.") };
  }
}

/**
 * Cancel (doc §4) — the pre-completion half of the same row action. Admin-gated
 * here rather than at the RPC (which still allows any Mechanic to cancel from
 * the job detail screen, unchanged since 0026) so that the list's undo button
 * carries one consistent meaning: only an admin reverses things from here.
 * No stock has moved, so only Service is revalidated.
 */
export async function cancelServiceJobAction(input: ServiceReversalInput): Promise<ActionResult<ServiceJobRow>> {
  try {
    const supabase = await adminServiceClient();
    const data = await cancelServiceJob(supabase, input);
    revalidateService();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to cancel this Service Job.") };
  }
}

/**
 * Edit a job that's already been billed (doc §2) — Administrator-only. Keeps
 * the invoice number and reconciles stock to the corrected parts list, so
 * Inventory is revalidated too.
 */
export async function editCompletedServiceJobAction(input: CompletedServiceJobEditInput): Promise<ActionResult<ServiceJobRow>> {
  try {
    const supabase = await adminServiceClient();
    const data = await editCompletedServiceJob(supabase, input);
    revalidateServiceAndStock();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to save changes to this completed Service Job.") };
  }
}

export async function updateServicePaymentStatusAction(input: ServicePaymentStatusInput): Promise<ActionResult<ServiceJobRow>> {
  try {
    const supabase = await adminServiceClient();
    const data = await updateServicePaymentStatus(supabase, input);
    revalidateService();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to update payment status.") };
  }
}

export async function updateServiceDeliveryStatusAction(input: ServiceDeliveryStatusInput): Promise<ActionResult<ServiceJobRow>> {
  try {
    const supabase = await serviceClient();
    const data = await updateServiceDeliveryStatus(supabase, input);
    revalidateService();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to update delivery status.") };
  }
}

// --- Service Catalog (Manage Packages / Specific Services) ---

export async function createGeneralServicePackageAction(input: GeneralServicePackageInput): Promise<ActionResult<GeneralServicePackageRow>> {
  try {
    const supabase = await adminServiceClient();
    const data = await createGeneralServicePackage(supabase, input);
    revalidateService();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to create package.") };
  }
}

export async function updateGeneralServicePackageAction(
  id: string,
  input: GeneralServicePackageInput
): Promise<ActionResult<GeneralServicePackageRow>> {
  try {
    const supabase = await adminServiceClient();
    const data = await updateGeneralServicePackage(supabase, id, input);
    revalidateService();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to update package.") };
  }
}

export async function setGeneralServicePackageActiveAction(id: string, isActive: boolean): Promise<ActionResult<GeneralServicePackageRow>> {
  try {
    const supabase = await adminServiceClient();
    const data = await setGeneralServicePackageActive(supabase, id, isActive);
    revalidateService();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to update package.") };
  }
}

export async function createSpecificServiceAction(input: SpecificServiceInput): Promise<ActionResult<SpecificServiceRow>> {
  try {
    const supabase = await adminServiceClient();
    const data = await createSpecificService(supabase, input);
    revalidateService();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to create service.") };
  }
}

export async function updateSpecificServiceAction(id: string, input: SpecificServiceInput): Promise<ActionResult<SpecificServiceRow>> {
  try {
    const supabase = await adminServiceClient();
    const data = await updateSpecificService(supabase, id, input);
    revalidateService();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to update service.") };
  }
}

export async function setSpecificServiceActiveAction(id: string, isActive: boolean): Promise<ActionResult<SpecificServiceRow>> {
  try {
    const supabase = await adminServiceClient();
    const data = await setSpecificServiceActive(supabase, id, isActive);
    revalidateService();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to update service.") };
  }
}

// ---------------------------------------------------------------------------
// Combo Offers (doc/service-combo-offers-plan.md).
//
// Combos are shared with Sales, but they're *defined* here — Manage Service
// Catalog is where the admin builds them, and defining one is
// Administrator-only (the RPCs re-check that server-side regardless).
// /sales is revalidated too, since a combo change is immediately sellable
// from the Sales screen.
// ---------------------------------------------------------------------------

function revalidateCombos() {
  // Whole subtree on both sides — a combo is sellable from the job form and
  // the sale form, neither of which is the bare /service or /sales route.
  revalidatePath("/service", "layout");
  revalidatePath("/sales", "layout");
}

export async function fetchCombosAction(activeOnly = false): Promise<ActionResult<ComboRow[]>> {
  try {
    const supabase = await serviceClient();
    const data = await listCombos(supabase, activeOnly);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load combo offers.") };
  }
}

export async function createComboAction(input: ComboInput): Promise<ActionResult<ComboRow>> {
  try {
    const supabase = await adminServiceClient();
    const data = await createCombo(supabase, input);
    revalidateCombos();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to create the combo offer.") };
  }
}

export async function updateComboAction(id: string, input: ComboInput): Promise<ActionResult<ComboRow>> {
  try {
    const supabase = await adminServiceClient();
    const data = await updateCombo(supabase, id, input);
    revalidateCombos();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to update the combo offer.") };
  }
}

export async function duplicateComboAction(id: string, newName: string): Promise<ActionResult<ComboRow>> {
  try {
    const supabase = await adminServiceClient();
    const data = await duplicateCombo(supabase, id, newName);
    revalidateCombos();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to duplicate the combo offer.") };
  }
}

export async function setComboActiveAction(id: string, isActive: boolean): Promise<ActionResult<ComboRow>> {
  try {
    const supabase = await adminServiceClient();
    const data = await setComboActive(supabase, id, isActive);
    revalidateCombos();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to update the combo offer.") };
  }
}

// ---------------------------------------------------------------------------
// Deleting catalog entries.
//
// Only ever succeeds for an entry nothing references — the mistake case.
// Anything with history is refused server-side by 0023_catalog_delete.sql
// with a message explaining to deactivate instead, which is surfaced verbatim
// because it names the actual job/sale counts.
// ---------------------------------------------------------------------------

export async function deleteComboAction(id: string): Promise<ActionResult> {
  try {
    const supabase = await adminServiceClient();
    await deleteCombo(supabase, id);
    revalidateCombos();
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to delete the combo offer.") };
  }
}

export async function deleteGeneralServicePackageAction(id: string): Promise<ActionResult> {
  try {
    const supabase = await adminServiceClient();
    await deleteGeneralServicePackage(supabase, id);
    revalidateService();
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to delete the package.") };
  }
}

export async function deleteSpecificServiceAction(id: string): Promise<ActionResult> {
  try {
    const supabase = await adminServiceClient();
    await deleteSpecificService(supabase, id);
    revalidateService();
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to delete the service.") };
  }
}
