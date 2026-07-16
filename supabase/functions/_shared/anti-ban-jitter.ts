/**
 * anti-ban-jitter — inter-recipient spacing for AUTOMATION send loops
 * (anti-ban Onda 0 QW3).
 *
 * Scope: mass/cron workers only (outbound dispatches, scheduled messages,
 * follow-ups, carteira bulk). NEVER applied to the human 1:1 composer path
 * (whatsapp-api-proxy) nor to the copilot reply loop — those keep their own
 * cadence untouched.
 */

export const JITTER_MIN_MS = 3_000;
export const JITTER_MAX_MS = 8_000;

/** Random per-gap delay in [JITTER_MIN_MS, JITTER_MAX_MS). `rand` injected for
 *  deterministic tests. */
export function jitterDelayMs(rand: () => number = Math.random): number {
  return JITTER_MIN_MS + Math.floor(rand() * (JITTER_MAX_MS - JITTER_MIN_MS));
}

/** Sleep one jitter gap. Callers place this BETWEEN recipients (never before
 *  the first). */
export function sleepJitter(rand?: () => number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, jitterDelayMs(rand)));
}

/**
 * Largest per-tick batch that fits a worker's wall-clock budget when each item
 * can cost up to `perItemWorstMs` (its own work + one max jitter gap).
 * Fail-closed to 1 — a worker must always drain at least one item per tick;
 * whatever doesn't fit stays pending for the next tick.
 */
export function maxBatchForBudget(budgetMs: number, perItemWorstMs: number): number {
  if (
    !Number.isFinite(budgetMs) ||
    !Number.isFinite(perItemWorstMs) ||
    budgetMs <= 0 ||
    perItemWorstMs <= 0
  ) {
    return 1;
  }
  return Math.max(1, Math.floor(budgetMs / perItemWorstMs));
}
