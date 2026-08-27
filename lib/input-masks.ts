/**
 * Keystroke-level input masks for numeric form fields.
 *
 * Lives in lib/ rather than inside a module because Sales needs the amount
 * mask for its negotiated line price and Attendance needs both for the
 * employee form — and a module importing another module's helper is exactly
 * the coupling the Attendance module was built to avoid.
 *
 * `inputMode="numeric"` only hints which keyboard a phone should show — it
 * places no restriction on a desktop keyboard, so the mobile field happily
 * accepted letters and a number of any length. Rejecting that on submit is
 * worse than not accepting it in the first place: the admin types a wrong
 * character, nothing reacts, and they find out only when Save fails.
 *
 * Pure string functions, so the rules are unit-tested rather than trusted.
 */

/** Digits, at most 10, tolerating the two ways Indian numbers get pasted. */
export function maskMobileInput(raw: string): string {
  let digits = raw.replace(/\D/g, "");

  // "+91 98765 43210" and "098765 43210" are both things people paste from a
  // contacts app. Dropping the prefix keeps the 10 digits that matter instead
  // of truncating to the wrong ten.
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  return digits.slice(0, 10);
}

const MAX_RUPEE_DIGITS = 7; // up to 99,99,999 — far beyond any daily wage

/** Digits with at most one decimal point and two decimal places. */
export function maskAmountInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");

  // Keep the first decimal point and discard any later ones, so "6.0.0"
  // collapses to "6.00" rather than being rejected wholesale.
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned.slice(0, MAX_RUPEE_DIGITS);

  const whole = cleaned.slice(0, firstDot).slice(0, MAX_RUPEE_DIGITS);
  const fraction = cleaned.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
  return `${whole}.${fraction}`;
}
