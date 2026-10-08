/**
 * monitor-progress — pure progress snapshot for the Acompanhar step (#910).
 *
 * Given a Blast Plan and how many recipients have been sent so far, derive what
 * the monitor renders: which daily lot is in flight (1-based), how many remain
 * queued, and the overall percentage. Pure and fail-closed — an empty plan
 * yields zeros, never NaN. The live recipient feed (#910 backend) will supply
 * the real `sent`; the math here is the same either way.
 */
import type { BlastPlanResult } from "@/modules/campaigns/lib/blast-planning";

export interface MonitorSnapshot {
  batchTotal: number;
  /** 1-based lot currently in flight (the one holding the next unsent). */
  batchCurrent: number;
  sent: number;
  queued: number;
  /** 0–100, rounded. */
  pct: number;
}

export function monitorSnapshot(
  plan: BlastPlanResult,
  sentTotal: number,
): MonitorSnapshot {
  const total = plan.lots.reduce((sum, lot) => sum + lot.dayTotal, 0);
  const sent = Math.min(Math.max(0, Math.floor(sentTotal)), total);
  const queued = total - sent;
  const pct = total > 0 ? Math.round((sent / total) * 100) : 0;

  // Which lot holds the next unsent recipient: walk the cumulative lot totals.
  let batchCurrent = plan.dayCount > 0 ? 1 : 0;
  let cumulative = 0;
  for (let i = 0; i < plan.lots.length; i++) {
    cumulative += plan.lots[i].dayTotal;
    if (sent < cumulative) {
      batchCurrent = i + 1;
      break;
    }
    batchCurrent = i + 1; // sent covers this lot; stay here if it's the last
  }

  return { batchTotal: plan.dayCount, batchCurrent, sent, queued, pct };
}
