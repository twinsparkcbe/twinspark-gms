/**
 * Supabase (PostgREST) silently caps every response at 1000 rows — no error,
 * the rest just never arrives. Any query that feeds a SUM must therefore be
 * read page by page, or a busy period quietly under-counts (the Profit
 * Report's Cost of Goods Sold lost whole months this way).
 *
 * `buildQuery` must return a FRESH query each call (a builder is one-shot)
 * and must include a stable `.order(...)` — without one, pages can overlap or
 * skip rows. Order by a unique column such as `id`.
 */
export const PAGE_SIZE = 1000;

interface PageableQuery {
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
}

export async function fetchAllRows<T>(
  buildQuery: () => PageableQuery,
  pageSize: number = PAGE_SIZE
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
}

/**
 * Same paging, but resolves to the `{ data, error }` shape a plain awaited
 * query returns — so a call site can swap `supabase.from(...)...` for
 * `fetchAllAsResponse(() => supabase.from(...)....order("id"))` and leave the
 * error handling and row processing below it untouched.
 */
export async function fetchAllAsResponse<T>(
  buildQuery: () => PageableQuery,
  pageSize: number = PAGE_SIZE
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  try {
    return { data: await fetchAllRows<T>(buildQuery, pageSize), error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}
