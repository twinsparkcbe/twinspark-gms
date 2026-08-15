/**
 * Service module — business logic. Called by Server Actions
 * (app/(app)/service/actions.ts), never straight from components. See
 * doc/service-module-scope.md for the confirmed feature list.
 */
export * from "./schemas";
export * from "./vehicles";
export * from "./catalog";
export * from "./jobs";
export * from "./job-card";
export * from "./frequent";
export * from "./usage-counts";
// picker/totals/parts-merge/next-step are pure and client-safe — import them
// from their own paths rather than through this barrel, which also re-exports
// server-only modules.
