import { describe, expect, it } from "vitest";

import { getCustomerVehicleVisibility } from "./customer-vehicle-visibility";

describe("getCustomerVehicleVisibility", () => {
  it("gives an admin full visibility", () => {
    expect(getCustomerVehicleVisibility("admin")).toEqual({
      vehiclesTab: true,
      vehiclesSection: true,
      serviceHistory: true,
      salesHistory: true,
    });
  });

  it("hides Vehicles and Service History from a Sales Person, keeping Sales History", () => {
    expect(getCustomerVehicleVisibility("sales_person")).toEqual({
      vehiclesTab: false,
      vehiclesSection: false,
      serviceHistory: false,
      salesHistory: true,
    });
  });

  it("treats an undefined role as the restricted sales_person shape", () => {
    expect(getCustomerVehicleVisibility(undefined)).toEqual({
      vehiclesTab: false,
      vehiclesSection: false,
      serviceHistory: false,
      salesHistory: true,
    });
  });
});

describe("getCustomerVehicleVisibility — Mechanic", () => {
  // Vehicle Management follows Service access, and a Mechanic has it.
  it("shows Vehicles and Service History to a Mechanic", () => {
    expect(getCustomerVehicleVisibility("mechanic")).toEqual({
      vehiclesTab: true,
      vehiclesSection: true,
      serviceHistory: true,
      salesHistory: true,
    });
  });
});
