import { describe, expect, it } from "vitest";

import { formatDate, formatINR } from "@/lib/format";
import type { SaleLineItemRow, SaleRow } from "@/services/sales/sales";
import type { ServiceJobRow } from "@/services/service/jobs";

import { buildSalesInvoiceView, buildServiceInvoiceView, ServiceInvoiceNotAvailableError, type BusinessInfo } from "./invoice";

const BUSINESS: BusinessInfo = {
  name: "Twinspark Tyres And Bike Garage",
  addressLines: ["2a, FCI Rd, Ex.Servicemen Colony, VG Rao Nagar, Ganapathy", "Coimbatore, Tamil Nadu 641006"],
};

function productLine(overrides: Partial<SaleLineItemRow> = {}): SaleLineItemRow {
  return {
    id: "line-product",
    position: 1,
    lineType: "PRODUCT",
    inventoryItemId: "item-1",
    itemName: "MRF Zapper",
    itemSkuCode: "TYRE-001",
    itemType: "BRAND_NEW_TYRE",
    quantity: 2,
    unitSellingPrice: 1500,
    installationSubtype: null,
    wheelCount: null,
    description: null,
    amount: null,
    installedBy: null,
    comboId: null,
    comboContents: [],
    comboListValue: null,
    includedInCombo: false,
    lineTotal: 3000,
    listPrice: null,
  discountGiven: 0,
  returnedQuantity: 0,
    ...overrides,
  };
}

function tyreFittingLine(overrides: Partial<SaleLineItemRow> = {}): SaleLineItemRow {
  return {
    id: "line-fitting",
    position: 2,
    lineType: "INSTALLATION",
    inventoryItemId: null,
    itemName: null,
    itemSkuCode: null,
    itemType: null,
    quantity: null,
    unitSellingPrice: null,
    installationSubtype: "TYRE_FITTING",
    wheelCount: 2,
    description: null,
    amount: 600,
    installedBy: "Ravi",
    comboId: null,
    comboContents: [],
    comboListValue: null,
    includedInCombo: false,
    lineTotal: 600,
    listPrice: null,
  discountGiven: 0,
  returnedQuantity: 0,
    ...overrides,
  };
}

function customLine(overrides: Partial<SaleLineItemRow> = {}): SaleLineItemRow {
  return {
    id: "line-custom",
    position: 3,
    lineType: "INSTALLATION",
    inventoryItemId: null,
    itemName: null,
    itemSkuCode: null,
    itemType: null,
    quantity: null,
    unitSellingPrice: null,
    installationSubtype: "CUSTOM",
    wheelCount: null,
    description: "Chain Sprocket Kit Installation",
    amount: 250,
    installedBy: null,
    comboId: null,
    comboContents: [],
    comboListValue: null,
    includedInCombo: false,
    lineTotal: 250,
    listPrice: null,
  discountGiven: 0,
  returnedQuantity: 0,
    ...overrides,
  };
}

function baseSale(overrides: Partial<SaleRow> = {}): SaleRow {
  return {
    id: "sale-1",
    customerId: "cust-1",
    customerName: "Arun Kumar",
    customerMobile: "9876543210",
    customerAddress: "12 Race Course Road, Coimbatore",
    saleDate: "2026-07-13T10:00:00.000Z",
    gstApplicable: false,
    gstAmount: 0,
    discountApplicable: false,
    discountAmount: 0,
    subtotal: 3000,
    installationTotal: 600,
    grandTotal: 3600,
    invoiceNumber: "TW-S-000001",
    paymentStatus: "PAID" as const,
    paymentMode: "SPLIT" as const,
    cashAmount: 1000,
    upiAmount: 2600,
    needsServiceFollowup: false,
    serviceFollowupNote: null,
    soldById: null,
    soldByName: null,
    voidedAt: null,
    voidReason: null,
    createdAt: "2026-07-13T10:00:00.000Z",
    lineItems: [productLine(), tyreFittingLine()],
    ...overrides,
  };
}

describe("buildSalesInvoiceView — header & customer", () => {
  it("BILL-001: carries invoiceNumber and a formatted invoiceDateLabel straight from the sale", () => {
    const view = buildSalesInvoiceView(baseSale(), BUSINESS);
    expect(view.invoiceNumber).toBe("TW-S-000001");
    expect(view.invoiceDateLabel).toBe(formatDate("2026-07-13T10:00:00.000Z"));
  });

  it("BILL-002: includes business.name and business.addressLines as given", () => {
    const view = buildSalesInvoiceView(baseSale(), BUSINESS);
    expect(view.business.name).toBe(BUSINESS.name);
    expect(view.business.addressLines).toEqual(BUSINESS.addressLines);
  });

  it("BILL-003: includes a phone row only when business.phone is provided", () => {
    const view = buildSalesInvoiceView(baseSale(), { ...BUSINESS, phone: "0422-1234567" });
    expect(view.business.phone).toBe("0422-1234567");
  });

  it("BILL-004: omits the phone row when business.phone is undefined/blank", () => {
    const view = buildSalesInvoiceView(baseSale(), BUSINESS);
    expect(view.business.phone).toBeUndefined();
  });

  it("BILL-005: includes a GSTIN row only when business.gstin is provided", () => {
    const view = buildSalesInvoiceView(baseSale(), { ...BUSINESS, gstin: "33AAAAA0000A1Z5" });
    expect(view.business.gstin).toBe("33AAAAA0000A1Z5");
  });

  it("BILL-006: omits the GSTIN row when business.gstin is undefined/blank", () => {
    const view = buildSalesInvoiceView(baseSale(), BUSINESS);
    expect(view.business.gstin).toBeUndefined();
  });

  it("BILL-007: maps customer name/mobile/addressLines from the sale's customer record", () => {
    const view = buildSalesInvoiceView(baseSale(), BUSINESS);
    expect(view.customer.name).toBe("Arun Kumar");
    expect(view.customer.mobile).toBe("9876543210");
    expect(view.customer.addressLines).toEqual(["12 Race Course Road, Coimbatore"]);
  });

  it("BILL-008: customer addressLines is empty when the customer has no address on file", () => {
    const view = buildSalesInvoiceView(baseSale({ customerAddress: null }), BUSINESS);
    expect(view.customer.addressLines).toEqual([]);
  });
});

describe("buildSalesInvoiceView — line items (single combined table, position order)", () => {
  it("BILL-010: maps a PRODUCT line", () => {
    const view = buildSalesInvoiceView(baseSale({ lineItems: [productLine()] }), BUSINESS);
    const [line] = view.lines;
    expect(line.description).toBe("MRF Zapper");
    expect(line.detail).toBe("TYRE-001");
    expect(line.quantityLabel).toBe("2");
    expect(line.unitPriceLabel).toBe(formatINR(1500));
    expect(line.amountLabel).toBe(formatINR(3000));
  });

  it("BILL-011: maps a TYRE_FITTING line", () => {
    const view = buildSalesInvoiceView(baseSale({ lineItems: [tyreFittingLine({ installedBy: null })] }), BUSINESS);
    const [line] = view.lines;
    expect(line.description).toBe("Tyre Fitting");
    expect(line.quantityLabel).toBe("2 wheels");
    expect(line.unitPriceLabel).toBe(`${formatINR(300)}/wheel`);
    expect(line.amountLabel).toBe(formatINR(600));
  });

  it("BILL-011b: singular 'wheel' label for a single-wheel Tyre Fitting line", () => {
    const view = buildSalesInvoiceView(
      baseSale({ lineItems: [tyreFittingLine({ wheelCount: 1, lineTotal: 300, installedBy: null })] }),
      BUSINESS
    );
    expect(view.lines[0].quantityLabel).toBe("1 wheel");
  });

  it("BILL-012: maps a CUSTOM installation line", () => {
    const view = buildSalesInvoiceView(baseSale({ lineItems: [customLine()] }), BUSINESS);
    const [line] = view.lines;
    expect(line.description).toBe("Chain Sprocket Kit Installation");
    expect(line.quantityLabel).toBe("—");
    expect(line.unitPriceLabel).toBe("—");
    expect(line.amountLabel).toBe(formatINR(250));
  });

  it("BILL-013: includes 'Installed by <name>' as detail when installedBy is set", () => {
    const view = buildSalesInvoiceView(baseSale({ lineItems: [tyreFittingLine({ installedBy: "Ravi" })] }), BUSINESS);
    expect(view.lines[0].detail).toBe("Installed by Ravi");
  });

  it("BILL-014: omits the installed-by detail when installedBy is blank/null", () => {
    const view = buildSalesInvoiceView(baseSale({ lineItems: [tyreFittingLine({ installedBy: null })] }), BUSINESS);
    expect(view.lines[0].detail).toBeUndefined();
  });

  it("BILL-015: preserves the sale's stored line order rather than grouping products before installation lines", () => {
    const view = buildSalesInvoiceView(
      baseSale({
        lineItems: [
          tyreFittingLine({ id: "a", position: 1 }),
          productLine({ id: "b", position: 2 }),
          customLine({ id: "c", position: 3 }),
        ],
      }),
      BUSINESS
    );
    expect(view.lines.map((l) => l.description)).toEqual(["Tyre Fitting", "MRF Zapper", "Chain Sprocket Kit Installation"]);
  });

  it("BILL-016: assigns contiguous slNo 1..N regardless of the underlying position values", () => {
    const view = buildSalesInvoiceView(
      baseSale({
        lineItems: [productLine({ position: 5 }), tyreFittingLine({ position: 12 })],
      }),
      BUSINESS
    );
    expect(view.lines.map((l) => l.slNo)).toEqual([1, 2]);
  });

  it("BILL-017: a Deleted item still renders using the existing fallback name, not a crash", () => {
    const view = buildSalesInvoiceView(
      baseSale({ lineItems: [productLine({ itemName: "Deleted item", itemSkuCode: null })] }),
      BUSINESS
    );
    expect(view.lines[0].description).toBe("Deleted item");
  });
});

describe("buildSalesInvoiceView — totals block", () => {
  it("BILL-020: subtotalLabel reflects sale.subtotal (products only)", () => {
    const view = buildSalesInvoiceView(baseSale({ subtotal: 4200, installationTotal: 600 }), BUSINESS);
    expect(view.totals.subtotalLabel).toBe(formatINR(4200));
  });

  it("BILL-021: installationTotalLabel is present when installationTotal > 0", () => {
    const view = buildSalesInvoiceView(baseSale({ installationTotal: 600 }), BUSINESS);
    expect(view.totals.installationTotalLabel).toBe(formatINR(600));
  });

  it("BILL-022: installationTotalLabel is null when installationTotal === 0", () => {
    const view = buildSalesInvoiceView(baseSale({ installationTotal: 0, lineItems: [productLine()] }), BUSINESS);
    expect(view.totals.installationTotalLabel).toBeNull();
  });

  it("BILL-023: gst is present with ratePercentLabel + amountLabel when applicable and > 0", () => {
    const view = buildSalesInvoiceView(
      baseSale({ subtotal: 4200, installationTotal: 600, gstApplicable: true, gstAmount: 864, grandTotal: 5664 }),
      BUSINESS
    );
    expect(view.totals.gst).not.toBeNull();
    expect(view.totals.gst?.amountLabel).toBe(formatINR(864));
  });

  it("BILL-024: gst is null when gstApplicable is false", () => {
    const view = buildSalesInvoiceView(baseSale({ gstApplicable: false, gstAmount: 864 }), BUSINESS);
    expect(view.totals.gst).toBeNull();
  });

  it("BILL-025: gst is null when gstApplicable is true but gstAmount is 0", () => {
    const view = buildSalesInvoiceView(baseSale({ gstApplicable: true, gstAmount: 0 }), BUSINESS);
    expect(view.totals.gst).toBeNull();
  });

  it("BILL-026: ratePercentLabel is back-calculated from gstAmount / (subtotal + installationTotal)", () => {
    // subtotal 4200 + installation 600 = 4800 taxable; 864 / 4800 = 18%.
    const view = buildSalesInvoiceView(
      baseSale({ subtotal: 4200, installationTotal: 600, gstApplicable: true, gstAmount: 864, grandTotal: 5664 }),
      BUSINESS
    );
    expect(view.totals.gst?.ratePercentLabel).toBe("18%");
  });

  it("BILL-027: ratePercentLabel falls back to '—' when taxable total is 0", () => {
    const view = buildSalesInvoiceView(
      baseSale({
        subtotal: 0,
        installationTotal: 0,
        gstApplicable: true,
        gstAmount: 50,
        lineItems: [productLine({ unitSellingPrice: 0, lineTotal: 0 })],
      }),
      BUSINESS
    );
    expect(view.totals.gst?.ratePercentLabel).toBe("—");
  });

  it("BILL-028: discount is present with amountLabel when applicable and > 0", () => {
    const view = buildSalesInvoiceView(baseSale({ discountApplicable: true, discountAmount: 100 }), BUSINESS);
    expect(view.totals.discount).toEqual({ amountLabel: formatINR(100) });
  });

  it("BILL-029: discount is null when not applicable, and null when amount is 0", () => {
    const notApplicable = buildSalesInvoiceView(baseSale({ discountApplicable: false, discountAmount: 100 }), BUSINESS);
    const zeroAmount = buildSalesInvoiceView(baseSale({ discountApplicable: true, discountAmount: 0 }), BUSINESS);
    expect(notApplicable.totals.discount).toBeNull();
    expect(zeroAmount.totals.discount).toBeNull();
  });

  it("BILL-030: grandTotalLabel is formatINR(sale.grandTotal) directly, never recomputed", () => {
    // Deliberately inconsistent inputs — grandTotal here does NOT equal
    // subtotal + installation + gst - discount, to prove the view builder
    // doesn't recompute it and just trusts the stored figure.
    const view = buildSalesInvoiceView(
      baseSale({ subtotal: 1000, installationTotal: 0, gstAmount: 0, discountAmount: 0, grandTotal: 9999 }),
      BUSINESS
    );
    expect(view.totals.grandTotalLabel).toBe(formatINR(9999));
  });
});

function baseServiceJob(overrides: Partial<ServiceJobRow> = {}): ServiceJobRow {
  return {
    id: "job-1",
    jobNumber: "SJ-000001",
    invoiceNumber: "TW-J-000001",
    customerId: "cust-1",
    customerName: "Arun Kumar",
    customerMobile: "9876543210",
    customerAddress: "12 Race Course Road, Coimbatore",
    vehicleId: "veh-1",
    vehicleNumber: "TN37AB1234",
    vehicleModel: "KTM Duke 390",
    odometerReading: 12000,
    status: "COMPLETED",
    complaintNotes: "Engine Noise",
    mechanicNotes: "Fork seal leaking — replace next visit",
    expectedDeliveryAt: null,
    completedAt: "2026-07-16T12:00:00.000Z",
    deliveredAt: null,
    paymentStatus: "PENDING",
    paymentMode: null,
    cashAmount: 0,
    upiAmount: 0,
    deliveryStatus: "WAITING",
    gstApplicable: false,
    gstAmount: 0,
    discountApplicable: false,
    discountAmount: 0,
    subtotal: 800,
    inventoryTotal: 350,
    grandTotal: 1150,
    createdAt: "2026-07-16T10:00:00.000Z",
    lines: [
      { id: "l1", position: 1, lineType: "PACKAGE", generalServicePackageId: "pkg-1", specificServiceId: null, comboId: null, comboContents: [], comboListValue: null, description: "Standard Service", quantity: 1, rate: 650, amount: 650 },
      { id: "l2", position: 2, lineType: "SPECIFIC", generalServicePackageId: null, specificServiceId: "spec-1", comboId: null, comboContents: [], comboListValue: null, description: "Chain Cleaning", quantity: 1, rate: 150, amount: 150 },
    ],
    usage: [{ id: "u1", inventoryItemId: "item-1", itemName: "Engine Oil 20W40", quantityUsed: 1, unitPrice: 350, lineTotal: 350, comboId: null, includedInCombo: false }],
    events: [],
    images: [],
    assignedMechanicId: null,
    assignedMechanicName: null,
    ...overrides,
  };
}

describe("buildServiceInvoiceView", () => {
  it("throws ServiceInvoiceNotAvailableError for a job that isn't COMPLETED (doc §18)", () => {
    expect(() => buildServiceInvoiceView(baseServiceJob({ status: "IN_PROGRESS", invoiceNumber: null, completedAt: null }), BUSINESS)).toThrow(
      ServiceInvoiceNotAvailableError
    );
  });

  it("uses TW-J- numbering, distinct from a Sales invoice's TW-S- prefix", () => {
    const view = buildServiceInvoiceView(baseServiceJob(), BUSINESS);
    expect(view.invoiceNumber).toBe("TW-J-000001");
  });

  it("renders serviceLines (Package/Specific/Custom together) and inventoryLines as two separate, never-blended sections", () => {
    const view = buildServiceInvoiceView(baseServiceJob(), BUSINESS);
    expect(view.serviceLines).toHaveLength(2);
    expect(view.inventoryLines).toHaveLength(1);
    expect(view.inventoryLines[0].description).toBe("Engine Oil 20W40");
  });

  it("never includes mechanicNotes or complaintNotes — invoice stays purely financial", () => {
    const view = buildServiceInvoiceView(baseServiceJob(), BUSINESS);
    expect(view).not.toHaveProperty("mechanicNotes");
    expect(view).not.toHaveProperty("complaintNotes");
    expect(JSON.stringify(view)).not.toContain("Fork seal");
  });

  it("includes vehicle details (number, model, odometer)", () => {
    const view = buildServiceInvoiceView(baseServiceJob(), BUSINESS);
    expect(view.vehicle.number).toBe("TN37AB1234");
    expect(view.vehicle.model).toBe("KTM Duke 390");
    expect(view.vehicle.odometerLabel).toBe("12,000 km");
  });

  it("inventoryTotalLabel is null when no parts were used", () => {
    const view = buildServiceInvoiceView(baseServiceJob({ usage: [], inventoryTotal: 0 }), BUSINESS);
    expect(view.inventoryLines).toHaveLength(0);
    expect(view.totals.inventoryTotalLabel).toBeNull();
  });

  it("grandTotalLabel is formatINR(job.grandTotal) directly, never recomputed", () => {
    const view = buildServiceInvoiceView(baseServiceJob({ subtotal: 100, inventoryTotal: 0, gstAmount: 0, discountAmount: 0, grandTotal: 9999 }), BUSINESS);
    expect(view.totals.grandTotalLabel).toBe(formatINR(9999));
  });

  it("gst is null when not applicable or zero", () => {
    const view = buildServiceInvoiceView(baseServiceJob({ gstApplicable: false, gstAmount: 100 }), BUSINESS);
    expect(view.totals.gst).toBeNull();
  });
});

describe("buildSalesInvoiceView — combos and payment", () => {
  function comboLine(overrides: Partial<SaleLineItemRow> = {}): SaleLineItemRow {
    return {
      id: "line-combo",
      position: 1,
      lineType: "COMBO",
      inventoryItemId: null,
      itemName: null,
      itemSkuCode: null,
      itemType: null,
      quantity: 1,
      unitSellingPrice: null,
      installationSubtype: null,
      wheelCount: null,
      description: "Weekend Combo",
      amount: 5999,
      installedBy: null,
      comboId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      comboContents: ["Front Tyre", "Water Wash"],
      comboListValue: 7000,
      includedInCombo: false,
      lineTotal: 5999,
      listPrice: null,
  discountGiven: 0,
  returnedQuantity: 0,
      ...overrides,
    };
  }

  it("prints a combo as one line with its contents beneath", () => {
    const view = buildSalesInvoiceView(baseSale({ lineItems: [comboLine()] }), BUSINESS);

    expect(view.lines[0]).toMatchObject({ description: "Weekend Combo", comboContents: ["Front Tyre", "Water Wash"] });
  });

  it("shows what the customer saved against the snapshotted list value", () => {
    const view = buildSalesInvoiceView(baseSale({ lineItems: [comboLine()] }), BUSINESS);

    expect(view.totals.comboSavingsLabel).toContain("1,001");
  });

  it("hides the savings line when the combo saved nothing", () => {
    const view = buildSalesInvoiceView(baseSale({ lineItems: [comboLine({ comboListValue: 5999 })] }), BUSINESS);

    expect(view.totals.comboSavingsLabel).toBeNull();
  });

  it("never shows a negative saving", () => {
    const view = buildSalesInvoiceView(baseSale({ lineItems: [comboLine({ comboListValue: 4000 })] }), BUSINESS);

    expect(view.totals.comboSavingsLabel).toBeNull();
  });

  it("prints an included product as 'Included' rather than ₹0.00", () => {
    const included = productLine({ includedInCombo: true, unitSellingPrice: 0, lineTotal: 0 });
    const view = buildSalesInvoiceView(baseSale({ lineItems: [included] }), BUSINESS);

    expect(view.lines[0]).toMatchObject({ unitPriceLabel: "Included", amountLabel: "—" });
  });

  it("stays silent about payment on a settled sale", () => {
    expect(buildSalesInvoiceView(baseSale({ paymentStatus: "PAID" }), BUSINESS).totals.paymentPendingLabel).toBeNull();
  });

  it("stamps an unpaid invoice, so it can't be mistaken for a settled one", () => {
    expect(buildSalesInvoiceView(baseSale({ paymentStatus: "PENDING" }), BUSINESS).totals.paymentPendingLabel).toBe("Payment pending");
  });

  it("distinguishes a part payment", () => {
    expect(buildSalesInvoiceView(baseSale({ paymentStatus: "PARTIAL" }), BUSINESS).totals.paymentPendingLabel).toBe("Part payment received");
  });
});

describe("invoice — payment tender (0027)", () => {
  it("PAY-080: a split sale prints both tenders", () => {
    const view = buildSalesInvoiceView(baseSale(), BUSINESS);
    expect(view.totals.paidByLabel).toBe("Cash ₹1,000.00 · UPI ₹2,600.00");
  });

  it("PAY-081: a cash sale prints one tender", () => {
    const view = buildSalesInvoiceView(baseSale({ paymentMode: "CASH", cashAmount: 3600, upiAmount: 0 }), BUSINESS);
    expect(view.totals.paidByLabel).toBe("Cash ₹3,600.00");
  });

  it("PAY-082: a sale recorded before tender was tracked prints no Paid by line at all", () => {
    const view = buildSalesInvoiceView(baseSale({ paymentMode: null, cashAmount: 0, upiAmount: 0 }), BUSINESS);
    expect(view.totals.paidByLabel).toBeNull();
    expect(view.totals.balanceDueLabel).toBeNull();
  });

  it("PAY-083: a part payment prints the balance still owing", () => {
    const view = buildSalesInvoiceView(
      baseSale({ paymentStatus: "PARTIAL", paymentMode: "SPLIT", cashAmount: 500, upiAmount: 1000 }),
      BUSINESS
    );
    expect(view.totals.balanceDueLabel).toBe("₹2,100.00");
  });

  it("PAY-084: a settled bill prints no balance due", () => {
    expect(buildSalesInvoiceView(baseSale(), BUSINESS).totals.balanceDueLabel).toBeNull();
  });

  it("PAY-086: the Service invoice carries the same two labels", () => {
    const view = buildServiceInvoiceView(
      baseServiceJob({ paymentStatus: "PAID", paymentMode: "UPI", cashAmount: 0, upiAmount: 1150 }),
      BUSINESS
    );
    expect(view.totals.paidByLabel).toBe("UPI ₹1,150.00");
    expect(view.totals.balanceDueLabel).toBeNull();
  });

  it("PAY-087: a free service prints neither a tender nor a balance due", () => {
    const view = buildServiceInvoiceView(
      baseServiceJob({ paymentStatus: "FREE_SERVICE", paymentMode: null, cashAmount: 0, upiAmount: 0 }),
      BUSINESS
    );
    expect(view.totals.paidByLabel).toBeNull();
    expect(view.totals.balanceDueLabel).toBeNull();
  });

  it("PAY-087b: an unpaid completed job shows the full amount as owing", () => {
    const view = buildServiceInvoiceView(baseServiceJob({ paymentStatus: "PENDING" }), BUSINESS);
    expect(view.totals.balanceDueLabel).toBe("₹1,150.00");
  });
});
