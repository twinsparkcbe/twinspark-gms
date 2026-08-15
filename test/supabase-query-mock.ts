import { vi } from "vitest";

export interface MockResult<T = unknown> {
  data: T | null;
  error: { code?: string; message: string } | null;
  count?: number | null;
}

const CHAIN_METHODS = [
  "select",
  "insert",
  "update",
  "delete",
  "eq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "is",
  "ilike",
  "or",
  "not",
  "order",
  "range",
  "limit",
] as const;

/**
 * Chainable + thenable mock that mimics Supabase's PostgrestFilterBuilder:
 * every query method returns the same object (so `.from().select().eq()...`
 * chains freely), and awaiting it at any point in the chain resolves to
 * `result` — matching how the real client can be awaited directly or after
 * `.single()`/`.maybeSingle()`.
 */
export function createQueryBuilderMock<T>(result: MockResult<T>) {
  const builder: Record<string, unknown> = {};

  for (const method of CHAIN_METHODS) {
    builder[method] = vi.fn(() => builder);
  }

  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.then = (
    resolve: (value: MockResult<T>) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);

  return builder;
}

export function createSupabaseMock(
  queryBuilder: ReturnType<typeof createQueryBuilderMock>,
  rpcResult: MockResult = { data: null, error: null }
) {
  return {
    from: vi.fn(() => queryBuilder),
    rpc: vi.fn(() => Promise.resolve(rpcResult)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
