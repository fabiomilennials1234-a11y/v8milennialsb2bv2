/**
 * BlastPlanner — pure multi-number lot planning for Blast Plans (ADR-0015).
 *
 * Generalizes plan-slicing.ts from a single org-wide Daily Blast Budget to a set
 * of selected WhatsApp numbers, each carrying its own per-day cap (the Number
 * Daily Cap). A blast's daily capacity is the sum of the selected numbers' caps;
 * an audience larger than one day's capacity is sliced into consecutive daily
 * lots, each day distributing that day's send round-robin across the numbers,
 * never exceeding any single number's cap.
 *
 * No IO, no clock dependence — the start date is passed in. Fail-closed: no
 * numbers / non-positive caps collapse to a safe empty plan (never Infinity,
 * never divide-by-zero).
 */

import { addDaysIso } from "./plan-slicing.ts";

export interface BlastNumber {
  /** Instance id of the WhatsApp number. */
  id: string;
  /** That number's Number Daily Cap (max sends/day). */
  cap: number;
}

export interface BlastPlanInput {
  totalRecipients: number;
  numbers: BlastNumber[];
  /** YYYY-MM-DD (Sao Paulo calendar date) the plan starts. */
  startDateIso: string;
}

export interface NumberShare {
  id: string;
  count: number;
}

export interface DayLot {
  dateIso: string;
  perNumber: NumberShare[];
  dayTotal: number;
}

export interface BlastPlanResult {
  lots: DayLot[];
  /** Number of consecutive daily lots — powers the live "→ N dias" readout. */
  dayCount: number;
  /** Combined daily capacity = Σ of the selected numbers' caps. */
  dailyCapacity: number;
  /** False when the whole audience fits one day (no multi-day plan). */
  isPlan: boolean;
}

/**
 * Distribute a single day's send across the numbers round-robin, one recipient
 * at a time, skipping any number that has reached its cap. Even by construction
 * (equal caps differ by ≤1) and cap-respecting (a saturated number is skipped,
 * its share spilling to the others).
 */
function distributeDay(
  dayTotal: number,
  caps: { id: string; cap: number }[],
): NumberShare[] {
  const shares = caps.map((c) => ({ id: c.id, count: 0 }));
  let left = dayTotal;
  let progressed = true;
  while (left > 0 && progressed) {
    progressed = false;
    for (let i = 0; i < caps.length && left > 0; i++) {
      if (shares[i].count < caps[i].cap) {
        shares[i].count++;
        left--;
        progressed = true;
      }
    }
  }
  return shares;
}

export function planBlast(input: BlastPlanInput): BlastPlanResult {
  const total = Math.max(0, Math.floor(input.totalRecipients));
  const dailyCapacity = input.numbers.reduce(
    (sum, n) => sum + Math.max(0, Math.floor(n.cap)),
    0,
  );

  const dayCount =
    total > 0 && dailyCapacity > 0 ? Math.ceil(total / dailyCapacity) : 0;

  const caps = input.numbers.map((n) => ({
    id: n.id,
    cap: Math.max(0, Math.floor(n.cap)),
  }));

  const lots: DayLot[] = [];
  let remaining = total;
  for (let day = 0; day < dayCount; day++) {
    const dayTotal = Math.min(remaining, dailyCapacity);
    lots.push({
      dateIso: addDaysIso(input.startDateIso, day),
      perNumber: distributeDay(dayTotal, caps),
      dayTotal,
    });
    remaining -= dayTotal;
  }

  return {
    lots,
    dayCount,
    dailyCapacity,
    isPlan: dayCount > 1,
  };
}
