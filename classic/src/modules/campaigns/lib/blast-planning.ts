/**
 * blast-planning — frontend twin of the pure Blast planning core (#904).
 *
 * The canonical planning math lives in the Deno edge runtime:
 *   - supabase/functions/_shared/quick-blast/blast-planner.ts  (planBlast, ADR-0015)
 *   - supabase/functions/_shared/quick-blast/quiet-hours.ts    (nextValidSendTime, #909)
 *   - supabase/functions/_shared/quick-blast/plan-slicing.ts   (addDaysIso, ADR-0003)
 *
 * Those files use Deno-style explicit `.ts` import specifiers and live outside
 * the frontend `tsconfig`/ESLint `boundaries` graph, so they cannot be imported
 * directly into the Vite bundle. This module is their byte-for-byte frontend
 * twin — same algorithm, no divergence — so the Disparos wizard can show the
 * live "→ N dias" plan readout and the first valid send time without a round
 * trip. It follows the documented twin precedent (the permissions engine twin
 * in `identity/permissions/lib/permissions.ts`).
 *
 * INVARIANT: keep in lockstep with the Deno source. Parity is pinned by
 * `tests/unit/blast-planning-twin.test.ts`, which mirrors the canonical test
 * vectors. No IO, no clock dependence — dates are passed in.
 */

// ── BlastPlanner ──────────────────────────────────────────────────────────

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
 * Add `days` to a YYYY-MM-DD calendar date, returning YYYY-MM-DD. Pure date
 * arithmetic anchored at UTC noon so it never drifts across a day boundary due
 * to the runtime's own timezone — the input/output are bare calendar dates.
 */
export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map((p) => parseInt(p, 10));
  const base = Date.UTC(y, m - 1, d, 12, 0, 0);
  const shifted = new Date(base + Math.floor(days) * 24 * 60 * 60 * 1000);
  const yy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Distribute a single day's send across the numbers round-robin, one recipient
 * at a time, skipping any number that has reached its cap.
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

// ── Quiet hours ───────────────────────────────────────────────────────────

export interface QuietWindow {
  /** Allowed weekdays, 0=Sun … 6=Sat. */
  days: number[];
  /** Window open, minutes from local midnight (e.g. 08:00 → 480). */
  fromMinutes: number;
  /** Window close (exclusive), minutes from local midnight (e.g. 20:00 → 1200). */
  toMinutes: number;
}

interface LocalParts {
  y: number;
  m: number;
  d: number;
  minutes: number;
}

function parse(iso: string): LocalParts {
  const [date, time] = iso.split("T");
  const [y, m, d] = date.split("-").map((p) => parseInt(p, 10));
  const [hh, mm] = time.split(":").map((p) => parseInt(p, 10));
  return { y, m, d, minutes: hh * 60 + mm };
}

function format(p: LocalParts): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const hh = Math.floor(p.minutes / 60);
  const mm = p.minutes % 60;
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(hh)}:${pad(mm)}`;
}

/** Weekday (0=Sun…6=Sat) of a YYYY-MM-DD date, via a fixed UTC anchor. */
function weekdayOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Given the allowed window and a candidate org-local wall-clock time
 * ("YYYY-MM-DDTHH:mm"), return the next time inside the window (the candidate
 * itself when already valid). The window is half-open [from, to).
 */
export function nextValidSendTime(
  window: QuietWindow,
  candidateIso: string,
): string {
  const allowed = new Set(window.days);
  if (allowed.size === 0) return candidateIso;

  let { y, m, d, minutes } = parse(candidateIso);

  for (let i = 0; i < 8; i++) {
    if (allowed.has(weekdayOf(y, m, d))) {
      if (minutes < window.fromMinutes) {
        return format({ y, m, d, minutes: window.fromMinutes });
      }
      if (minutes < window.toMinutes) {
        return format({ y, m, d, minutes });
      }
    }
    const next = addDaysIso(
      `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      1,
    );
    [y, m, d] = next.split("-").map((p) => parseInt(p, 10));
    minutes = window.fromMinutes;
  }

  return format({ y, m, d, minutes: window.fromMinutes });
}

/** Default blast window: 08:00–20:00, Mon–Sat (matches the Deno default). */
export const DEFAULT_QUIET_WINDOW: QuietWindow = {
  days: [1, 2, 3, 4, 5, 6],
  fromMinutes: 8 * 60,
  toMinutes: 20 * 60,
};
