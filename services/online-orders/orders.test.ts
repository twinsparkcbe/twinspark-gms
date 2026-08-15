import { describe, expect, it, vi } from "vitest";

import { InsufficientStockError } from "@/services/shared/stock";

import { createQueryBuilderMock, createSupabaseMock } from "../../test/supabase-query-mock";
import {
  approveOnlineOrder,
  dispatchOnlineOrder,
  getOnlineOrderStats,
  getOnlineOrdersReportStats,
  getPaymentScreenshotSignedUrl,
  getTrackTyrePrices,
  InvalidScreenshotError,
  listOnlineOrders,
  listOnlineOrdersByIds,
  OnlineOrderAuthError,
  OnlineOrderTransitionError,
  OnlineOrderValidationError,
  rejectOnlineOrder,
  submitOnlineOrder,
  uploadPaymentScreenshot,
  verifyOnlineOrderPayment,
} from "./orders";

const validSubmitInput = {
  customerName: "Ravi Kumar",
  mobileNumber: "9876543210",
  address: "12 Race Course Road, Coimbatore",
  pinCode: "641018",
  quantityFront: 1,
  quantityBack: 0,
  paymentScreenshotPath: "abc123.jpg",
};

const joinedRow = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01",
  customer_name: "Ravi Kumar",
  mobile_number: "9876543210",
  address: "12 Race Course Road, Coimbatore",
  pin_code: "641018",
  quantity_front: 1,
  quantity_back: 0,
  payment_screenshot_path: "abc123.jpg",
  unit_price_front: 4500,
  unit_price_back: null,
  total_amount: 4500,
  status: "SUBMITTED",
  rejection_reason: null,
  submitted_at: "2026-07-01T10:00:00.000Z",
  verified_by: null,
  verified_at: null,
  approved_by: null,
  approved_at: null,
  dispatched_by: null,
  dispatched_at: null,
  rejected_by: null,
  rejected_at: null,
  created_at: "2026-07-01T10:00:00.000Z",
};

// ORD-010: happy path — RPC called with the right args, returns the new id.
describe("submitOnlineOrder", () => {
  it("calls submit_online_order with the right params and returns the new id", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01", error: null });

    const result = await submitOnlineOrder(supabase, validSubmitInput);

    expect(supabase.rpc).toHaveBeenCalledWith("submit_online_order", {
      p_customer_name: "Ravi Kumar",
      p_mobile_number: "9876543210",
      p_address: "12 Race Course Road, Coimbatore",
      p_pin_code: "641018",
      p_quantity_front: 1,
      p_quantity_back: 0,
      p_payment_screenshot_path: "abc123.jpg",
    });
    expect(result).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01");
  });

  // ORD-011: both quantities zero rejected before ever calling Supabase.
  it("throws a validation error without calling Supabase when both quantities are zero", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(
      submitOnlineOrder(supabase, { ...validSubmitInput, quantityFront: 0, quantityBack: 0 })
    ).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("throws OnlineOrderValidationError on DB error code 22023", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "22023", message: "bad input" } });

    await expect(submitOnlineOrder(supabase, validSubmitInput)).rejects.toBeInstanceOf(OnlineOrderValidationError);
  });
});

describe("uploadPaymentScreenshot", () => {
  function makeStorageMock(uploadResult: { error: { message: string } | null }) {
    return {
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(() => Promise.resolve(uploadResult)),
        })),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  // ORD-020: happy path — uploads and returns a storage path (not a public URL).
  it("uploads a valid image and returns its storage path", async () => {
    const supabase = makeStorageMock({ error: null });
    const file = new File(["fake-image-bytes"], "screenshot.jpg", { type: "image/jpeg" });

    const path = await uploadPaymentScreenshot(supabase, file);

    expect(supabase.storage.from).toHaveBeenCalledWith("online-order-screenshots");
    expect(path).toMatch(/\.jpg$/);
  });

  // ORD-021: only PNG/JPEG/WEBP allowed.
  it("rejects a disallowed file type without calling Supabase", async () => {
    const supabase = makeStorageMock({ error: null });
    const file = new File(["fake"], "screenshot.pdf", { type: "application/pdf" });

    await expect(uploadPaymentScreenshot(supabase, file)).rejects.toBeInstanceOf(InvalidScreenshotError);
    expect(supabase.storage.from).not.toHaveBeenCalled();
  });

  // ORD-022: 5MB size cap.
  it("rejects a file over 5MB without calling Supabase", async () => {
    const supabase = makeStorageMock({ error: null });
    const oversized = new Uint8Array(6 * 1024 * 1024);
    const file = new File([oversized], "big.png", { type: "image/png" });

    await expect(uploadPaymentScreenshot(supabase, file)).rejects.toBeInstanceOf(InvalidScreenshotError);
    expect(supabase.storage.from).not.toHaveBeenCalled();
  });

  it("surfaces a Supabase storage error", async () => {
    const supabase = makeStorageMock({ error: { message: "network error" } });
    const file = new File(["fake"], "screenshot.jpg", { type: "image/jpeg" });

    await expect(uploadPaymentScreenshot(supabase, file)).rejects.toThrow("network error");
  });
});

describe("getPaymentScreenshotSignedUrl", () => {
  it("returns the signed URL from Supabase", async () => {
    const supabase = {
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: vi.fn(() => Promise.resolve({ data: { signedUrl: "https://signed.example/abc" }, error: null })),
        })),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const url = await getPaymentScreenshotSignedUrl(supabase, "abc123.jpg");
    expect(url).toBe("https://signed.example/abc");
  });
});

describe("getTrackTyrePrices", () => {
  // ORD-071: powers the public order form's per-tyre price display.
  it("maps Front/Back rows by product_name", async () => {
    const supabase = {
      rpc: vi.fn(() =>
        Promise.resolve({
          data: [
            { product_name: "Track Tyre - Front", selling_price: 4500 },
            { product_name: "Track Tyre - Back", selling_price: 5200 },
          ],
          error: null,
        })
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await getTrackTyrePrices(supabase);
    expect(result).toEqual({ front: 4500, back: 5200 });
  });

  // ORD-072: a position with no active item yet comes back null, not an error.
  it("returns null for a position with no active item", async () => {
    const supabase = {
      rpc: vi.fn(() =>
        Promise.resolve({ data: [{ product_name: "Track Tyre - Front", selling_price: 4500 }], error: null })
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await getTrackTyrePrices(supabase);
    expect(result).toEqual({ front: 4500, back: null });
  });

  it("surfaces a Supabase error", async () => {
    const supabase = {
      rpc: vi.fn(() => Promise.resolve({ data: null, error: { message: "db error" } })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await expect(getTrackTyrePrices(supabase)).rejects.toThrow("db error");
  });
});

describe("listOnlineOrders", () => {
  // ORD-030: pagination.
  it("applies range based on page/pageSize", async () => {
    const builder = createQueryBuilderMock({ data: [joinedRow], error: null, count: 1 });
    const supabase = createSupabaseMock(builder);

    await listOnlineOrders(supabase, { page: 2, pageSize: 10 });

    expect(builder.range).toHaveBeenCalledWith(10, 19);
  });

  // ORD-031: status filter.
  it("applies a status filter", async () => {
    const builder = createQueryBuilderMock({ data: [], error: null, count: 0 });
    const supabase = createSupabaseMock(builder);

    await listOnlineOrders(supabase, { page: 1, pageSize: 20, statuses: ["SUBMITTED", "PAYMENT_VERIFIED"] });

    expect(builder.in).toHaveBeenCalledWith("status", ["SUBMITTED", "PAYMENT_VERIFIED"]);
  });

  it.each([
    ["newest", false],
    ["oldest", true],
  ] as const)("sorts by %s", async (sortBy, ascending) => {
    const builder = createQueryBuilderMock({ data: [], error: null, count: 0 });
    const supabase = createSupabaseMock(builder);

    await listOnlineOrders(supabase, { page: 1, pageSize: 20, sortBy });

    expect(builder.order).toHaveBeenCalledWith("submitted_at", { ascending });
  });

  it("returns mapped orders and total count", async () => {
    const builder = createQueryBuilderMock({ data: [joinedRow], error: null, count: 1 });
    const supabase = createSupabaseMock(builder);

    const result = await listOnlineOrders(supabase, { page: 1, pageSize: 20 });
    expect(result.total).toBe(1);
    expect(result.orders[0].customerName).toBe("Ravi Kumar");
    expect(result.orders[0].quantityFront).toBe(1);
    // ORD-070: pricing snapshot — unpriced position stays null, not 0.
    expect(result.orders[0].unitPriceFront).toBe(4500);
    expect(result.orders[0].unitPriceBack).toBeNull();
    expect(result.orders[0].totalAmount).toBe(4500);
  });
});

describe("listOnlineOrdersByIds", () => {
  // ORD-040: powers Courier Label Export.
  it("returns an empty array without calling Supabase when given no ids", async () => {
    const builder = createQueryBuilderMock({ data: [], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listOnlineOrdersByIds(supabase, []);
    expect(result).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("fetches and maps the given ids", async () => {
    const builder = createQueryBuilderMock({ data: [joinedRow], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listOnlineOrdersByIds(supabase, ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01"]);
    expect(builder.in).toHaveBeenCalledWith("id", ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01"]);
    expect(result).toHaveLength(1);
  });
});

describe("getOnlineOrderStats", () => {
  // ORD-050: queue-depth counts per status, plus dispatched-this-month.
  it("returns counts for each queue status", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null, count: 3 });
    const supabase = createSupabaseMock(builder);

    const result = await getOnlineOrderStats(supabase);

    expect(result.submittedCount).toBe(3);
    expect(result.paymentVerifiedCount).toBe(3);
    expect(result.approvedCount).toBe(3);
    expect(result.dispatchedThisMonthCount).toBe(3);
  });
});

// doc/reports-scope.md §9 — deliberately a separate function from
// getOnlineOrderStats above (see its own header comment): that one is a
// live queue-depth snapshot, this one answers "what happened in this
// range," keyed off each event's own timestamp.
describe("getOnlineOrdersReportStats", () => {
  const RANGE = { from: new Date("2026-07-01T00:00:00.000Z"), to: new Date("2026-07-31T23:59:59.999Z") };

  function mockThreeQueries(
    submittedResult: { data: unknown; error: unknown; count?: number | null },
    dispatchedResult: { data: unknown; error: unknown },
    rejectedResult: { data: unknown; error: unknown; count?: number | null }
  ) {
    const results = [submittedResult, dispatchedResult, rejectedResult];
    let call = 0;
    return {
      from: () => createQueryBuilderMock(results[call++] as never),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it("counts orders submitted in the range regardless of current status", async () => {
    const supabase = mockThreeQueries({ data: null, error: null, count: 12 }, { data: [], error: null }, { data: null, error: null, count: 0 });

    const result = await getOnlineOrdersReportStats(supabase, RANGE);

    expect(result.submittedCount).toBe(12);
  });

  it("counts and sums dispatched orders in the range, scoped by dispatched_at", async () => {
    const dispatched = [{ total_amount: 2000 }, { total_amount: 3500 }];
    const supabase = mockThreeQueries({ data: null, error: null, count: 0 }, { data: dispatched, error: null }, { data: null, error: null, count: 0 });

    const result = await getOnlineOrdersReportStats(supabase, RANGE);

    expect(result.dispatchedCount).toBe(2);
    expect(result.dispatchedAmount).toBe(5500);
  });

  it("counts rejected orders in the range, scoped by rejected_at", async () => {
    const supabase = mockThreeQueries({ data: null, error: null, count: 0 }, { data: [], error: null }, { data: null, error: null, count: 4 });

    const result = await getOnlineOrdersReportStats(supabase, RANGE);

    expect(result.rejectedCount).toBe(4);
  });

  it("throws on a Supabase error from any of the three queries", async () => {
    const supabase = mockThreeQueries({ data: null, error: { message: "boom" } }, { data: [], error: null }, { data: null, error: null, count: 0 });

    await expect(getOnlineOrdersReportStats(supabase, RANGE)).rejects.toThrow("boom");
  });
});

describe("verifyOnlineOrderPayment", () => {
  it("calls verify_online_order_payment with the order id", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    await verifyOnlineOrderPayment(supabase, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01");
    expect(supabase.rpc).toHaveBeenCalledWith("verify_online_order_payment", { p_order_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01" });
  });

  // ORD-060: wrong status or missing order surfaces as OnlineOrderTransitionError.
  it("throws OnlineOrderTransitionError on DB error code P0002", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "P0002", message: "not found" } });

    await expect(verifyOnlineOrderPayment(supabase, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01")).rejects.toBeInstanceOf(OnlineOrderTransitionError);
  });

  it("throws OnlineOrderAuthError on DB error code 42501", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "42501", message: "not authorized" } });

    await expect(verifyOnlineOrderPayment(supabase, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01")).rejects.toBeInstanceOf(OnlineOrderAuthError);
  });
});

describe("approveOnlineOrder", () => {
  it("calls approve_online_order with the order id", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    await approveOnlineOrder(supabase, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01");
    expect(supabase.rpc).toHaveBeenCalledWith("approve_online_order", { p_order_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01" });
  });

  it("throws OnlineOrderTransitionError when payment hasn't been verified yet", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "P0002", message: "not verified" } });

    await expect(approveOnlineOrder(supabase, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01")).rejects.toBeInstanceOf(OnlineOrderTransitionError);
  });
});

describe("dispatchOnlineOrder", () => {
  it("calls dispatch_online_order with the order id", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    await dispatchOnlineOrder(supabase, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01");
    expect(supabase.rpc).toHaveBeenCalledWith("dispatch_online_order", { p_order_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01" });
  });

  // ORD-061: insufficient Track Tyre stock blocks dispatch with a clear error
  // (doc/online-orders-scope.md §2/§7) rather than letting stock go negative.
  it("throws InsufficientStockError on DB error code P0001", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "P0001", message: "insufficient" } });

    await expect(dispatchOnlineOrder(supabase, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01")).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it("throws OnlineOrderTransitionError when the order isn't approved yet", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "P0002", message: "not approved" } });

    await expect(dispatchOnlineOrder(supabase, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01")).rejects.toBeInstanceOf(OnlineOrderTransitionError);
  });
});

describe("rejectOnlineOrder", () => {
  it("calls reject_online_order with the order id and reason", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    await rejectOnlineOrder(supabase, { orderId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01", reason: "Screenshot unreadable" });
    expect(supabase.rpc).toHaveBeenCalledWith("reject_online_order", {
      p_order_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01",
      p_reason: "Screenshot unreadable",
    });
  });

  // ORD-062: blank reason rejected client-side before calling Supabase.
  it("throws a validation error without calling Supabase for a blank reason", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(rejectOnlineOrder(supabase, { orderId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01", reason: "   " })).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  // ORD-063: rejecting an already-dispatched order is blocked server-side.
  it("throws OnlineOrderTransitionError when the order is past the rejectable window", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, {
      data: null,
      error: { code: "P0002", message: "already past the point it can be rejected" },
    });

    await expect(rejectOnlineOrder(supabase, { orderId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01", reason: "x" })).rejects.toBeInstanceOf(
      OnlineOrderTransitionError
    );
  });
});
