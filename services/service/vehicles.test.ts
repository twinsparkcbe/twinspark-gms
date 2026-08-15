import { describe, expect, it } from "vitest";

import { createQueryBuilderMock, createSupabaseMock } from "../../test/supabase-query-mock";
import { VehicleNotFoundError, getVehicleWithOwner, listVehiclesForCustomer, listVehiclesWithOwner } from "./vehicles";

const vehicleRow = {
  id: "veh-1",
  customer_id: "cust-1",
  vehicle_number: "TN37AB1234",
  vehicle_model: "KTM Duke 390",
  latest_odometer_reading: 12000,
  created_at: "2026-07-16T10:00:00.000Z",
};

const vehicleRowNeverServiced = {
  id: "veh-2",
  customer_id: "cust-1",
  vehicle_number: "TN37AB5678",
  vehicle_model: "Royal Enfield Classic 350",
  latest_odometer_reading: null,
  created_at: "2026-07-20T10:00:00.000Z",
};

describe("listVehiclesForCustomer", () => {
  // Backfilled alongside the Customer & Vehicle module (doc/customer-vehicle-
  // scope.md §2b) — this function predates that module but had no test
  // coverage before it became directly user-facing.
  it("returns only vehicles for the given customer, newest first, mapping latest_odometer_reading", async () => {
    const builder = createQueryBuilderMock({ data: [vehicleRowNeverServiced, vehicleRow], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listVehiclesForCustomer(supabase, "cust-1");

    expect(builder.eq).toHaveBeenCalledWith("customer_id", "cust-1");
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(result).toHaveLength(2);
    expect(result[0].latestOdometerReading).toBeNull();
    expect(result[1].latestOdometerReading).toBe(12000);
  });

  it("returns an empty array for a customer with no vehicles yet", async () => {
    const builder = createQueryBuilderMock({ data: [], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listVehiclesForCustomer(supabase, "cust-2");

    expect(result).toEqual([]);
  });

  it("throws when the query errors", async () => {
    const builder = createQueryBuilderMock({ data: null, error: { message: "boom" } });
    const supabase = createSupabaseMock(builder);

    await expect(listVehiclesForCustomer(supabase, "cust-1")).rejects.toThrow("boom");
  });
});

describe("listVehiclesWithOwner", () => {
  it("returns vehicles ordered by vehicle number, joined with owner name/mobile", async () => {
    const builder = createQueryBuilderMock({
      data: [{ ...vehicleRow, customers: { name: "Arun Kumar", mobile_number: "9876543210" } }],
      error: null,
    });
    const supabase = createSupabaseMock(builder);

    const result = await listVehiclesWithOwner(supabase);

    expect(builder.order).toHaveBeenCalledWith("vehicle_number", { ascending: true });
    expect(builder.limit).toHaveBeenCalledWith(5000);
    expect(result[0]).toMatchObject({
      vehicleNumber: "TN37AB1234",
      customerName: "Arun Kumar",
      customerMobile: "9876543210",
    });
  });

  // Defensive fallback — shouldn't happen given the FK, but every other
  // embedded-relation mapper in this codebase handles it the same way.
  it("falls back to 'Unknown customer' if the owner join comes back empty", async () => {
    const builder = createQueryBuilderMock({ data: [{ ...vehicleRow, customers: null }], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listVehiclesWithOwner(supabase);

    expect(result[0].customerName).toBe("Unknown customer");
    expect(result[0].customerMobile).toBe("");
  });

  it("returns an empty array when there are no vehicles", async () => {
    const builder = createQueryBuilderMock({ data: [], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listVehiclesWithOwner(supabase);

    expect(result).toEqual([]);
  });

  it("throws when the query errors", async () => {
    const builder = createQueryBuilderMock({ data: null, error: { message: "boom" } });
    const supabase = createSupabaseMock(builder);

    await expect(listVehiclesWithOwner(supabase)).rejects.toThrow("boom");
  });
});

describe("getVehicleWithOwner", () => {
  it("returns the mapped vehicle with owner info on a match", async () => {
    const builder = createQueryBuilderMock({
      data: { ...vehicleRow, customers: { name: "Arun Kumar", mobile_number: "9876543210" } },
      error: null,
    });
    const supabase = createSupabaseMock(builder);

    const result = await getVehicleWithOwner(supabase, "veh-1");

    expect(builder.eq).toHaveBeenCalledWith("id", "veh-1");
    expect(result.customerName).toBe("Arun Kumar");
  });

  it("throws VehicleNotFoundError when no vehicle matches", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(getVehicleWithOwner(supabase, "missing")).rejects.toThrow(VehicleNotFoundError);
  });
});
