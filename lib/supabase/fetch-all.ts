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

export async function fetchAllRows<T>(
  buildQuery: () => {
    range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
  },
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
