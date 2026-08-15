import { describe, expect, it } from "vitest";

import { InsufficientStockError, StockAdjustmentAuthError } from "@/services/shared/stock";

import { createQueryBuilderMock, createSupabaseMock } from "../../test/supabase-query-mock";
import {
  completeServiceJob,
  createServiceJob,
  findActiveServiceJobsForVehicle,
  getLastCompletedServiceForVehicle,
  getServiceJob,
  getServiceStats,
  listServiceJobs,
  listServiceJobsForCustomer,
  listServiceJobsForVehicle,
  ServiceCatalogEntryUnavailableError,
  saveAndCompleteServiceJob,
  ServiceJobNotFoundError,
  ServiceJobValidationError,
  updateServiceDeliveryStatus,
  updateServiceJob,
  updateServiceJobStatus,
  updateServicePaymentStatus,
} from "./jobs";
import type { ServiceJobInput } from "./schemas";

const jobRow = {
  id: "44444444-4444-4444-8444-444444444401",
  job_number: "SJ-000001",
  invoice_number: null,
  customer_id: "88888888-8888-4888-8888-888888888801",
  vehicle_id: "99999999-9999-4999-8999-999999999901",
  odometer_reading: 12000,
  status: "DRAFT",
  complaint_notes: "Engine Noise",
  mechanic_notes: "Check fork seal",
  expected_delivery_at: null,
  completed_at: null,
  delivered_at: null,
  payment_status: null,
  payment_mode: null,
  cash_amount: 0,
  upi_amount: 0,
  delivery_status: null,
  gst_applicable: false,
  gst_amount: 0,
  discount_applicable: false,
  discount_amount: 0,
  subtotal: 800,
  inventory_total: 350,
  grand_total: 1150,
  created_at: "2026-07-16T10:00:00.000Z",
  customers: { name: "Arun Kumar", mobile_number: "9876543210", address: "Coimbatore" },
  vehicles: { vehicle_number: "TN37AB1234", vehicle_model: "KTM Duke 390" },
  service_job_lines: [
    {
      id: "55555555-5555-4555-8555-555555555502",
      position: 2,
      line_type: "SPECIFIC",
      general_service_package_id: null,
      specific_service_id: "22222222-2222-4222-8222-222222222201",
      description: "Chain Cleaning",
      quantity: 1,
      rate: 150,
      amount: 150,
    },
    {
      id: "55555555-5555-4555-8555-555555555501",
      position: 1,
      line_type: "PACKAGE",
      general_service_package_id: "11111111-1111-4111-8111-111111111101",
      specific_service_id: null,
      description: "Standard Service",
      quantity: 1,
      rate: 650,
      amount: 650,
    },
  ],
  service_inventory_usage: [
    {
      id: "66666666-6666-4666-8666-666666666601",
      inventory_item_id: "33333333-3333-4333-8333-333333333301",
      item_name_snapshot: "Engine Oil 20W40",
      quantity_used: 1,
      unit_price_snapshot: 350,
      line_total: 350,
    },
  ],
  service_job_events: [
    { id: "77777777-7777-4777-8777-777777777701", event_type: "JOB_CREATED", detail: "Service Job created", created_at: "2026-07-16T10:00:00.000Z" },
  ],
  service_job_images: [],
};

const baseInput: ServiceJobInput = {
  customerName: "Arun Kumar",
  customerMobile: "9876543210",
  customerAddress: undefined,
  vehicleNumber: "TN37AB1234",
  vehicleModel: "KTM Duke 390",
  odometerReading: 12000,
  complaintNotes: "Engine Noise",
  mechanicNotes: undefined,
  expectedDeliveryAt: undefined,
  gstApplicable: false,
  gstAmount: 0,
  discountApplicable: false,
  discountAmount: 0,
  lines: [
    { lineType: "PACKAGE", generalServicePackageId: "11111111-1111-4111-8111-111111111101", quantity: 1, rate: 650 },
    { lineType: "SPECIFIC", specificServiceId: "22222222-2222-4222-8222-222222222201", quantity: 1, rate: 150 },
  ],
  usage: [{ inventoryItemId: "33333333-3333-4333-8333-333333333301", quantityUsed: 1 }],
};

describe("getServiceJob", () => {
  it("maps a joined job row, sorting lines by position", async () => {
    const builder = createQueryBuilderMock({ data: jobRow, error: null });
    const supabase = createSupabaseMock(builder);

    const result = await getServiceJob(supabase, "44444444-4444-4444-8444-444444444401");

    expect(result.jobNumber).toBe("SJ-000001");
    expect(result.invoiceNumber).toBeNull();
    expect(result.lines.map((l) => l.position)).toEqual([1, 2]);
    expect(result.lines[0].lineType).toBe("PACKAGE");
    expect(result.lines[1].lineType).toBe("SPECIFIC");
  });

  it("includes mechanicNotes in the full detail fetch (admin-only view, doc §14)", async () => {
    const builder = createQueryBuilderMock({ data: jobRow, error: null });
    const supabase = createSupabaseMock(builder);

    const result = await getServiceJob(supabase, "44444444-4444-4444-8444-444444444401");

    expect(result.mechanicNotes).toBe("Check fork seal");
  });

  it("maps service_inventory_usage rows with their snapshot values", async () => {
    const builder = createQueryBuilderMock({ data: jobRow, error: null });
    const supabase = createSupabaseMock(builder);

    const result = await getServiceJob(supabase, "44444444-4444-4444-8444-444444444401");

    expect(result.usage).toHaveLength(1);
    expect(result.usage[0].itemName).toBe("Engine Oil 20W40");
    expect(result.usage[0].lineTotal).toBe(350);
  });

  it("throws ServiceJobNotFoundError when no row matches", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(getServiceJob(supabase, "missing")).rejects.toBeInstanceOf(ServiceJobNotFoundError);
  });
});

describe("createServiceJob", () => {
  it("calls create_service_job with mixed PACKAGE/SPECIFIC lines and usage mapped to snake_case", async () => {
    const builder = createQueryBuilderMock({ data: jobRow, error: null });
    const supabase = createSupabaseMock(builder, { data: "44444444-4444-4444-8444-444444444401", error: null });

    const result = await createServiceJob(supabase, baseInput);

    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_service_job",
      expect.objectContaining({
        p_customer_mobile: "9876543210",
        p_vehicle_number: "TN37AB1234",
        p_odometer_reading: 12000,
        p_lines: [
          {
            line_type: "PACKAGE",
            general_service_package_id: "11111111-1111-4111-8111-111111111101",
            specific_service_id: null,
            combo_id: null,
            combo_contents: null,
            description: null,
            quantity: 1,
            rate: 650,
          },
          {
            line_type: "SPECIFIC",
            general_service_package_id: null,
            specific_service_id: "22222222-2222-4222-8222-222222222201",
            combo_id: null,
            combo_contents: null,
            description: null,
            quantity: 1,
            rate: 150,
          },
        ],
        p_usage: [
          { inventory_item_id: "33333333-3333-4333-8333-333333333301", quantity_used: 1, combo_id: null, included_in_combo: false },
        ],
      })
    );
    expect(result.jobNumber).toBe("SJ-000001");
  });

  it("accepts a job with zero lines (Draft with nothing decided yet, doc §4/§6)", async () => {
    const builder = createQueryBuilderMock({ data: { ...jobRow }, error: null });
    const supabase = createSupabaseMock(builder, { data: "44444444-4444-4444-8444-444444444401", error: null });

    await createServiceJob(supabase, { ...baseInput, lines: [], usage: [] });

    expect(supabase.rpc).toHaveBeenCalledWith("create_service_job", expect.objectContaining({ p_lines: [], p_usage: [] }));
  });

  it("throws StockAdjustmentAuthError on 42501 (non-admin caller)", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "42501", message: "not authorized" } });

    await expect(createServiceJob(supabase, baseInput)).rejects.toBeInstanceOf(StockAdjustmentAuthError);
  });

  it("throws ServiceCatalogEntryUnavailableError on P0002 (unknown package/specific service)", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "P0002", message: "not found" } });

    await expect(createServiceJob(supabase, baseInput)).rejects.toBeInstanceOf(ServiceCatalogEntryUnavailableError);
  });

  it("throws ServiceJobValidationError on 22023", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "22023", message: "bad input" } });

    await expect(createServiceJob(supabase, baseInput)).rejects.toBeInstanceOf(ServiceJobValidationError);
  });
});

describe("updateServiceJob", () => {
  it("calls update_service_job with the job id and full-replace line/usage arrays", async () => {
    const builder = createQueryBuilderMock({ data: jobRow, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    await updateServiceJob(supabase, "44444444-4444-4444-8444-444444444401", baseInput);

    expect(supabase.rpc).toHaveBeenCalledWith("update_service_job", expect.objectContaining({ p_service_job_id: "44444444-4444-4444-8444-444444444401" }));
  });

  it("throws ServiceJobValidationError when the job is no longer editable (22023 — not Draft/In Progress)", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "22023", message: "not editable" } });

    await expect(updateServiceJob(supabase, "44444444-4444-4444-8444-444444444401", baseInput)).rejects.toBeInstanceOf(ServiceJobValidationError);
  });
});

describe("updateServiceJobStatus", () => {
  it("calls update_service_job_status with the requested transition", async () => {
    const builder = createQueryBuilderMock({ data: jobRow, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    await updateServiceJobStatus(supabase, { serviceJobId: "44444444-4444-4444-8444-444444444401", newStatus: "IN_PROGRESS" });

    expect(supabase.rpc).toHaveBeenCalledWith("update_service_job_status", {
      p_service_job_id: "44444444-4444-4444-8444-444444444401",
      p_new_status: "IN_PROGRESS",
      p_note: null,
    });
  });

  it("throws ServiceJobValidationError on an invalid transition (22023 — e.g. backward, or into COMPLETED)", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "22023", message: "Cannot move" } });

    await expect(updateServiceJobStatus(supabase, { serviceJobId: "44444444-4444-4444-8444-444444444401", newStatus: "CANCELLED" })).rejects.toBeInstanceOf(
      ServiceJobValidationError
    );
  });
});

describe("completeServiceJob", () => {
  it("calls complete_service_job and refetches the completed job", async () => {
    const completedRow = { ...jobRow, status: "COMPLETED", invoice_number: "TW-J-000001", payment_status: "PENDING", delivery_status: "WAITING" };
    const builder = createQueryBuilderMock({ data: completedRow, error: null });
    const supabase = createSupabaseMock(builder, { data: "TW-J-000001", error: null });

    const result = await completeServiceJob(supabase, "44444444-4444-4444-8444-444444444401");

    expect(supabase.rpc).toHaveBeenCalledWith("complete_service_job", { p_service_job_id: "44444444-4444-4444-8444-444444444401" });
    expect(result.status).toBe("COMPLETED");
    expect(result.invoiceNumber).toBe("TW-J-000001");
  });

  it("throws InsufficientStockError on P0001 (a usage line exceeds available stock)", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "P0001", message: "insufficient" } });

    await expect(completeServiceJob(supabase, "44444444-4444-4444-8444-444444444401")).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it("throws ServiceJobValidationError on 22023 (e.g. zero lines, or wrong starting status)", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "22023", message: "needs at least one line" } });

    await expect(completeServiceJob(supabase, "44444444-4444-4444-8444-444444444401")).rejects.toBeInstanceOf(ServiceJobValidationError);
  });
});

describe("updateServicePaymentStatus / updateServiceDeliveryStatus", () => {
  it("PAY-111: calls update_service_payment_status with the job id and the tender fields", async () => {
    const builder = createQueryBuilderMock({ data: jobRow, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    await updateServicePaymentStatus(supabase, {
      serviceJobId: "44444444-4444-4444-8444-444444444401",
      payment: { mode: "SPLIT", cashAmount: 400, upiAmount: 750 },
    });

    expect(supabase.rpc).toHaveBeenCalledWith("update_service_payment_status", {
      p_service_job_id: "44444444-4444-4444-8444-444444444401",
      p_payment_mode: "SPLIT",
      p_cash_amount: 400,
      p_upi_amount: 750,
      p_free_service: false,
    });
  });

  it("PAY-112: a free service sends the flag with no mode and zero amounts, whatever was typed", async () => {
    const builder = createQueryBuilderMock({ data: jobRow, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    await updateServicePaymentStatus(supabase, {
      serviceJobId: "44444444-4444-4444-8444-444444444401",
      payment: { mode: "CASH", cashAmount: 500, upiAmount: 0, freeService: true },
    });

    expect(supabase.rpc).toHaveBeenCalledWith("update_service_payment_status", {
      p_service_job_id: "44444444-4444-4444-8444-444444444401",
      p_payment_mode: null,
      p_cash_amount: 0,
      p_upi_amount: 0,
      p_free_service: true,
    });
  });

  it("throws ServiceJobValidationError when the job isn't Completed yet (22023)", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "22023", message: "not completed" } });

    await expect(
      updateServicePaymentStatus(supabase, {
        serviceJobId: "44444444-4444-4444-8444-444444444401",
        payment: { mode: "CASH", cashAmount: 1150, upiAmount: 0 },
      })
    ).rejects.toBeInstanceOf(ServiceJobValidationError);
  });

  it("calls update_service_delivery_status with the job id and status", async () => {
    const builder = createQueryBuilderMock({ data: jobRow, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    await updateServiceDeliveryStatus(supabase, { serviceJobId: "44444444-4444-4444-8444-444444444401", deliveryStatus: "DELIVERED" });

    expect(supabase.rpc).toHaveBeenCalledWith("update_service_delivery_status", {
      p_service_job_id: "44444444-4444-4444-8444-444444444401",
      p_delivery_status: "DELIVERED",
    });
  });
});

describe("saveAndCompleteServiceJob", () => {
  const jobId = "44444444-4444-4444-8444-444444444401";
  const completedRow = { ...jobRow, status: "COMPLETED", invoice_number: "TW-J-000001" };

  function rpcNames(supabase: { rpc: { mock: { calls: unknown[][] } } }) {
    return supabase.rpc.mock.calls.map((call) => call[0]);
  }

  it("marks the vehicle delivered after completing, when the counter ticked handover", async () => {
    const builder = createQueryBuilderMock({ data: completedRow, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    await saveAndCompleteServiceJob(supabase, {
      serviceJobId: jobId,
      jobInput: baseInput,
      payment: { mode: "CASH", cashAmount: 1150, upiAmount: 0 },
      deliveryStatus: "DELIVERED",
    });

    // Order matters: update_service_delivery_status() rejects a job that
    // isn't COMPLETED yet, so it has to run after complete_service_job.
    const names = rpcNames(supabase);
    expect(names).toContain("update_service_delivery_status");
    expect(names.indexOf("update_service_delivery_status")).toBeGreaterThan(names.indexOf("complete_service_job"));
    expect(supabase.rpc).toHaveBeenCalledWith("update_service_delivery_status", {
      p_service_job_id: jobId,
      p_delivery_status: "DELIVERED",
    });
  });

  it("leaves delivery status untouched when handover wasn't ticked", async () => {
    const builder = createQueryBuilderMock({ data: completedRow, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    await saveAndCompleteServiceJob(supabase, { serviceJobId: jobId, jobInput: baseInput, payment: { mode: "CASH", cashAmount: 1150, upiAmount: 0 } });

    expect(rpcNames(supabase)).not.toContain("update_service_delivery_status");
  });

  it("applies neither status when the job is completed with both left unticked", async () => {
    const builder = createQueryBuilderMock({ data: completedRow, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    await saveAndCompleteServiceJob(supabase, { serviceJobId: jobId, jobInput: baseInput });

    const names = rpcNames(supabase);
    expect(names).toContain("complete_service_job");
    expect(names).not.toContain("update_service_payment_status");
    expect(names).not.toContain("update_service_delivery_status");
  });
});

describe("findActiveServiceJobsForVehicle", () => {
  it("queries only DRAFT/IN_PROGRESS/READY_FOR_DELIVERY jobs for the vehicle", async () => {
    const builder = createQueryBuilderMock({ data: [jobRow], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await findActiveServiceJobsForVehicle(supabase, "99999999-9999-4999-8999-999999999901");

    expect(builder.eq).toHaveBeenCalledWith("vehicle_id", "99999999-9999-4999-8999-999999999901");
    expect(builder.in).toHaveBeenCalledWith("status", ["DRAFT", "IN_PROGRESS", "READY_FOR_DELIVERY"]);
    expect(result).toHaveLength(1);
  });

  it("returns an empty array when no active job exists for the vehicle", async () => {
    const builder = createQueryBuilderMock({ data: [], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await findActiveServiceJobsForVehicle(supabase, "99999999-9999-4999-8999-999999999902");

    expect(result).toEqual([]);
  });
});

// Backfilled alongside the Customer & Vehicle module
// (doc/customer-vehicle-scope.md §2b/§2d) — this function predates that
// module but had no test coverage before it became directly user-facing on
// the Customer Detail screen.
describe("listServiceJobsForVehicle", () => {
  it("returns jobs scoped to one vehicle, newest first", async () => {
    const builder = createQueryBuilderMock({ data: [jobRow], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listServiceJobsForVehicle(supabase, "99999999-9999-4999-8999-999999999901");

    expect(builder.eq).toHaveBeenCalledWith("vehicle_id", "99999999-9999-4999-8999-999999999901");
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(result).toHaveLength(1);
    expect(result[0].jobNumber).toBe("SJ-000001");
  });

  it("returns an empty array for a freshly-registered vehicle with no jobs", async () => {
    const builder = createQueryBuilderMock({ data: [], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listServiceJobsForVehicle(supabase, "99999999-9999-4999-8999-9999999999ff");

    expect(result).toEqual([]);
  });
});

// Backfilled alongside the Customer & Vehicle module
// (doc/customer-vehicle-scope.md §2b) — powers Customer Detail's Service
// History section (jobs across *all* of a customer's vehicles, unlike
// listServiceJobsForVehicle above).
describe("listServiceJobsForCustomer", () => {
  it("returns jobs for the customer across all their vehicles, newest first", async () => {
    const builder = createQueryBuilderMock({ data: [jobRow], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listServiceJobsForCustomer(supabase, "88888888-8888-4888-8888-888888888801");

    expect(builder.eq).toHaveBeenCalledWith("customer_id", "88888888-8888-4888-8888-888888888801");
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(result[0].customerName).toBe("Arun Kumar");
    expect(result[0].vehicleNumber).toBe("TN37AB1234");
  });

  // The joined customers/vehicles relations can come back as an array
  // instead of a single object depending on how PostgREST resolves the
  // embed — mapServiceJob's firstOrSelf() must unwrap either shape.
  it("unwraps array-shaped joined customers/vehicles the same as a single object", async () => {
    const arrayJoinedRow = {
      ...jobRow,
      customers: [{ name: "Arun Kumar", mobile_number: "9876543210", address: "Coimbatore" }],
      vehicles: [{ vehicle_number: "TN37AB1234", vehicle_model: "KTM Duke 390" }],
    };
    const builder = createQueryBuilderMock({ data: [arrayJoinedRow], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listServiceJobsForCustomer(supabase, "88888888-8888-4888-8888-888888888801");

    expect(result[0].customerName).toBe("Arun Kumar");
    expect(result[0].vehicleNumber).toBe("TN37AB1234");
  });

  it("returns an empty array for a customer with no service history yet", async () => {
    const builder = createQueryBuilderMock({ data: [], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listServiceJobsForCustomer(supabase, "cust-sales-only");

    expect(result).toEqual([]);
  });
});

// Backfilled alongside the Customer & Vehicle module
// (doc/customer-vehicle-scope.md §2c) — already used by the Service Job
// form's "Last service: ..." hint but had no direct test coverage.
describe("getLastCompletedServiceForVehicle", () => {
  it("returns the mapped summary, filtered to COMPLETED and ordered newest-first", async () => {
    const builder = createQueryBuilderMock({
      data: { job_number: "SJ-000001", invoice_number: "TW-SV-000001", completed_at: "2026-07-20T10:00:00.000Z" },
      error: null,
    });
    const supabase = createSupabaseMock(builder);

    const result = await getLastCompletedServiceForVehicle(supabase, "99999999-9999-4999-8999-999999999901");

    expect(builder.eq).toHaveBeenCalledWith("status", "COMPLETED");
    expect(builder.order).toHaveBeenCalledWith("completed_at", { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(1);
    expect(result).toEqual({
      jobNumber: "SJ-000001",
      invoiceNumber: "TW-SV-000001",
      completedAt: "2026-07-20T10:00:00.000Z",
    });
  });

  it("returns null when the vehicle has no completed job (only in-progress/draft ones, which the query never asks for)", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    const result = await getLastCompletedServiceForVehicle(supabase, "veh-in-progress-only");

    expect(result).toBeNull();
  });

  it("returns null rather than throwing when completed_at is unexpectedly missing", async () => {
    const builder = createQueryBuilderMock({
      data: { job_number: "SJ-000002", invoice_number: null, completed_at: null },
      error: null,
    });
    const supabase = createSupabaseMock(builder);

    const result = await getLastCompletedServiceForVehicle(supabase, "99999999-9999-4999-8999-999999999902");

    expect(result).toBeNull();
  });
});

describe("getServiceStats", () => {
  it("splits gross completed revenue from collected revenue by excluding FREE_SERVICE jobs (doc §23)", async () => {
    const rows = [
      { grand_total: 1000, payment_status: "PAID" },
      { grand_total: 500, payment_status: "FREE_SERVICE" },
      { grand_total: 750, payment_status: "PENDING" },
    ];
    const builder = createQueryBuilderMock({ data: rows, error: null });
    const supabase = createSupabaseMock(builder);

    const result = await getServiceStats(supabase);

    expect(result.grossCompletedRevenue).toBe(2250);
    expect(result.collectedRevenue).toBe(1750);
    expect(result.completedJobCount).toBe(3);
  });

  it("filters on status COMPLETED only", async () => {
    const builder = createQueryBuilderMock({ data: [], error: null });
    const supabase = createSupabaseMock(builder);

    await getServiceStats(supabase);

    expect(builder.eq).toHaveBeenCalledWith("status", "COMPLETED");
  });
});

describe("assigned mechanic", () => {
  const MECHANIC_ID = "77777777-7777-4777-8777-777777777701";

  it("filters the list by a mechanic id", async () => {
    const builder = createQueryBuilderMock({ data: [], error: null, count: 0 });
    const supabase = createSupabaseMock(builder);

    await listServiceJobs(supabase, { page: 1, pageSize: 20, assignedMechanicId: MECHANIC_ID });

    expect(builder.eq).toHaveBeenCalledWith("assigned_mechanic_id", MECHANIC_ID);
    expect(builder.is).not.toHaveBeenCalled();
  });

  it("filters to unassigned jobs on the UNASSIGNED sentinel", async () => {
    const builder = createQueryBuilderMock({ data: [], error: null, count: 0 });
    const supabase = createSupabaseMock(builder);

    await listServiceJobs(supabase, { page: 1, pageSize: 20, assignedMechanicId: "UNASSIGNED" });

    expect(builder.is).toHaveBeenCalledWith("assigned_mechanic_id", null);
    expect(builder.eq).not.toHaveBeenCalledWith("assigned_mechanic_id", "UNASSIGNED");
  });

  it("adds no assignment predicate when the filter is absent", async () => {
    const builder = createQueryBuilderMock({ data: [], error: null, count: 0 });
    const supabase = createSupabaseMock(builder);

    await listServiceJobs(supabase, { page: 1, pageSize: 20 });

    expect(builder.is).not.toHaveBeenCalled();
    expect(builder.eq).not.toHaveBeenCalledWith("assigned_mechanic_id", expect.anything());
  });

  it("maps the joined mechanic name onto the row", async () => {
    const builder = createQueryBuilderMock({
      data: { ...jobRow, assigned_mechanic_id: MECHANIC_ID, assigned_mechanic: { full_name: "Anand" } },
      error: null,
    });

    const job = await getServiceJob(createSupabaseMock(builder), jobRow.id);

    expect(job.assignedMechanicId).toBe(MECHANIC_ID);
    expect(job.assignedMechanicName).toBe("Anand");
  });

  it("maps an unassigned job to nulls without crashing", async () => {
    const builder = createQueryBuilderMock({
      data: { ...jobRow, assigned_mechanic_id: null, assigned_mechanic: null },
      error: null,
    });

    const job = await getServiceJob(createSupabaseMock(builder), jobRow.id);

    expect(job.assignedMechanicId).toBeNull();
    expect(job.assignedMechanicName).toBeNull();
  });

  it("passes the assignment through to create_service_job", async () => {
    const builder = createQueryBuilderMock({ data: jobRow, error: null });
    const supabase = createSupabaseMock(builder, { data: jobRow.id, error: null });

    await createServiceJob(supabase, { ...baseInput, assignedMechanicId: MECHANIC_ID });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_service_job",
      expect.objectContaining({ p_assigned_mechanic_id: MECHANIC_ID })
    );
  });

  it("sends null to update_service_job when the job is unassigned", async () => {
    const builder = createQueryBuilderMock({ data: jobRow, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    await updateServiceJob(supabase, jobRow.id, baseInput);

    expect(supabase.rpc).toHaveBeenCalledWith(
      "update_service_job",
      expect.objectContaining({ p_assigned_mechanic_id: null })
    );
  });
});
