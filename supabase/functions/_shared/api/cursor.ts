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
 * Rows must carry `id` and the sort key, e serem ordenadas pelo keyset.
 *
 * `sortKey` existe porque nem toda listagem ordena por criação: a de Negócio
 * ordena por última atividade (#1767/#1771). A alternativa — contrabandear a
 * chave dentro de `created_at` no objeto da linha — CORROMPE o corpo da
 * resposta, porque é o mesmo objeto que vai serializado para quem integra.
 */
export function paginateByCursor<T extends { id: string }>(
  rows: T[],
  limit: number,
  sortKey: keyof T & string = "created_at" as keyof T & string,
): { page: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last
    ? encodeCursor({ created_at: String(last[sortKey]), id: last.id })
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
