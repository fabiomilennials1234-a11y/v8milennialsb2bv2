/**
 * Reap policy for WhatsApp instance tombstones (#1476, PRD #1472).
 *
 * The tombstone (#1475) preserves the provider credential before the instance
 * row dies. This module decides what each attempt to use it MEANS: confirm the
 * removal, retry later, or stop trying.
 *
 * Kept pure and outside the edge function on purpose. Both failure modes of this
 * policy are silent: a tombstone that retries forever holds a credential at rest
 * forever, and one that gives up too early leaves an orphan on the provider that
 * nobody will ever look for again.
 */

/**
 * Attempts allowed per tombstone. With the backoff below this spans roughly an
 * hour of provider unavailability before the row is parked for human eyes.
 */
export const REAP_MAX_ATTEMPTS = 8;

/** Minutes between attempts, by attempt number. The last value is the cap. */
export const REAP_BACKOFF_MINUTES = [1, 2, 4, 8, 16] as const;

export type ReapAction = "confirm" | "retry" | "give_up";

export interface ReapAttemptOutcome {
  /** Provider accepted the delete. */
  ok: boolean;
  /** HTTP status, when the request reached the provider at all. */
  status?: number;
  /** Provider or transport error, for the row to explain itself later. */
  error?: string;
}

export interface ReapDecisionInput {
  /** Whether a provider credential was preserved on the tombstone. */
  hasToken: boolean;
  /** Attempts already recorded BEFORE this one. */
  attempts: number;
  /** Result of this attempt. Absent when no attempt was made. */
  outcome?: ReapAttemptOutcome;
}

export interface ReapDecision {
  action: ReapAction;
  /** Set when action is "retry". */
  nextAttemptDelayMs?: number;
  /** Human-readable justification, persisted for diagnosis. */
  reason?: string;
}

const ONE_MINUTE_MS = 60_000;

/**
 * Delay before attempt number `attempt` (1-based), capped at the last step of
 * REAP_BACKOFF_MINUTES. A count below 1 is treated as the first attempt.
 */
export function backoffDelayMs(attempt: number): number {
  const index = Math.max(1, Math.floor(attempt)) - 1;
  const capped = Math.min(index, REAP_BACKOFF_MINUTES.length - 1);
  return REAP_BACKOFF_MINUTES[capped] * ONE_MINUTE_MS;
}

/**
 * Decide the fate of one tombstone after one attempt.
 *
 * Order of checks is load-bearing:
 *   1. no credential  → nothing to attempt, ever
 *   2. success        → confirm, even AT the ceiling (a success recorded as a
 *                       give-up would read as an orphan that was in fact cleaned)
 *   3. 404            → confirm; an instance that does not exist is the goal
 *   4. 401/403        → give up; the provider refuses this credential and no
 *                       number of retries changes that
 *   5. ceiling        → give up and park the row for a human
 *   6. otherwise      → retry with backoff
 */
export function decideReap(input: ReapDecisionInput): ReapDecision {
  const { hasToken, attempts, outcome } = input;

  if (!hasToken) {
    return {
      action: "give_up",
      reason: "sem credencial do provider preservada na lápide",
    };
  }

  if (!outcome) {
    // No attempt was made and there is a credential — leave it for the next run
    // rather than inventing a verdict.
    return {
      action: "retry",
      nextAttemptDelayMs: backoffDelayMs(attempts + 1),
      reason: "nenhuma tentativa executada nesta rodada",
    };
  }

  if (outcome.ok) {
    return { action: "confirm", reason: "provider confirmou a remoção" };
  }

  if (outcome.status === 404) {
    return {
      action: "confirm",
      reason: "instância não existe no provider — estado desejado",
    };
  }

  if (outcome.status === 401 || outcome.status === 403) {
    return {
      action: "give_up",
      reason: `provider recusou a credencial (HTTP ${outcome.status})`,
    };
  }

  const attemptJustRecorded = attempts + 1;
  const detail = outcome.error
    ? `${outcome.error}`
    : `HTTP ${outcome.status ?? "sem status"}`;

  if (attemptJustRecorded >= REAP_MAX_ATTEMPTS) {
    return {
      action: "give_up",
      reason: `teto de ${REAP_MAX_ATTEMPTS} tentativas atingido: ${detail}`,
    };
  }

  return {
    action: "retry",
    nextAttemptDelayMs: backoffDelayMs(attemptJustRecorded),
    reason: detail,
  };
}
