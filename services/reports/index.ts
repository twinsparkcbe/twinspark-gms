/**
 * Reports module — business logic. Called by Server Actions
 * (app/(app)/reports/actions.ts), never straight from components. See
 * doc/reports-scope.md for the confirmed feature list. Six of the nine
 * report types reuse existing stats/list functions from Inventory/
 * Purchases/Sales/Service/Dashboard directly (no exports needed here for
 * those) — only the genuinely new logic lives in this module.
 */
export * from "./ageing-stock";
export * from "./customer-followup";
export * from "./collections";
export * from "./revenue";
export * from "./profit";
export * from "./gst";
