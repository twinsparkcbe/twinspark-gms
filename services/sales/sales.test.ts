import { describe, expect, it } from "vitest";

import { InsufficientStockError, StockAdjustmentAuthError } from "@/services/shared/stock";

import { createQueryBuilderMock, createSupabaseMock } from "../../test/supabase-query-mock";
import { getSale, getSalesStats, listSales, listSalesForCustomer, recordSale, updateSalePayment, SaleItemUnavailableError, SaleNotFoundError, SaleValidationError } from "./sales";
import type { SaleInput } from "./schemas";

const saleRow = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
  customer_id: "88888888-8888-4888-8888-888888888801",
  sale_date: "2026-07-13T10:00:00.000Z",
  gst_applicable: false,
  gst_amount: 0,
  discount_applicable: false,
  discount_amount: 0,
  subtotal: 3000,
  installation_total: 600,
  grand_total: 3600,
  invoice_number: "TW-S-000001",
  needs_service_followup: false,
  service_followup_note: null,
  created_at: "2026-07-13T10:00:00.000Z",
  customers: { name: "Arun Kumar", mobile_number: "9876543210", address: "12 Race Course Road, Coimbatore" },
  sale_items: [
    {
      id: "33333333-3333-4333-8333-333333333302",
      position: 2,
      line_type: "INSTALLATION",
      inventory_item_id: null,
      quantity: null,
      unit_selling_price: null,
      installation_subtype: "TYRE_FITTING",
      wheel_count: 2,
      description: null,
      amount: 600,
      installed_by: "Ravi",
      line_total: 600,
      inventory_items: null,
      sale_returns: [],
    },
    {
      id: "33333333-3333-4333-8333-333333333301",
      position: 1,
      line_type: "PRODUCT",
      inventory_item_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01",
      quantity: 2,
      unit_selling_price: 1500,
      installation_subtype: null,
      wheel_count: null,
      description: null,
      amount: null,
      installed_by: null,
      line_total: 3000,
      inventory_items: { product_name: "MRF Zapper", sku_code: "TYRE-001", item_type: "BRAND_NEW_TYRE" },
      sale_returns: [{ quantity: 1 }],
    },
  ],
};

const baseSaleInput: SaleInput = {
  customerName: "Arun Kumar",
  customerMobile: "9876543210",
  customerAddress: undefined,
  payment: { mode: "CASH", cashAmount: 3600, upiAmount: 0 },
  gstApplicable: false,
  gstAmount: 0,
  discountApplicable: false,
  discountAmount: 0,
  lines: [
    { lineType: "PRODUCT", inventoryItemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01", quantity: 2 },
    { lineType: "INSTALLATION", installationSubtype: "TYRE_FITTING", wheelCount: 2, installedBy: "Ravi" },
  ],
};

describe("getSale", () => {
  // SALE-028/029/030: the sale row carries its own invoice_number (TW-S-
  // prefixed) and grand_total directly — there's no separate `invoices`
  // table yet (Service doesn't exist to share one with), so "invoice_type"
  // is implicit in the TW-S- namespace rather than a literal column.
  it("maps a joined sale row, sorting line items by position", async () => {
    const builder = createQueryBuilderMock({ data: saleRow, error: null });
    const supabase = createSupabaseMock(builder);

    const result = await getSale(supabase, "dddddddd-dddd-4ddd-8ddd-dddddddddd01");

    expect(result.invoiceNumber).toBe("TW-S-000001");
    expect(result.invoiceNumber.startsWith("TW-S-")).toBe(true);
    expect(result.grandTotal).toBe(3600);
    expect(result.customerName).toBe("Arun Kumar");
    // SALE-018: itemized in the order added (position), not insertion/DB order.
    expect(result.lineItems.map((l) => l.position)).toEqual([1, 2]);
    expect(result.lineItems[0].lineType).toBe("PRODUCT");
    expect(result.lineItems[0].itemName).toBe("MRF Zapper");
    expect(result.lineItems[1].lineType).toBe("INSTALLATION");
    expect(result.lineItems[1].installedBy).toBe("Ravi");
  });

  // Reports' Sales-by-item-type breakdown and Customer Follow-Up's "what
  // they last bought" both read this off SaleLineItemRow (doc/reports-scope
  // .md §3/§5) — added alongside the Reports module, doc/reports-scope.md.
  it("maps itemType from the joined inventory_items row on a PRODUCT line", async () => {
    const builder = createQueryBuilderMock({ data: saleRow, error: null });
    const supabase = createSupabaseMock(builder);

    const result = await getSale(supabase, "dddddddd-dddd-4ddd-8ddd-dddddddddd01");

    expect(result.lineItems[0].itemType).toBe("BRAND_NEW_TYRE");
  });

  it("leaves itemType null on an INSTALLATION line (nothing to join against)", async () => {
    const builder = createQueryBuilderMock({ data: saleRow, error: null });
    const supabase = createSupabaseMock(builder);

    const result = await getSale(supabase, "dddddddd-dddd-4ddd-8ddd-dddddddddd01");

    expect(result.lineItems[1].itemType).toBeNull();
  });

  it("leaves itemType null when the joined inventory item is missing (deleted item)", async () => {
    const deletedItemRow = {
      ...saleRow,
      sale_items: [{ ...saleRow.sale_items[1], inventory_items: null }],
    };
    const builder = createQueryBuilderMock({ data: deletedItemRow, error: null });
    const supabase = createSupabaseMock(builder);

    const result = await getSale(supabase, "dddddddd-dddd-4ddd-8ddd-dddddddddd01");

    expect(result.lineItems[0].itemType).toBeNull();
    expect(result.lineItems[0].itemName).toBe("Deleted item");
  });

  // Sales list needs to show "N returned" without a follow-up query per row.
  it("sums sale_returns.quantity into each line's returnedQuantity", async () => {
    const builder = createQueryBuilderMock({ data: saleRow, error: null });
    const supabase = createSupabaseMock(builder);

    const result = await getSale(supabase, "dddddddd-dddd-4ddd-8ddd-dddddddddd01");

    expect(result.lineItems[0].returnedQuantity).toBe(1); // PRODUCT line, one return of qty 1
    expect(result.lineItems[1].returnedQuantity).toBe(0); // INSTALLATION line, no returns
  });

  it("throws SaleNotFoundError when no row matches", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    await expect(getSale(supabase, "missing")).rejects.toBeInstanceOf(SaleNotFoundError);
  });

  // BILL-001/008: invoice's bill-to block needs the customer's address, so
  // getSale() carries it through from the joined customers row.
  it("returns customerAddress when the customer record has one", async () => {
    const builder = createQueryBuilderMock({ data: saleRow, error: null });
    const supabase = createSupabaseMock(builder);

    const result = await getSale(supabase, "dddddddd-dddd-4ddd-8ddd-dddddddddd01");

    expect(result.customerAddress).toBe("12 Race Course Road, Coimbatore");
  });

  it("returns customerAddress as null when the customer has no address on file", async () => {
    const noAddressRow = { ...saleRow, customers: { name: "Arun Kumar", mobile_number: "9876543210", address: null } };
    const builder = createQueryBuilderMock({ data: noAddressRow, error: null });
    const supabase = createSupabaseMock(builder);

    const result = await getSale(supabase, "dddddddd-dddd-4ddd-8ddd-dddddddddd01");

    expect(result.customerAddress).toBeNull();
  });
});

describe("recordSale", () => {
  it("calls record_sale_with_payment with find-or-create customer info and both line kinds mapped to snake_case", async () => {
    const builder = createQueryBuilderMock({ data: saleRow, error: null });
    const supabase = createSupabaseMock(builder, { data: "dddddddd-dddd-4ddd-8ddd-dddddddddd01", error: null });

    await recordSale(supabase, baseSaleInput);

    expect(supabase.rpc).toHaveBeenCalledWith("record_sale_with_payment", {
      p_customer_name: "Arun Kumar",
      p_customer_mobile: "9876543210",
      p_customer_address: null,
      p_gst_applicable: false,
      p_gst_amount: 0,
      p_discount_applicable: false,
      p_discount_amount: 0,
      p_lines: [
        { line_type: "PRODUCT", inventory_item_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01", quantity: 2 },
        {
          line_type: "INSTALLATION",
          installation_subtype: "TYRE_FITTING",
          wheel_count: 2,
          description: null,
          amount: null,
          installed_by: "Ravi",
        },
      ],
      p_payment_mode: "CASH",
      p_cash_amount: 3600,
      p_upi_amount: 0,
      p_sold_by_id: null,
    });
  });

  it("PAY-071: never sends p_payment_status — the server derives it from the amounts", async () => {
    const builder = createQueryBuilderMock({ data: saleRow, error: null });
    const supabase = createSupabaseMock(builder, { data: "dddddddd-dddd-4ddd-8ddd-dddddddddd01", error: null });

    await recordSale(supabase, baseSaleInput);

    const args = (supabase.rpc as unknown as { mock: { calls: [string, Record<string, unknown>][] } }).mock.calls[0][1];
    expect(args).not.toHaveProperty("p_payment_status");
  });

  it("PAY-070: forwards a split payment's two amounts untouched", async () => {
    const builder = createQueryBuilderMock({ data: saleRow, error: null });
    const supabase = createSupabaseMock(builder, { data: "dddddddd-dddd-4ddd-8ddd-dddddddddd01", error: null });

    await recordSale(supabase, { ...baseSaleInput, payment: { mode: "SPLIT", cashAmount: 1000, upiAmount: 2600 } });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "record_sale_with_payment",
      expect.objectContaining({ p_payment_mode: "SPLIT", p_cash_amount: 1000, p_upi_amount: 2600 })
    );
  });

  // SALE-024/025/026/027: stock deduction/FIFO/atomicity all live inside
  // record_sale()'s DB transaction (0013_sales_schema.sql) — this test
  // confirms the service layer surfaces that failure correctly rather than
  // re-implementing or masking it.
  it("throws InsufficientStockError on DB error code P0001 (SALE-027)", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "P0001", message: "x" } });

    await expect(recordSale(supabase, baseSaleInput)).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it("throws StockAdjustmentAuthError on DB error code 42501", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "42501", message: "x" } });

    await expect(recordSale(supabase, baseSaleInput)).rejects.toBeInstanceOf(StockAdjustmentAuthError);
  });

  it("throws SaleItemUnavailableError on DB error code P0002 (SALE-010)", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "P0002", message: "x" } });

    await expect(recordSale(supabase, baseSaleInput)).rejects.toBeInstanceOf(SaleItemUnavailableError);
  });

  it("throws SaleValidationError on DB error code 22023 (e.g. SALE-011's server-side check)", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, {
      data: null,
      error: { code: "22023", message: "A sale requires at least one product line" },
    });

    await expect(recordSale(supabase, baseSaleInput)).rejects.toBeInstanceOf(SaleValidationError);
  });

  it("rejects client-side (Zod) before ever calling Supabase when there's no product line", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder);

    const installOnly: SaleInput = {
      ...baseSaleInput,
      lines: [{ lineType: "INSTALLATION", installationSubtype: "TYRE_FITTING", wheelCount: 2 }],
    };

    await expect(recordSale(supabase, installOnly)).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("getSalesStats", () => {
  // SALE-019/020: subtotal/grand total aggregation is server-computed per
  // sale by record_sale() — stats here just sums grand_total across sales
  // in range, feeding the Dashboard's future Profit calc.
  it("sums grand_total across the queried range", async () => {
    const builder = createQueryBuilderMock({
      data: [{ grand_total: 3600 }, { grand_total: 1200 }],
      error: null,
    });
    const supabase = createSupabaseMock(builder);

    const result = await getSalesStats(supabase, { from: new Date("2026-07-01"), to: new Date("2026-07-31") });

    expect(result.totalSalesAmount).toBe(4800);
    expect(result.saleCount).toBe(2);
  });
});

describe("listSales", () => {
  it("returns mapped, paginated sales with a total count", async () => {
    const builder = createQueryBuilderMock({ data: [saleRow], error: null, count: 1 });
    const supabase = createSupabaseMock(builder);

    const result = await listSales(supabase, { page: 1, pageSize: 20 });

    expect(result.total).toBe(1);
    expect(result.sales[0].invoiceNumber).toBe("TW-S-000001");
  });

  // Sold-by filter (doc/sales-edit-void-scope.md §2) — a specific person's id
  // narrows to their sales; the UNASSIGNED sentinel narrows to sales with no
  // sold_by_id at all, which .eq() could never express.
  it("filters to a specific salesperson's sales", async () => {
    const builder = createQueryBuilderMock({ data: [saleRow], error: null, count: 1 });
    const supabase = createSupabaseMock(builder);

    await listSales(supabase, { page: 1, pageSize: 20, soldById: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01" });

    expect(builder.eq).toHaveBeenCalledWith("sold_by_id", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01");
    expect(builder.is).not.toHaveBeenCalledWith("sold_by_id", null);
  });

  it("filters to unassigned sales via the UNASSIGNED sentinel", async () => {
    const builder = createQueryBuilderMock({ data: [saleRow], error: null, count: 1 });
    const supabase = createSupabaseMock(builder);

    await listSales(supabase, { page: 1, pageSize: 20, soldById: "UNASSIGNED" });

    expect(builder.is).toHaveBeenCalledWith("sold_by_id", null);
    expect(builder.eq).not.toHaveBeenCalledWith("sold_by_id", expect.anything());
  });

  it("applies no sold-by filter when soldById is omitted", async () => {
    const builder = createQueryBuilderMock({ data: [saleRow], error: null, count: 1 });
    const supabase = createSupabaseMock(builder);

    await listSales(supabase, { page: 1, pageSize: 20 });

    expect(builder.is).not.toHaveBeenCalled();
  });
});

describe("listSalesForCustomer", () => {
  // SALE-004: a customer's sale history is retrievable by customer id.
  it("returns that customer's sales, newest first", async () => {
    const builder = createQueryBuilderMock({ data: [saleRow], error: null });
    const supabase = createSupabaseMock(builder);

    const result = await listSalesForCustomer(supabase, "88888888-8888-4888-8888-888888888801");

    expect(builder.eq).toHaveBeenCalledWith("customer_id", "88888888-8888-4888-8888-888888888801");
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(result).toHaveLength(1);
  });
});

describe("updateSalePayment", () => {
  const SALE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddd01";

  it("PAY-073: calls update_sales_payment_status with the id and all three tender fields", async () => {
    const builder = createQueryBuilderMock({ data: saleRow, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: null });

    await updateSalePayment(supabase, {
      saleId: SALE_ID,
      payment: { mode: "SPLIT", cashAmount: 500, upiAmount: 1000 },
    });

    expect(supabase.rpc).toHaveBeenCalledWith("update_sales_payment_status", {
      p_sale_id: SALE_ID,
      p_payment_mode: "SPLIT",
      p_cash_amount: 500,
      p_upi_amount: 1000,
    });
  });

  it("PAY-074: surfaces an over-payment rejection (22023) as a validation error", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "22023", message: "Cash + UPI is more than the bill total" } });

    await expect(
      updateSalePayment(supabase, { saleId: SALE_ID, payment: { mode: "CASH", cashAmount: 99999, upiAmount: 0 } })
    ).rejects.toBeInstanceOf(SaleValidationError);
  });

  it("PAY-075: surfaces a permission failure (42501)", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "42501", message: "nope" } });

    await expect(
      updateSalePayment(supabase, { saleId: SALE_ID, payment: { mode: "CASH", cashAmount: 10, upiAmount: 0 } })
    ).rejects.toBeInstanceOf(StockAdjustmentAuthError);
  });

  it("PAY-076: surfaces a missing sale (P0002)", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    const supabase = createSupabaseMock(builder, { data: null, error: { code: "P0002", message: "gone" } });

    await expect(
      updateSalePayment(supabase, { saleId: SALE_ID, payment: { mode: "CASH", cashAmount: 10, upiAmount: 0 } })
    ).rejects.toBeInstanceOf(SaleNotFoundError);
  });
});

describe("mapSale — payment columns", () => {
  it("PAY-072: maps tender columns, defaulting a historic row to no mode and zero amounts", async () => {
    const historic = { ...saleRow, payment_mode: null, cash_amount: null, upi_amount: null };
    const builder = createQueryBuilderMock({ data: historic, error: null });
    const supabase = createSupabaseMock(builder);

    const result = await getSale(supabase, "dddddddd-dddd-4ddd-8ddd-dddddddddd01");

    expect(result).toMatchObject({ paymentMode: null, cashAmount: 0, upiAmount: 0, paymentStatus: "PAID" });
  });

  it("PAY-072b: maps a recorded split", async () => {
    const split = { ...saleRow, payment_mode: "SPLIT", cash_amount: 1000, upi_amount: 2600 };
    const builder = createQueryBuilderMock({ data: split, error: null });
    const supabase = createSupabaseMock(builder);

    const result = await getSale(supabase, "dddddddd-dddd-4ddd-8ddd-dddddddddd01");

    expect(result).toMatchObject({ paymentMode: "SPLIT", cashAmount: 1000, upiAmount: 2600 });
  });
});
