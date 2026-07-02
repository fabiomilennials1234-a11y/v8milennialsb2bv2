// @vitest-environment node
/**
 * Quiet hours — pure next-valid-send-time math for blasts (PRD #900, #909).
 *
 * A blast carries a per-leva allowed window (default 8h–20h, Mon–Sat). A send
 * (or daily lot release) that would land outside the window is pushed to the
 * next valid time. This module is the pure, clock-free decision: given the
 * window and a candidate org-local wall-clock time, return the next time inside
 * the window (the candidate itself if already valid).
 *
 * Times are org-local "YYYY-MM-DDTHH:mm" strings — timezone conversion is the
 * caller's concern, kept out of this pure core. Weekdays: 0=Sun … 6=Sat.
 */

import { describe, it, expect } from "vitest";

const { nextValidSendTime } = await import(
  "../../supabase/functions/_shared/quick-blast/quiet-hours.ts"
);

// Mon–Sat, 08:00–20:00
const WINDOW = {
  days: [1, 2, 3, 4, 5, 6],
  fromMinutes: 8 * 60,
  toMinutes: 20 * 60,
};

describe("nextValidSendTime — already inside the window", () => {
  it("returns the candidate unchanged on an allowed day within hours", () => {
    // 2026-06-25 is a Thursday (weekday 4)
    expect(nextValidSendTime(WINDOW, "2026-06-25T10:30")).toBe(
      "2026-06-25T10:30",
    );
  });

  it("accepts exactly the window open time (half-open [from, to))", () => {
    expect(nextValidSendTime(WINDOW, "2026-06-25T08:00")).toBe(
      "2026-06-25T08:00",
    );
  });
});

describe("nextValidSendTime — outside the window", () => {
  it("pushes a before-open time to the window open, same day", () => {
    expect(nextValidSendTime(WINDOW, "2026-06-25T07:00")).toBe(
      "2026-06-25T08:00",
    );
  });

  it("pushes an after-close time to the next allowed day's open", () => {
    // Thu 21:00 → Fri 08:00
    expect(nextValidSendTime(WINDOW, "2026-06-25T21:00")).toBe(
      "2026-06-26T08:00",
    );
  });

  it("treats exactly the close time as outside (half-open)", () => {
    // Thu 20:00 → Fri 08:00
    expect(nextValidSendTime(WINDOW, "2026-06-25T20:00")).toBe(
      "2026-06-26T08:00",
    );
  });

  it("skips an excluded weekday to the next allowed day", () => {
    // 2026-06-27 Sat 21:00 → Sun excluded → Mon 2026-06-29 08:00
    expect(nextValidSendTime(WINDOW, "2026-06-27T21:00")).toBe(
      "2026-06-29T08:00",
    );
  });

  it("degrades to the candidate when no days are allowed (misconfig)", () => {
    expect(
      nextValidSendTime({ days: [], fromMinutes: 480, toMinutes: 1200 }, "2026-06-28T03:00"),
    ).toBe("2026-06-28T03:00");
  });
});
