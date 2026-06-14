/**
 * Opaque keyset cursor for list pagination (ADR-0008, decision 3).
 *
 * Encodes the last row's `(created_at, id)` tuple as base64 JSON. Opaque to
 * clients: they pass it back verbatim. Invalid/garbage tokens decode to `null`
 * so callers treat them as "no cursor" rather than erroring.
 */

export interface Cursor {
  created_at: string;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return btoa(JSON.stringify({ c: c.created_at, i: c.id }));
}

/**
 * Splits an over-fetched result set (limit+1 rows) into a page plus the
 * next cursor. Returns `nextCursor: null` when there is no further page.
 * Rows must carry `created_at` + `id` and be ordered by the keyset.
 */
export function paginateByCursor<T extends Cursor>(
  rows: T[],
  limit: number,
): { page: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last
    ? encodeCursor({ created_at: last.created_at, id: last.id })
    : null;
  return { page, nextCursor };
}

export function decodeCursor(token: string | null | undefined): Cursor | null {
  if (!token) return null;
  try {
    const parsed = JSON.parse(atob(token));
    if (
      parsed && typeof parsed.c === "string" && typeof parsed.i === "string"
    ) {
      return { created_at: parsed.c, id: parsed.i };
    }
    return null;
  } catch {
    return null;
  }
}
