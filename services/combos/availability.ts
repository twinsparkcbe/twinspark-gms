/**
 * Is this combo sellable right now? (plan §Gap 5, test cases §C.)
 *
 * Two independent switches, deliberately kept separate:
 *
 * - `isActive` — the admin's manual on/off, same soft-deactivate convention
 *   as every other catalog in this system.
 * - the offer window — dates the offer runs between.
 *
 * A combo needs both to be sellable. An expired or switched-off combo still
 * resolves perfectly for the jobs and sales that already used it; this only
 * governs whether it can be added to something new.
 *
 * Pure — no React, no Supabase, no `new Date()` inside the predicate (the
 * caller passes `now`), so it's deterministic under test.
 */

export interface ComboAvailability {
  isActive: boolean;
  /** `YYYY-MM-DD`, or null for "no start date". */
  validFrom: string | null;
  /** `YYYY-MM-DD`, or null for "no end date". */
  validTo: string | null;
}

export type ComboUnavailableReason = "INACTIVE" | "NOT_STARTED" | "EXPIRED";

/**
 * The shop runs on IST, and `valid_to` is a calendar date the owner typed
 * off a poster. An offer ending "31 Aug" must stay live until 23:59:59 IST
 * on the 31st — comparing against UTC midnight would switch it off five and
 * a half hours early, mid-afternoon on the last day.
 */
const IST_OFFSET_MINUTES = 5 * 60 + 30;

/** The `YYYY-MM-DD` calendar date `instant` falls on, in IST. */
export function istDateString(instant: Date): string {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** Why a combo can't be sold right now, or `null` when it can. */
export function comboUnavailableReason(combo: ComboAvailability, now: Date): ComboUnavailableReason | null {
  if (!combo.isActive) return "INACTIVE";

  // Whole-day comparison on the IST calendar date: both bounds inclusive,
  // which is how a date range printed on a poster reads.
  const today = istDateString(now);
  if (combo.validFrom && today < combo.validFrom) return "NOT_STARTED";
  if (combo.validTo && today > combo.validTo) return "EXPIRED";

  return null;
}

export function isComboAvailable(combo: ComboAvailability, now: Date): boolean {
  return comboUnavailableReason(combo, now) === null;
}

export function comboUnavailableMessage(reason: ComboUnavailableReason, comboName: string): string {
  switch (reason) {
    case "INACTIVE":
      return `${comboName} is switched off and can't be added.`;
    case "NOT_STARTED":
      return `${comboName} hasn't started yet.`;
    case "EXPIRED":
      return `${comboName} has ended and can't be added.`;
  }
}
