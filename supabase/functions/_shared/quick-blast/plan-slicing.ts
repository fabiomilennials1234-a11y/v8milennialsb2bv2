/**
 * plan-slicing — pure lot math for Blast Plans (ADR-0003, #707).
 *
 * A Blast Plan freezes an audience at creation and drains it over consecutive
 * days, each day's lot bounded by the shared Daily Blast Budget (#706). This
 * module carries the deterministic, IO-free decisions:
 *
 *   - planLotCount   : how many daily lots an audience of N needs at a daily cap.
 *   - selectLotSlice : given a lot's PENDING recipients + today's remaining
 *     budget, decide how many go out now and how many defer to the next day.
 *   - addDaysIso     : Sao Paulo calendar-date arithmetic for `next_release_date`.
 *
 * No IO, no clock dependence (dates are passed in). Mirrors the pure-core split
 * of refinements.ts / daily-budget.ts so the orchestrator is unit-testable
 * without a live DB. Fail-closed throughout: a non-positive budget collapses to
 * one recipient per day (never Infinity lots, never divide-by-zero), and a
 * negative remaining budget yields zero-to-send (never a negative dispatch).
 */

/**
 * Number of consecutive daily lots needed to drain `total` recipients at a
 * `dailyBudget` per day. 0 for an empty audience. A non-positive budget fails
 * closed to a 1-per-day cap (so N lots), never Infinity / NaN.
 */
export function planLotCount(total: number, dailyBudget: number): number {
  const t = Math.max(0, Math.floor(total));
  if (t === 0) return 0;
  const cap = Math.floor(dailyBudget);
  if (!Number.isFinite(cap) || cap < 1) return t; // fail closed: 1/day
  return Math.ceil(t / cap);
}

export interface LotSliceInput {
  /** Recipients in this lot still pending (not yet sent/skipped). */
  pendingCount: number;
  /** Daily Blast Budget headroom left for today, shared across all blasts. */
  remainingBudget: number;
}

export interface LotSliceResult {
  /** How many of the pending recipients go out now: clamp(pending, 0, budget). */
  toSend: number;
  /** Remainder pushed to the next day (elastic duration). */
  deferred: number;
  /** True when the lot has nothing left after this slice (toSend covered all). */
  lotFullyDrained: boolean;
}

/**
 * Decide today's release for a single lot. Sends at most the remaining daily
 * budget; anything beyond it defers to the next day (elastic — a lot that can't
 * fully fit pushes its remainder forward rather than dropping it). Fail-closed:
 * a non-positive budget sends nothing and defers the whole lot.
 */
export function selectLotSlice(input: LotSliceInput): LotSliceResult {
  const pending = Math.max(0, Math.floor(input.pendingCount));
  const budget = Math.max(0, Math.floor(input.remainingBudget));
  const toSend = Math.min(pending, budget);
  const deferred = pending - toSend;
  return { toSend, deferred, lotFullyDrained: deferred === 0 };
}

/**
 * Add `days` to a YYYY-MM-DD calendar date, returning YYYY-MM-DD. Pure date
 * arithmetic anchored at UTC noon so it never drifts across a day boundary due
 * to the server's own timezone — the input/output are bare calendar dates (the
 * Sao Paulo `next_release_date`), not instants.
 */
export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map((p) => parseInt(p, 10));
  // Noon UTC anchor: a +days shift can never cross a date boundary by zone.
  const base = Date.UTC(y, m - 1, d, 12, 0, 0);
  const shifted = new Date(base + Math.floor(days) * 24 * 60 * 60 * 1000);
  const yy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
