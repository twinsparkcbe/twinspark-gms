import { describe, expect, it } from "vitest";

import { istGreeting, istTodayLabel } from "./greeting";

describe("istGreeting", () => {
  it("greets by IST wall-clock, not the server's own timezone", () => {
    // 03:30Z is 09:00 IST — morning in Coimbatore even though a UTC host
    // would still call it early.
    expect(istGreeting(new Date("2026-08-12T03:30:00.000Z"))).toBe("Good morning");
  });

  it("switches to afternoon from midday IST", () => {
    expect(istGreeting(new Date("2026-08-12T06:30:00.000Z"))).toBe("Good afternoon"); // 12:00 IST
  });

  it("switches to evening from 5pm IST", () => {
    expect(istGreeting(new Date("2026-08-12T11:30:00.000Z"))).toBe("Good evening"); // 17:00 IST
  });

  it("still reads as morning just after IST midnight, when UTC is on the previous day", () => {
    expect(istGreeting(new Date("2026-08-11T18:31:00.000Z"))).toBe("Good morning"); // 00:01 IST, 12 Aug
  });
});

describe("istTodayLabel", () => {
  it("renders the IST weekday, day, month and year", () => {
    expect(istTodayLabel(new Date("2026-08-12T04:30:00.000Z"))).toBe("Wednesday, 12 August 2026");
  });

  it("rolls to the next IST day after 18:30Z, not at midnight UTC", () => {
    expect(istTodayLabel(new Date("2026-08-11T18:31:00.000Z"))).toBe("Wednesday, 12 August 2026");
  });

  it("stays on the current IST day just before the rollover", () => {
    expect(istTodayLabel(new Date("2026-08-11T18:29:00.000Z"))).toBe("Tuesday, 11 August 2026");
  });
});
