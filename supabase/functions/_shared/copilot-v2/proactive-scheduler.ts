/**
 * proactive-scheduler — Copilot v2 outbound proactivity (Slice 11, ADR #11).
 *
 * PURE decision layer for the proactive scheduler. The cron edge shell selects
 * candidates and performs the I/O (DB reads, enqueue RPC); THIS module decides
 * the fail-CLOSED gates (business-hours, rate-limit) and computes the STABLE
 * idempotency key that kills the v1 double-send (#7/#8/#9). No Date.now(), no
 * DB — every clock/effect is injected, so the whole policy is unit-testable.
 */

/** Per-org commercial window. tz is an IANA zone (Intl is available in Deno). */
export interface BusinessHoursWindow {
  /** ISO weekdays allowed, 1=Mon … 7=Sun. */
  days: number[];
  /** "HH:MM" 24h, in `tz`. */
  start: string;
  /** "HH:MM" 24h, in `tz`. */
  end: string;
  /** IANA tz, e.g. "America/Sao_Paulo". */
  tz: string;
}

export type GateDecision = { allowed: boolean; reason: string | null };

function parseHHMM(v: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Local wall-clock (weekday 1-7, minutes-of-day) of `now` in `tz`, fail-safe. */
function localParts(now: Date, tz: string): { isoDow: number; minutes: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hh = parts.find((p) => p.type === "hour")?.value ?? "";
    const mm = parts.find((p) => p.type === "minute")?.value ?? "";
    const dowMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    const isoDow = dowMap[wd];
    const minutes = Number(hh) * 60 + Number(mm);
    if (!isoDow || Number.isNaN(minutes)) return null;
    return { isoDow, minutes };
  } catch {
    return null;
  }
}

/**
 * Business-hours gate, fail-CLOSED: a missing/malformed window or any error
 * blocks the proactive send (never initiate outside the org's commercial window).
 */
export function decideBusinessHoursGate(
  input: { window: BusinessHoursWindow | null | undefined; now: Date },
): GateDecision {
  const w = input.window;
  if (!w || !Array.isArray(w.days) || w.days.length === 0 || typeof w.tz !== "string") {
    return { allowed: false, reason: "no_business_hours_window" };
  }
  const startMin = parseHHMM(w.start);
  const endMin = parseHHMM(w.end);
  if (startMin == null || endMin == null || startMin >= endMin) {
    return { allowed: false, reason: "outside_business_hours" };
  }
  const local = localParts(input.now, w.tz);
  if (!local) return { allowed: false, reason: "outside_business_hours" };
  const dayOk = w.days.includes(local.isoDow);
  const timeOk = local.minutes >= startMin && local.minutes < endMin;
  return dayOk && timeOk
    ? { allowed: true, reason: null }
    : { allowed: false, reason: "outside_business_hours" };
}
