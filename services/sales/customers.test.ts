import { describe, expect, it } from "vitest";

import { createQueryBuilderMock, createSupabaseMock } from "../../test/supabase-query-mock";
import {
  CustomerNotFoundError,
  getCustomerById,
  getCustomerByMobile,
  listAllCustomersForPicker,
  listCustomers,
  searchCustomers,
} from "./customers";

const customerRow = {
  id: "cust-1",
  name: "Arun Kumar",
  mobile_number: "9876543210",
  address: "12 Race Course Road, Coimbatore",
  created_at: "2026-07-01T09:00:00.000Z",
};

describe("searchCustomers", () => {
  // SALE-003: partial mobile number (or name) surfaces matching customers.
  it("searches by name OR mobile number and maps the results", async () => {
    const builder = createQueryBuilderMock({ data: [customerRow], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await searchCustomers(supabase, "987");

    expect(builder.or).toHaveBeenCalledWith("name.ilike.%987%,mobile_number.ilike.%987%");
    expect(builder.limit).toHaveBeenCalledWith(10);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "cust-1",
      name: "Arun Kumar",
      mobileNumber: "9876543210",
      address: "12 Race Course Road, Coimbatore",
      createdAt: "2026-07-01T09:00:00.000Z",
    });
  });

  it("returns an empty array without querying for a blank/whitespace query", async () => {
    const builder = createQueryBuilderMock({ data: [customerRow], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await searchCustomers(supabase, "   ");

    expect(result).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("getCustomerByMobile", () => {
  // SALE-002: exact mobile match auto-fills name/address.
  it("returns the mapped customer on an exact match", async () => {
    const builder = createQueryBuilderMock({ data: customerRow, error: null });
    const supabase = createSupabaseMock(builder);

    const result = await getCustomerByMobile(supabase, "9876543210");

    expect(builder.eq).toHaveBeenCalledWith("mobile_number", "9876543210");
    expect(result?.name).toBe("Arun Kumar");
  });

  it("returns null when no customer matches", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    const result = await getCustomerByMobile(supabase, "0000000000");

    expect(result).toBeNull();
  });
});

describe("listCustomers", () => {
  it("returns paginated results with a total count", async () => {
    const builder = createQueryBuilderMock({ data: [customerRow], error: null, count: 1 });
    const supabase = createSupabaseMock(builder);

    const result = await listCustomers(supabase, { page: 1, pageSize: 20 });

    expect(result.total).toBe(1);
    expect(result.customers).toHaveLength(1);
  });
});

describe("getCustomerById", () => {
  // Powers the Customer Detail page (doc/customer-vehicle-scope.md §2b).
  it("returns the mapped customer on a match", async () => {
    const builder = createQueryBuilderMock({ data: customerRow, error: null });
    const supabase = createSupabaseMock(builder);

    const result = await getCustomerById(supabase, "cust-1");

    expect(builder.eq).toHaveBeenCalledWith("id", "cust-1");
    expect(result.name).toBe("Arun Kumar");
  });

  it("throws CustomerNotFoundError when no customer matches", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(getCustomerById(supabase, "missing")).rejects.toBeInstanceOf(CustomerNotFoundError);
  });
});

// New Sale's Mobile Number field filters this list entirely client-side —
// fetched once here instead of per-keystroke (see customer-field.tsx).
describe("listAllCustomersForPicker", () => {
  it("fetches all customers ordered by name, mapped, no search filter", async () => {
    const builder = createQueryBuilderMock({ data: [customerRow], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listAllCustomersForPicker(supabase);

    expect(builder.order).toHaveBeenCalledWith("name", { ascending: true });
    expect(builder.limit).toHaveBeenCalledWith(5000);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Arun Kumar");
  });
});
