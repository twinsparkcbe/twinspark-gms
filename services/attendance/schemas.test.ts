import { describe, expect, it } from "vitest";

import {
  attendanceEmployeeInputSchema,
  attendanceEntrySchema,
  attendanceReportFilterSchema,
  roleDisplayLabel,
  saveDailyAttendanceSchema,
} from "./schemas";

const EMPLOYEE_ID = "11111111-1111-4111-8111-111111111111";

function employeeInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Arun",
    role: "SALES_PERSON",
    mobile: "9876543210",
    joiningDate: "2026-01-15",
    isActive: true,
    ...overrides,
  };
}

describe("attendanceEmployeeInputSchema", () => {
  it("accepts a complete employee", () => {
    expect(attendanceEmployeeInputSchema.parse(employeeInput()).name).toBe("Arun");
  });

  it("trims whitespace off the name", () => {
    expect(attendanceEmployeeInputSchema.parse(employeeInput({ name: "  Arun  " })).name).toBe("Arun");
  });

  it("requires a name", () => {
    expect(attendanceEmployeeInputSchema.safeParse(employeeInput({ name: "   " })).success).toBe(false);
  });

  /**
   * Employee IDs are issued by a DB sequence, so there is nothing for a
   * client to submit — and a client that tries must not be able to override
   * the sequence by smuggling one through.
   */
  it("ignores any employee ID a client tries to submit", () => {
    const parsed = attendanceEmployeeInputSchema.parse(employeeInput({ employeeCode: "HACKED" }));
    expect(parsed).not.toHaveProperty("employeeCode");
  });

  /** Mobile is optional — the roster is internal, and a missing number
   * shouldn't block adding a staff member. */
  it("treats an empty mobile as null but rejects a malformed one", () => {
    expect(attendanceEmployeeInputSchema.parse(employeeInput({ mobile: "" })).mobile).toBeNull();
    expect(attendanceEmployeeInputSchema.safeParse(employeeInput({ mobile: "12345" })).success).toBe(false);
    expect(attendanceEmployeeInputSchema.safeParse(employeeInput({ mobile: "1234567890" })).success).toBe(false);
  });

  it("rejects an unknown role and a malformed joining date", () => {
    expect(attendanceEmployeeInputSchema.safeParse(employeeInput({ role: "MANAGER" })).success).toBe(false);
    expect(attendanceEmployeeInputSchema.safeParse(employeeInput({ joiningDate: "15-01-2026" })).success).toBe(false);
  });

  describe("Other Staff must say who they are", () => {
    it("requires a description for OTHER_STAFF", () => {
      const result = attendanceEmployeeInputSchema.safeParse(employeeInput({ role: "OTHER_STAFF" }));
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].path).toEqual(["otherRoleDescription"]);

      expect(
        attendanceEmployeeInputSchema.safeParse(employeeInput({ role: "OTHER_STAFF", otherRoleDescription: "   " })).success
      ).toBe(false);
    });

    it("accepts OTHER_STAFF with a description", () => {
      const parsed = attendanceEmployeeInputSchema.parse(
        employeeInput({ role: "OTHER_STAFF", otherRoleDescription: "  Watchman  " })
      );
      expect(parsed.otherRoleDescription).toBe("Watchman");
    });

    /** Switching a role must never leave a stale job title behind. */
    it("strips the description for the other two roles", () => {
      expect(
        attendanceEmployeeInputSchema.parse(employeeInput({ role: "SALES_PERSON", otherRoleDescription: "Watchman" }))
          .otherRoleDescription
      ).toBeNull();
      expect(
        attendanceEmployeeInputSchema.parse(employeeInput({ role: "SERVICE_PERSON", otherRoleDescription: "Watchman" }))
          .otherRoleDescription
      ).toBeNull();
    });

    it("defaults the description to null when it isn't given", () => {
      expect(attendanceEmployeeInputSchema.parse(employeeInput()).otherRoleDescription).toBeNull();
    });
  });
});

describe("roleDisplayLabel", () => {
  it("shows the real job for Other Staff, not the bucket name", () => {
    expect(roleDisplayLabel("OTHER_STAFF", "Watchman")).toBe("Watchman");
  });

  it("falls back to the bucket name when there's no description", () => {
    expect(roleDisplayLabel("OTHER_STAFF", null)).toBe("Other Staff");
    expect(roleDisplayLabel("OTHER_STAFF")).toBe("Other Staff");
  });

  it("ignores a stray description on the other two roles", () => {
    expect(roleDisplayLabel("SALES_PERSON", "Watchman")).toBe("Sales Person");
    expect(roleDisplayLabel("SERVICE_PERSON", null)).toBe("Service Person");
  });
});

describe("attendanceEntrySchema", () => {
  it("normalizes times to HH:MM", () => {
    const parsed = attendanceEntrySchema.parse({
      employeeId: EMPLOYEE_ID,
      status: "FULL_DAY",
      checkIn: "09:10:00",
      checkOut: "18:15",
    });
    expect(parsed.checkIn).toBe("09:10");
    expect(parsed.checkOut).toBe("18:15");
  });

  it("turns blank times into null", () => {
    const parsed = attendanceEntrySchema.parse({ employeeId: EMPLOYEE_ID, status: "ABSENT", checkIn: "", checkOut: "" });
    expect(parsed.checkIn).toBeNull();
    expect(parsed.checkOut).toBeNull();
  });

  /** Rule 3, enforced server-side too — not just in the browser. */
  it("rejects a check-out at or before check-in", () => {
    const result = attendanceEntrySchema.safeParse({
      employeeId: EMPLOYEE_ID,
      status: "FULL_DAY",
      checkIn: "18:15",
      checkOut: "09:10",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(["checkOut"]);
  });

  /** Rule 4 — an absent employee has no times. */
  it("rejects times on an absent entry", () => {
    expect(
      attendanceEntrySchema.safeParse({ employeeId: EMPLOYEE_ID, status: "ABSENT", checkIn: "09:10", checkOut: "18:15" }).success
    ).toBe(false);
  });

  /**
   * Rule 2 — the admin never submits working hours. A client that tried
   * would have the field dropped rather than honoured.
   */
  it("ignores any working-hours value a client tries to submit", () => {
    const parsed = attendanceEntrySchema.parse({
      employeeId: EMPLOYEE_ID,
      status: "FULL_DAY",
      checkIn: "09:10",
      checkOut: "18:15",
      workingMinutes: 9999,
    } as never);
    expect(parsed).not.toHaveProperty("workingMinutes");
  });
});

describe("saveDailyAttendanceSchema", () => {
  it("requires a valid date and at least one entry", () => {
    expect(
      saveDailyAttendanceSchema.safeParse({
        attendanceDate: "2026-08-18",
        entries: [{ employeeId: EMPLOYEE_ID, status: "FULL_DAY", checkIn: "09:10", checkOut: "18:15" }],
      }).success
    ).toBe(true);

    expect(saveDailyAttendanceSchema.safeParse({ attendanceDate: "2026-08-18", entries: [] }).success).toBe(false);
    expect(saveDailyAttendanceSchema.safeParse({ attendanceDate: "18 Aug 2026", entries: [] }).success).toBe(false);
  });
});

describe("attendanceReportFilterSchema", () => {
  it("treats employee and role as optional — both default to 'all'", () => {
    const parsed = attendanceReportFilterSchema.parse({ from: "2026-08-01", to: "2026-08-31" });
    expect(parsed.employeeId).toBeUndefined();
    expect(parsed.role).toBeUndefined();
  });

  it("rejects a range that ends before it starts", () => {
    const result = attendanceReportFilterSchema.safeParse({ from: "2026-08-31", to: "2026-08-01" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(["to"]);
  });

  it("allows a single-day range", () => {
    expect(attendanceReportFilterSchema.safeParse({ from: "2026-08-18", to: "2026-08-18" }).success).toBe(true);
  });
});
