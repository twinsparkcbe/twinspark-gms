import { describe, expect, it } from "vitest";

import {
  ALL_MODULE_KEYS,
  canAccessModule,
  canManageServiceCatalog,
  canSetServicePaymentStatus,
  type ModuleKey,
  type UserRole,
} from "./permissions";

const ROLES: UserRole[] = ["admin", "sales_person", "mechanic"];

describe("canAccessModule — inventory", () => {
  // INV-056: Sales Person cannot access Inventory.
  it("blocks Sales Person from Inventory", () => {
    expect(canAccessModule("sales_person", "inventory")).toBe(false);
  });

  // INV-058: Admin has full access.
  it("allows Admin full access to Inventory", () => {
    expect(canAccessModule("admin", "inventory")).toBe(true);
  });
});

describe("canAccessModule — Mechanic", () => {
  it.each<ModuleKey>(["sales", "service", "billing", "customers", "online-orders"])("allows Mechanic into %s", (moduleKey) => {
    expect(canAccessModule("mechanic", moduleKey)).toBe(true);
  });

  it.each<ModuleKey>(["dashboard", "inventory", "purchases", "reports", "settings"])(
    "blocks Mechanic from %s",
    (moduleKey) => {
      expect(canAccessModule("mechanic", moduleKey)).toBe(false);
    }
  );

  // Granting Service to Mechanic must not leak it to Sales Person.
  it("still blocks Sales Person from Service", () => {
    expect(canAccessModule("sales_person", "service")).toBe(false);
  });
});

describe("canAccessModule — coverage", () => {
  it("allows Admin into every module", () => {
    for (const moduleKey of ALL_MODULE_KEYS) {
      expect(canAccessModule("admin", moduleKey)).toBe(true);
    }
  });

  // A new ModuleKey that nobody wired into the role map would silently
  // resolve to "blocked for everyone but Admin" — make that explicit.
  it("has a decision recorded for every role/module pair", () => {
    for (const role of ROLES) {
      for (const moduleKey of ALL_MODULE_KEYS) {
        expect(typeof canAccessModule(role, moduleKey)).toBe("boolean");
      }
    }
    expect(ALL_MODULE_KEYS).toHaveLength(10);
  });
});

describe("finer-grained Service permissions", () => {
  it("lets only Admin manage the Service Catalog", () => {
    expect(canManageServiceCatalog("admin")).toBe(true);
    expect(canManageServiceCatalog("mechanic")).toBe(false);
    expect(canManageServiceCatalog("sales_person")).toBe(false);
  });

  it("lets only Admin set service payment status", () => {
    expect(canSetServicePaymentStatus("admin")).toBe(true);
    expect(canSetServicePaymentStatus("mechanic")).toBe(false);
    expect(canSetServicePaymentStatus("sales_person")).toBe(false);
  });
});
