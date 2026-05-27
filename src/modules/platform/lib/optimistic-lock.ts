/**
 * Optimistic locking primitives (Issue #307, PRD #284 Fase 4).
 *
 * Critical fields on a lead — pipeline stage, responsible_id,
 * qualification — are mutated through this thin contract so two users
 * editing the same lead at the same time can never silently last-write
 * their way over each other. The pattern is the classic
 *
 *   UPDATE t SET ... WHERE id = ? AND updated_at = ?
 *
 * but expressed in the supabase-js builder. When the row no longer
 * matches the original `updated_at` the server returns "no rows" and
 * we surface a typed conflict error to the UI, which then forces a
 * refetch + toast.
 *
 * Non-critical fields stay on the default last-writer-wins path —
 * field-level partial updates plus the realtime invalidation from
 * #306 already converge fast enough for low-stakes properties (name,
 * notes, etc).
 */

export class OptimisticLockConflictError extends Error {
  readonly code = "OPTIMISTIC_LOCK_CONFLICT";
  constructor(message = "Lead atualizado por outro usuário. Atualizando...") {
    super(message);
    this.name = "OptimisticLockConflictError";
  }
}

/**
 * Returns true when the error returned by a supabase-js single-row
 * update represents "no rows matched" — usually because the WHERE
 * clause included `updated_at` and the row was changed by someone
 * else in between read and write.
 */
export function isPostgrestNoRows(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; details?: string };
  if (e.code === "PGRST116") return true;
  // Some supabase-js versions surface a different code for filtered-out single rows.
  if (typeof e.details === "string" && /\b0 rows\b/i.test(e.details)) return true;
  return false;
}
