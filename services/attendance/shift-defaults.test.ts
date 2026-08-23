import { describe, expect, it } from "vitest";

import {
  applyShiftChange,
  DEFAULT_SHIFT_END,
  DEFAULT_SHIFT_START,
  defaultTimesForStatus,
  isValidShift,
  midpointTime,
} from "./shift-defaults";
import { shiftYMD } from "./ist-today";
import type { AttendanceStatus } from "@/types/database.types";

describe("midpointTime", () => {
  it("splits the shop's own day rather than assuming a fixed 13:00", () => {
    expect(midpointTime("09:00", "20:00")).toBe("14:30");
    expect(midpointTime("08:00", "18:00")).toBe("13:00");
    expect(midpointTime("10:00", "21:00")).toBe("15:30");
  });

  it("floors to a whole minute on an odd span", () => {
    expect(midpointTime("09:00", "09:01")).toBe("09:00");
  });

  it("returns null for an unusable shift instead of a nonsense time", () => {
    expect(midpointTime("20:00", "09:00")).toBeNull();
    expect(midpointTime("09:00", "09:00")).toBeNull();
    expect(midpointTime("", "20:00")).toBeNull();
    expect(midpointTime("half nine", "20:00")).toBeNull();
  });
});

describe("defaultTimesForStatus", () => {
  it("gives a full day the whole shift", () => {
    expect(defaultTimesForStatus("FULL_DAY", "09:00", "20:00")).toEqual({ checkIn: "09:00", checkOut: "20:00" });
  });

  /** First + Second across two people must cover the shift exactly — no gap,
   * no overlap — or the two half-day columns stop reconciling. */
  it("meets the two half days at the midpoint", () => {
    const first = defaultTimesForStatus("FIRST_HALF", "09:00", "20:00");
    const second = defaultTimesForStatus("SECOND_HALF", "09:00", "20:00");

    expect(first).toEqual({ checkIn: "09:00", checkOut: "14:30" });
    expect(second).toEqual({ checkIn: "14:30", checkOut: "20:00" });
    expect(first.checkOut).toBe(second.checkIn);
  });

  /** Rule 4 — absent clears both ends. */
  it("clears both times for absent", () => {
    expect(defaultTimesForStatus("ABSENT", "09:00", "20:00")).toEqual({ checkIn: null, checkOut: null });
  });

  it("falls back to blank times when the shift is unusable, rather than guessing", () => {
    expect(defaultTimesForStatus("FULL_DAY", "20:00", "09:00")).toEqual({ checkIn: null, checkOut: null });
    expect(defaultTimesForStatus("FULL_DAY", "", "")).toEqual({ checkIn: null, checkOut: null });
  });

  it("uses the standard shop day when no shift is given", () => {
    expect(defaultTimesForStatus("FULL_DAY")).toEqual({ checkIn: DEFAULT_SHIFT_START, checkOut: DEFAULT_SHIFT_END });
  });

  /** Every generated pair must survive the same validation the DB applies. */
  it("never produces a check-out at or before check-in", () => {
    for (const status of ["FULL_DAY", "FIRST_HALF", "SECOND_HALF"] as const) {
      const { checkIn, checkOut } = defaultTimesForStatus(status, "09:00", "20:00");
      expect(checkIn).not.toBeNull();
      expect(checkOut!.localeCompare(checkIn!)).toBeGreaterThan(0);
    }
  });
});

describe("isValidShift", () => {
  it("accepts a sane shop day and rejects a reversed one", () => {
    expect(isValidShift("09:00", "20:00")).toBe(true);
    expect(isValidShift("20:00", "09:00")).toBe(false);
  });
});

describe("shiftYMD", () => {
  it("steps back a day for Copy Yesterday", () => {
    expect(shiftYMD("2026-08-23", -1)).toBe("2026-08-22");
  });

  it("crosses month and year boundaries", () => {
    expect(shiftYMD("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftYMD("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftYMD("2026-08-31", 1)).toBe("2026-09-01");
  });

  it("handles a leap day", () => {
    expect(shiftYMD("2028-03-01", -1)).toBe("2028-02-29");
  });
});

/**
 * The interaction-count claim the redesign rests on. Marking a normal
 * ten-person day must cost a handful of actions, not sixty — and the bulk
 * fill must never clobber an exception the admin already recorded.
 */
describe("marking a full roster (the daily workflow)", () => {
  type Row = { id: string; status: AttendanceStatus | null; checkIn: string; checkOut: string };

  const roster = (): Row[] =>
    Array.from({ length: 10 }, (_, i) => ({ id: `e${i + 1}`, status: null, checkIn: "", checkOut: "" }));

  /** Mirrors handleMarkAllFullDay: fills only rows still unmarked. */
  function markRemainingFullDay(rows: Row[], start: string, end: string): Row[] {
    const defaults = defaultTimesForStatus("FULL_DAY", start, end);
    return rows.map((row) =>
      row.status !== null
        ? row
        : { ...row, status: "FULL_DAY" as AttendanceStatus, checkIn: defaults.checkIn ?? "", checkOut: defaults.checkOut ?? "" }
    );
  }

  /** Mirrors handleDraftChange: picking a status refills the times. */
  function setStatus(rows: Row[], id: string, status: AttendanceStatus, start: string, end: string): Row[] {
    const defaults = defaultTimesForStatus(status, start, end);
    return rows.map((row) =>
      row.id === id ? { ...row, status, checkIn: defaults.checkIn ?? "", checkOut: defaults.checkOut ?? "" } : row
    );
  }

  it("fills all ten with the shop's hours in a single action", () => {
    const marked = markRemainingFullDay(roster(), "09:00", "20:00");

    expect(marked).toHaveLength(10);
    expect(marked.every((r) => r.status === "FULL_DAY")).toBe(true);
    expect(marked.every((r) => r.checkIn === "09:00" && r.checkOut === "20:00")).toBe(true);
  });

  it("leaves exceptions recorded first untouched", () => {
    let rows = roster();
    rows = setStatus(rows, "e3", "ABSENT", "09:00", "20:00");
    rows = setStatus(rows, "e7", "FIRST_HALF", "09:00", "20:00");
    rows = markRemainingFullDay(rows, "09:00", "20:00");

    expect(rows.find((r) => r.id === "e3")).toMatchObject({ status: "ABSENT", checkIn: "", checkOut: "" });
    expect(rows.find((r) => r.id === "e7")).toMatchObject({ status: "FIRST_HALF", checkIn: "09:00", checkOut: "14:30" });
    expect(rows.filter((r) => r.status === "FULL_DAY")).toHaveLength(8);
  });

  it("is a no-op once every row is already marked", () => {
    const marked = markRemainingFullDay(roster(), "09:00", "20:00");
    expect(markRemainingFullDay(marked, "08:00", "18:00")).toEqual(marked);
  });

  it("respects a garage running different hours", () => {
    const marked = markRemainingFullDay(roster(), "08:00", "18:00");
    expect(marked.every((r) => r.checkIn === "08:00" && r.checkOut === "18:00")).toBe(true);
  });

  /** Switching someone to Absent has to clear the times the bulk fill gave
   * them, or the DB's absent-has-no-times CHECK rejects the save. */
  it("clears the auto-filled times when a marked row is switched to absent", () => {
    let rows = markRemainingFullDay(roster(), "09:00", "20:00");
    rows = setStatus(rows, "e2", "ABSENT", "09:00", "20:00");

    expect(rows.find((r) => r.id === "e2")).toMatchObject({ status: "ABSENT", checkIn: "", checkOut: "" });
  });
});

/**
 * Editing the shop hours must update the rows already filled in — the whole
 * reason the control sits on the toolbar. The hard part is doing that
 * without destroying times a human typed.
 */
describe("applyShiftChange", () => {
  type Row = { id: string; status: AttendanceStatus | null; checkIn: string; checkOut: string; isAutoFilled: boolean };

  const auto = (id: string, status: AttendanceStatus, checkIn: string, checkOut: string): Row => ({
    id,
    status,
    checkIn,
    checkOut,
    isAutoFilled: true,
  });

  it("re-derives every auto-filled row immediately", () => {
    const rows = [auto("a", "FULL_DAY", "09:00", "20:00"), auto("b", "FULL_DAY", "09:00", "20:00")];
    const next = applyShiftChange(rows, "08:00", "18:00");

    expect(next.every((r) => r.checkIn === "08:00" && r.checkOut === "18:00")).toBe(true);
  });

  it("moves the half days to the new midpoint", () => {
    const rows = [auto("a", "FIRST_HALF", "09:00", "14:30"), auto("b", "SECOND_HALF", "14:30", "20:00")];
    const next = applyShiftChange(rows, "08:00", "18:00");

    expect(next[0]).toMatchObject({ checkIn: "08:00", checkOut: "13:00" });
    expect(next[1]).toMatchObject({ checkIn: "13:00", checkOut: "18:00" });
  });

  /** The reason isAutoFilled exists. A time the admin typed is a recorded
   * fact; rewriting it on an unrelated shop-hours edit destroys real data. */
  it("never touches times a human typed", () => {
    const rows: Row[] = [
      auto("a", "FULL_DAY", "09:00", "20:00"),
      { id: "b", status: "FULL_DAY", checkIn: "09:45", checkOut: "19:30", isAutoFilled: false },
    ];
    const next = applyShiftChange(rows, "08:00", "18:00");

    expect(next[0]).toMatchObject({ checkIn: "08:00", checkOut: "18:00" });
    expect(next[1]).toMatchObject({ checkIn: "09:45", checkOut: "19:30" });
  });

  it("leaves absent and unmarked rows alone", () => {
    const rows: Row[] = [
      { id: "a", status: "ABSENT", checkIn: "", checkOut: "", isAutoFilled: true },
      { id: "b", status: null, checkIn: "", checkOut: "", isAutoFilled: true },
    ];
    expect(applyShiftChange(rows, "08:00", "18:00")).toEqual(rows);
  });

  /** A half-typed shift fires onChange too — blanking every row mid-keystroke
   * would be worse than doing nothing. */
  it("does nothing while the shift is unusable", () => {
    const rows = [auto("a", "FULL_DAY", "09:00", "20:00")];

    expect(applyShiftChange(rows, "", "18:00")).toEqual(rows);
    expect(applyShiftChange(rows, "20:00", "08:00")).toEqual(rows);
    expect(applyShiftChange(rows, "09:00", "09:00")).toEqual(rows);
  });

  it("returns the same row objects when nothing actually changes", () => {
    const rows = [auto("a", "FULL_DAY", "09:00", "20:00")];
    const next = applyShiftChange(rows, "09:00", "20:00");

    // Identity preserved — no needless re-render of untouched rows.
    expect(next[0]).toBe(rows[0]);
  });

  it("survives being applied repeatedly as the admin adjusts the hours", () => {
    let rows = [auto("a", "FULL_DAY", "09:00", "20:00"), auto("b", "FIRST_HALF", "09:00", "14:30")];
    rows = applyShiftChange(rows, "08:00", "18:00");
    rows = applyShiftChange(rows, "10:00", "21:00");

    expect(rows[0]).toMatchObject({ checkIn: "10:00", checkOut: "21:00" });
    expect(rows[1]).toMatchObject({ checkIn: "10:00", checkOut: "15:30" });
  });
});
