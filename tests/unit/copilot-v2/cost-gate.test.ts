/**
 * W10 — Cost gate (Copilot v2)
 *
 * Pure decision over an org's accrued spend. Two horizons (CTO decision):
 *  - SOFT daily cap → graceful DEGRADATION in escalating bands (never pauses).
 *  - HARD monthly cap → org-wide auto-PAUSE.
 *
 * Fail posture is fail-closed ON THE COST DIMENSION: if spend can't be read or
 * the caps are malformed, return MAX degrade (cheapest serving) but NOT a hard
 * pause — a transient read error must not nuke a whole org's availability. The
 * nuclear org-pause fires only on a CONFIRMED month-over-hard reading.
 *
 * Everything injected (spend + caps + checkErrored); no clock, no I/O.
 */

import { describe, it, expect } from 'vitest';
import {
  decideCostGate,
  type CostGateInput,
} from '../../../supabase/functions/_shared/copilot-v2/cost-gate.ts';

const base: CostGateInput = {
  dailySpendUsd: 0,
  monthSpendUsd: 0,
  softDailyUsd: 3,
  hardMonthlyUsd: 50,
  checkErrored: false,
};

describe('decideCostGate', () => {
  it('under soft daily + under hard monthly → level 0, no pause', () => {
    const d = decideCostGate({ ...base, dailySpendUsd: 2.99, monthSpendUsd: 49 });
    expect(d).toEqual({ degradeLevel: 0, hardPause: false, reason: null });
  });

  it('daily in [soft, 1.5*soft) → degrade level 1', () => {
    const d = decideCostGate({ ...base, dailySpendUsd: 3.0 });
    expect(d.degradeLevel).toBe(1);
    expect(d.hardPause).toBe(false);
    expect(d.reason).toBe('soft_daily_l1');
  });

  it('daily in [1.5*soft, 2*soft) → degrade level 2', () => {
    const d = decideCostGate({ ...base, dailySpendUsd: 4.5 });
    expect(d.degradeLevel).toBe(2);
    expect(d.hardPause).toBe(false);
  });

  it('daily >= 2*soft → degrade level 3, still no pause', () => {
    const d = decideCostGate({ ...base, dailySpendUsd: 6.1 });
    expect(d.degradeLevel).toBe(3);
    expect(d.hardPause).toBe(false);
  });

  it('month >= hard → org hard pause (level 3), regardless of daily', () => {
    const d = decideCostGate({ ...base, dailySpendUsd: 0.5, monthSpendUsd: 50 });
    expect(d).toEqual({ degradeLevel: 3, hardPause: true, reason: 'hard_monthly_cap' });
  });

  it('hard monthly takes precedence over a low soft daily band', () => {
    const d = decideCostGate({ ...base, dailySpendUsd: 3.0, monthSpendUsd: 99 });
    expect(d.hardPause).toBe(true);
    expect(d.reason).toBe('hard_monthly_cap');
  });

  it('checkErrored → fail-closed: serve at cheapest (model+retrieval shrink), NO hold, NO pause', () => {
    // Uncertainty about spend degrades to cheap (L2) but never DEFERS (L3 holding)
    // or PAUSES — only a confirmed breach does that. Avoids punishing a possibly-
    // fine org's UX on a transient read error.
    const d = decideCostGate({ ...base, checkErrored: true });
    expect(d).toEqual({ degradeLevel: 2, hardPause: false, reason: 'cost_check_failed' });
  });

  it('malformed caps (NaN / non-positive) → fail-closed L2 serve, no pause', () => {
    expect(decideCostGate({ ...base, hardMonthlyUsd: NaN })).toEqual({ degradeLevel: 2, hardPause: false, reason: 'cost_check_failed' });
    expect(decideCostGate({ ...base, softDailyUsd: 0 })).toEqual({ degradeLevel: 2, hardPause: false, reason: 'cost_check_failed' });
    expect(decideCostGate({ ...base, softDailyUsd: -1 })).toEqual({ degradeLevel: 2, hardPause: false, reason: 'cost_check_failed' });
  });

  it('malformed spend (negative / non-finite) → fail-closed L2 serve, no pause', () => {
    expect(decideCostGate({ ...base, dailySpendUsd: -5 }).degradeLevel).toBe(2);
    expect(decideCostGate({ ...base, monthSpendUsd: Infinity }).reason).toBe('cost_check_failed');
  });

  it('is deterministic: same input → same output', () => {
    const inp = { ...base, dailySpendUsd: 4.5, monthSpendUsd: 12 };
    expect(decideCostGate(inp)).toEqual(decideCostGate(inp));
  });
});
