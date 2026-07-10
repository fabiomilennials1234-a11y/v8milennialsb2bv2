/**
 * poison-denylist — derived early-drop verdict for ghost-instance webhooks (ERR-4).
 *
 * A "ghost" instance was deleted from whatsapp_instances (org swapped numbers,
 * dev test teardown) but its webhook registration on the Uazapi side survived.
 * It re-posts events forever; each one used to cost a runtime_logs status=error
 * row (87% of all runtime errors) plus a DLQ row that whatsapp-dlq-replay
 * retried 5x with zero chance of success (23K rows for a single token).
 *
 * Verdict is DERIVED, never stored: a token is poison when the DLQ already
 * holds >= DENYLIST_MIN_EXHAUSTED unresolved rows for it that exhausted replay
 * attempts. A legitimately-new instance (secrets row lagging creation) never
 * reaches that bar — its rows resolve on replay long before 50 of them burn
 * 5 attempts each. Re-registering an instance heals automatically once its
 * DLQ rows resolve/age out.
 *
 * The count query is fail-open: on infra error we keep the last known verdict
 * (or allow, if none) — this layer must never drop an event by accident. The
 * cache is per-isolate; worst case a just-fixed token keeps dropping for
 * DENYLIST_CACHE_TTL_MS after its DLQ rows are resolved.
 *
 * Pure module — IO (the actual DLQ count) is injected by the caller so the
 * decision logic is unit-testable without a Supabase client.
 */

/** Unresolved+exhausted DLQ rows required before a token is considered poison. */
export const DENYLIST_MIN_EXHAUSTED = 50;

/** How long a verdict is trusted before re-counting. */
export const DENYLIST_CACHE_TTL_MS = 5 * 60_000;

/** Mirror of whatsapp-dlq-replay MAX_ATTEMPTS — rows at this count are dead. */
export const DLQ_REPLAY_MAX_ATTEMPTS = 5;

/** Log 1 in N dropped events (status=skipped) so the drop stays observable. */
export const POISON_DROP_LOG_SAMPLE = 50;

export function isPoisonCount(count: number | null | undefined): boolean {
  return (count ?? 0) >= DENYLIST_MIN_EXHAUSTED;
}

interface PoisonCheckerDeps {
  /** Counts unresolved unknown_instance DLQ rows with exhausted attempts for
   * the token. Returns null when the count could not be obtained. */
  countExhausted: (token: string) => Promise<number | null>;
  now?: () => number;
}

export type PoisonChecker = (token: string) => Promise<boolean>;

export function makePoisonChecker(deps: PoisonCheckerDeps): PoisonChecker {
  const cache = new Map<string, { poison: boolean; at: number }>();
  const now = deps.now ?? Date.now;

  return async function isPoisonToken(token: string): Promise<boolean> {
    const hit = cache.get(token);
    if (hit && now() - hit.at < DENYLIST_CACHE_TTL_MS) return hit.poison;

    const count = await deps.countExhausted(token);
    if (count === null) {
      // Fail-open: keep a stale verdict if we have one, otherwise allow.
      return hit?.poison ?? false;
    }

    const poison = isPoisonCount(count);
    cache.set(token, { poison, at: now() });
    return poison;
  };
}
