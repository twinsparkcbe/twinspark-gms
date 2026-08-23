"use client";

import { useCallback, useEffect, useState } from "react";

import { DEFAULT_SHIFT_START, DEFAULT_SHIFT_END, isValidShift } from "@/services/attendance/shift-defaults";

const STORAGE_KEY = "twinspark.attendance.shiftHours";

/**
 * The shop's normal open/close times, remembered between visits.
 *
 * Held in localStorage rather than a settings table on purpose: this only
 * pre-fills the time inputs, it is never itself stored as attendance data,
 * so it costs nothing to be wrong and doesn't justify a migration. It is
 * shown and editable right on the toolbar, so it can never quietly differ
 * from what the admin expects. Every access is wrapped — a private window or
 * blocked site data must not break the screen.
 */
export function useShiftHours() {
  const [shiftStart, setShiftStart] = useState(DEFAULT_SHIFT_START);
  const [shiftEnd, setShiftEnd] = useState(DEFAULT_SHIFT_END);

  // Read after mount, never during render — the server has no localStorage,
  // and seeding initial state from it would be a hydration mismatch.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { start?: unknown; end?: unknown };
      if (typeof parsed.start === "string" && typeof parsed.end === "string" && isValidShift(parsed.start, parsed.end)) {
        setShiftStart(parsed.start);
        setShiftEnd(parsed.end);
      }
    } catch {
      // Unreadable or blocked — the built-in defaults are already in place.
    }
  }, []);

  const persist = useCallback((start: string, end: string) => {
    try {
      if (isValidShift(start, end)) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ start, end }));
      }
    } catch {
      // Storage unavailable — the value still works for this session.
    }
  }, []);

  const updateStart = useCallback(
    (value: string) => {
      setShiftStart(value);
      persist(value, shiftEnd);
    },
    [persist, shiftEnd]
  );

  const updateEnd = useCallback(
    (value: string) => {
      setShiftEnd(value);
      persist(shiftStart, value);
    },
    [persist, shiftStart]
  );

  return { shiftStart, shiftEnd, updateStart, updateEnd, isValid: isValidShift(shiftStart, shiftEnd) };
}
