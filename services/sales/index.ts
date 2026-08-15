/**
 * Sales module — business logic. Called by Server Actions
 * (app/(app)/sales/actions.ts), never straight from components.
 */
export * from "./schemas";
export * from "./customers";
export * from "./sales";
export * from "./returns";
export * from "./escalation";
// sale-row-actions is pure and client-safe — import it from its own path
// rather than through this barrel, which also re-exports server-only modules.
