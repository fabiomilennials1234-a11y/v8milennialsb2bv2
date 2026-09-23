/** Preserve provider millisecond precision; second-only events remain second-only. */
export function messageTimestamp(value: unknown, now = Date.now()): string {
  const raw = Number(value ?? now);
  return new Date(Number.isFinite(raw) ? (raw > 1e12 ? raw : raw * 1000) : now).toISOString();
}
