import "server-only";

/**
 * Run `fn` over `items` with at most `limit` calls in flight at once.
 * Preserves input ordering in the returned array.
 *
 * Used by the SmugMug tree walker so a single division-deep walk doesn't
 * fan out hundreds of unbounded API calls (which would trip 429s and
 * waste retry budget). 5-ish in flight is a healthy default for SmugMug
 * — well under the documented per-second rate limit but enough to make
 * the walk finish in a reasonable time.
 */
export async function mapWithConcurrency<T, U>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<U>
): Promise<U[]> {
  if (items.length === 0) return [];
  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  const results: U[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: effectiveLimit }, worker));
  return results;
}
