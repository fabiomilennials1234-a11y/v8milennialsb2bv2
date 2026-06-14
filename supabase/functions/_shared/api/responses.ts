/**
 * REST response envelope for the public API v1 (ADR-0008).
 *
 * - Errors:          `{ error: { code, message, details? } }`
 * - List resources:  `{ data, next_cursor, has_more }`
 * - Single resource: the object itself (no wrapper)
 *
 * Distinct from the internal `_shared/response.ts` envelope (which spreads
 * `success`/`meta` for legacy webhook clients). The public API is a clean,
 * separately-versioned contract.
 */

type Cors = Record<string, string>;

function json(
  status: number,
  body: unknown,
  cors: Cors,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, ...extraHeaders, "content-type": "application/json" },
  });
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Builds an error response with a stable, programmable `code`. */
export function apiError(
  status: number,
  code: string,
  message: string,
  cors: Cors,
  details?: unknown,
  extraHeaders?: Record<string, string>,
): Response {
  const error: ApiErrorBody["error"] = { code, message };
  if (details !== undefined) error.details = details;
  return json(status, { error }, cors, extraHeaders);
}

/** Builds a paginated list response. `nextCursor === null` ⇒ last page. */
export function apiList<T>(
  data: T[],
  nextCursor: string | null,
  cors: Cors,
): Response {
  return json(200, {
    data,
    next_cursor: nextCursor,
    has_more: nextCursor !== null,
  }, cors);
}

/** Builds a single-resource response (object returned verbatim). */
export function apiResource(
  resource: unknown,
  cors: Cors,
  status = 200,
): Response {
  return json(status, resource, cors);
}
