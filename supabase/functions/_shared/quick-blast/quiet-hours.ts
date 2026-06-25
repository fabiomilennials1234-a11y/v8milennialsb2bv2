/**
 * quiet-hours — pure next-valid-send-time math for blasts (PRD #900, #909).
 *
 * A blast carries a per-leva allowed window (default 8h–20h, Mon–Sat). A send or
 * daily-lot release that would land outside the window is pushed forward to the
 * next valid time. This module holds the deterministic, clock-free decision:
 * given the window and a candidate org-local wall-clock time, return the next
 * time inside the window (the candidate itself when already valid).
 *
 * Times are org-local "YYYY-MM-DDTHH:mm" strings; timezone conversion is the
 * caller's concern, deliberately kept out of this pure core. Weekdays follow
 * JS convention: 0=Sun … 6=Sat. The window is half-open [from, to): a send at
 * exactly `from` is valid, at exactly `to` is not.
 */

import { addDaysIso } from "./plan-slicing.ts";

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

export function nextValidSendTime(
  window: QuietWindow,
  candidateIso: string,
): string {
  const allowed = new Set(window.days);
  // No allowed day configured → no restriction (degrade to the candidate).
  if (allowed.size === 0) return candidateIso;

  let { y, m, d, minutes } = parse(candidateIso);

  // Scan forward at most a full week + 1 to land on the next valid slot.
  for (let i = 0; i < 8; i++) {
    if (allowed.has(weekdayOf(y, m, d))) {
      if (minutes < window.fromMinutes) {
        return format({ y, m, d, minutes: window.fromMinutes });
      }
      if (minutes < window.toMinutes) {
        return format({ y, m, d, minutes });
      }
      // after close → fall through to next day at open
    }
    const next = addDaysIso(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, 1);
    [y, m, d] = next.split("-").map((p) => parseInt(p, 10));
    minutes = window.fromMinutes;
  }

  // Unreachable with a non-empty day set; fail-safe to window open.
  return format({ y, m, d, minutes: window.fromMinutes });
}
