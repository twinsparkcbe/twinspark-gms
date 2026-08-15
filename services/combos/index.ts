/**
 * Combo Offers — a fixed-price bundle of services and parts, shared by
 * Service and Sales. See doc/service-combo-offers-plan.md for the confirmed
 * feature list.
 *
 * `catalog.ts` is server-only and is re-exported here for Server Actions.
 * `schemas`, `types`, `availability`, `pricing` and `resolve` are pure and
 * client-safe — import those from their own paths in client components
 * rather than through this barrel, which pulls in the data layer.
 */
export * from "./schemas";
export * from "./types";
export * from "./availability";
export * from "./pricing";
export * from "./resolve";
export * from "./catalog";
