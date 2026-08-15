import { z } from "zod";

/**
 * One rule for every mobile number the app accepts — Sales, Service, Online
 * Orders. Previously each module carried its own check: Sales and Service
 * allowed 10-15 characters of *anything*, so a pasted string of 30 digits
 * saved happily and then matched no existing customer (mobile number is the
 * find-or-create key in all three modules), while Online Orders already
 * enforced the correct rule. This is that correct rule, hoisted so there's
 * exactly one of it.
 *
 * Indian mobile numbers: exactly 10 digits, first digit 6-9. Inputs are
 * sanitized as the user types (`sanitizeMobileNumber`), so a field can never
 * hold a non-digit or an 11th character in the first place; the schema is
 * the server-side backstop.
 */
export const MOBILE_NUMBER_LENGTH = 10;

export const MOBILE_NUMBER_REGEX = /^[6-9]\d{9}$/;

export const MOBILE_NUMBER_ERROR = "Enter a valid 10-digit mobile number.";

/**
 * What a mobile input's onChange runs on every keystroke and paste: strips
 * everything that isn't a digit, drops a country/trunk prefix, and hard-caps
 * the length.
 *
 * The prefix handling only fires on lengths that typing can't produce (the
 * field is capped at 10), so it's effectively paste-only — which is where it
 * matters, since numbers copied out of WhatsApp or a contact card arrive as
 * "+91 98765 43210" and would otherwise be truncated to the first 10 digits
 * of "919876543210" and silently saved as a different, wrong number.
 */
export function sanitizeMobileNumber(value: string): string {
  const digits = value.replace(/\D/g, "");

  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);

  return digits.slice(0, MOBILE_NUMBER_LENGTH);
}

export function isValidMobileNumber(value: string): boolean {
  return MOBILE_NUMBER_REGEX.test(value.trim());
}

export const mobileNumberSchema = z.string().trim().regex(MOBILE_NUMBER_REGEX, MOBILE_NUMBER_ERROR);
