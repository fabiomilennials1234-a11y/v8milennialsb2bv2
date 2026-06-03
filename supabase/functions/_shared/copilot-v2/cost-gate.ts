/**
 * cost-gate — Copilot v2 cost governance decision (W10, pure).
 *
 * Reads an org's accrued spend against two horizons and decides what the worker
 * should do this turn:
 *  - SOFT daily cap → graceful degradation in escalating bands (degradeLevel
 *    1..3). Never pauses — the org keeps serving, just cheaper.
 *  - HARD monthly cap → org-wide auto-pause (hardPause=true).
 *
 * Fail-closed on the COST dimension: an unreadable spend or a malformed cap
 * yields MAX degrade (cheapest possible serving) but NOT a hard pause. We never
 * take a whole org offline on a transient read error — the org-pause is
 * reserved for a confirmed month-over-hard. All inputs injected; no I/O, no
 * clock.
 */

export interface CostGateInput {
  /** USD spent by this org SO FAR TODAY (caller's window). */
  dailySpendUsd: number;
  /** USD spent by this org SO FAR THIS MONTH (caller's window). */
  monthSpendUsd: number;
  /** Soft daily cap (USD) — degradation threshold. */
  softDailyUsd: number;
  /** Hard monthly cap (USD) — org auto-pause threshold. */
  hardMonthlyUsd: number;
  /** True if the spend lookup itself threw. */
  checkErrored: boolean;
}

export interface CostGateDecision {
  /** 0 = none, 1 = model, 2 = +retrieval, 3 = +holding. Consumed by decideDegradation. */
  degradeLevel: 0 | 1 | 2 | 3;
  /** True → the org must be auto-paused (hard monthly cap breached). */
  hardPause: boolean;
  reason:
    | null
    | 'soft_daily_l1'
    | 'soft_daily_l2'
    | 'soft_daily_l3'
    | 'hard_monthly_cap'
    | 'cost_check_failed';
}

// Fail-closed = serve at cheapest (model + retrieval shrink, L2). NOT L3: an
// unreadable spend / malformed cap must not DEFER (holding) or PAUSE the org —
// only a CONFIRMED breach does that. Minimizes spend without punishing UX.
const FAIL_CLOSED: CostGateDecision = { degradeLevel: 2, hardPause: false, reason: 'cost_check_failed' };

function bad(n: number): boolean {
  return typeof n !== 'number' || !Number.isFinite(n) || n < 0;
}

export function decideCostGate(input: CostGateInput): CostGateDecision {
  const { dailySpendUsd, monthSpendUsd, softDailyUsd, hardMonthlyUsd, checkErrored } = input;

  // Fail-closed: can't trust the numbers → cheapest serving, no org pause.
  if (
    checkErrored ||
    bad(dailySpendUsd) || bad(monthSpendUsd) ||
    bad(softDailyUsd) || bad(hardMonthlyUsd) ||
    softDailyUsd <= 0 || hardMonthlyUsd <= 0
  ) {
    return FAIL_CLOSED;
  }

  // Hard monthly cap → org-wide pause (the only path that pauses).
  if (monthSpendUsd >= hardMonthlyUsd) {
    return { degradeLevel: 3, hardPause: true, reason: 'hard_monthly_cap' };
  }

  // Soft daily bands → escalating degradation, never a pause.
  if (dailySpendUsd >= softDailyUsd * 2) {
    return { degradeLevel: 3, hardPause: false, reason: 'soft_daily_l3' };
  }
  if (dailySpendUsd >= softDailyUsd * 1.5) {
    return { degradeLevel: 2, hardPause: false, reason: 'soft_daily_l2' };
  }
  if (dailySpendUsd >= softDailyUsd) {
    return { degradeLevel: 1, hardPause: false, reason: 'soft_daily_l1' };
  }

  return { degradeLevel: 0, hardPause: false, reason: null };
}
