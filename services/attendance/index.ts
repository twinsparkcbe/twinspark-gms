/**
 * attendance module — Attendance Management (doc/attendance-module-scope.md).
 *
 * A deliberately STANDALONE module: its own tables, its own employee roster,
 * its own routes. It imports nothing from services/{sales,service,inventory,
 * purchases,online-orders,users,payments} and nothing imports it. The only
 * things it shares with the rest of the app are authentication
 * (requireAdmin), the app shell, and the design system.
 *
 * Called by Server Actions (app/(app)/attendance/actions.ts) through the
 * plain RLS-scoped client, never straight from components.
 */
export * from "./employees";
export * from "./ist-today";
export * from "./records";
export * from "./schemas";
export * from "./shift-defaults";
export * from "./summary";
export * from "./types";
export * from "./working-hours";
