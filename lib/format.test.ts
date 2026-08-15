import { describe, expect, it } from "vitest";

import { fromISTDateInput, toISTDateInput } from "./format";

describe("toISTDateInput / fromISTDateInput", () => {
  it("returns the IST calendar date for a timestamp", () => {
    expect(toISTDateInput("2026-08-15T04:30:00.000Z")).toBe("2026-08-15");
  });

  // 20:00 UTC is already the next day in IST (01:30) — the garage's date,
  // not the UTC one, is what staff typed.
  it("uses the IST day, not the UTC day, late in the evening", () => {
    expect(toISTDateInput("2026-08-15T20:00:00.000Z")).toBe("2026-08-16");
  });

  it("returns an empty string for no date", () => {
    expect(toISTDateInput(null)).toBe("");
  });

  it("resolves a picked date to the end of that IST day", () => {
    // 2026-08-15 23:59 IST === 2026-08-15 18:29 UTC
    expect(fromISTDateInput("2026-08-15").toISOString()).toBe("2026-08-15T18:29:00.000Z");
  });

  it("round-trips a date through both helpers", () => {
    expect(toISTDateInput(fromISTDateInput("2026-08-15").toISOString())).toBe("2026-08-15");
  });
});
