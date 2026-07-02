/**
 * blast-planning twin parity (#904).
 *
 * Pins the frontend twin (`src/modules/campaigns/lib/blast-planning.ts`) to the
 * canonical Deno core. Vectors mirror `blast-planner.test.ts` and
 * `quiet-hours.test.ts`; cross-checked head-to-head against the Deno source so
 * the two implementations can never silently diverge.
 */
import { describe, it, expect } from "vitest";
import {
  planBlast,
  nextValidSendTime,
  addDaysIso,
  DEFAULT_QUIET_WINDOW,
  type QuietWindow,
} from "@/modules/campaigns/lib/blast-planning";
// Canonical Deno source — imported in the node-style way the existing
// quick-blast tests use, to assert byte-for-byte output parity.
const canonical = await import(
  "../../supabase/functions/_shared/quick-blast/blast-planner.ts"
);
const canonicalQuiet = await import(
  "../../supabase/functions/_shared/quick-blast/quiet-hours.ts"
);

describe("planBlast — single-day audience", () => {
  it("emits one lot, isPlan=false, when recipients fit the combined capacity", () => {
    const result = planBlast({
      totalRecipients: 100,
      numbers: [
        { id: "a", cap: 80 },
        { id: "b", cap: 80 },
      ],
      startDateIso: "2026-06-25",
    });
    expect(result.isPlan).toBe(false);
    expect(result.dayCount).toBe(1);
    expect(result.dailyCapacity).toBe(160);
    expect(result.lots).toHaveLength(1);
    expect(result.lots[0].dateIso).toBe("2026-06-25");
    expect(result.lots[0].dayTotal).toBe(100);
  });
});

describe("planBlast — multi-day audience", () => {
  it("slices an oversized audience into consecutive daily lots", () => {
    const result = planBlast({
      totalRecipients: 500,
      numbers: [{ id: "a", cap: 100 }],
      startDateIso: "2026-06-25",
    });
    expect(result.isPlan).toBe(true);
    expect(result.dayCount).toBe(5);
    expect(result.lots.map((l) => l.dateIso)).toEqual([
      "2026-06-25",
      "2026-06-26",
      "2026-06-27",
      "2026-06-28",
      "2026-06-29",
    ]);
    expect(result.lots.every((l) => l.dayTotal === 100)).toBe(true);
  });

  it("distributes a day round-robin across numbers, never exceeding a cap", () => {
    const result = planBlast({
      totalRecipients: 150,
      numbers: [
        { id: "a", cap: 50 },
        { id: "b", cap: 50 },
      ],
      startDateIso: "2026-06-25",
    });
    // 150 over 100/day → 2 lots (100 + 50).
    expect(result.dayCount).toBe(2);
    for (const lot of result.lots) {
      for (const share of lot.perNumber) {
        expect(share.count).toBeLessThanOrEqual(50);
      }
    }
  });
});

describe("planBlast — fail-closed", () => {
  it("collapses to an empty plan with no numbers", () => {
    const result = planBlast({
      totalRecipients: 100,
      numbers: [],
      startDateIso: "2026-06-25",
    });
    expect(result.dayCount).toBe(0);
    expect(result.dailyCapacity).toBe(0);
    expect(result.lots).toHaveLength(0);
    expect(result.isPlan).toBe(false);
  });
});

describe("addDaysIso", () => {
  it("adds calendar days without timezone drift, crossing month boundaries", () => {
    expect(addDaysIso("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2026-06-25", 0)).toBe("2026-06-25");
  });
});

describe("nextValidSendTime", () => {
  it("returns the candidate untouched when already inside the window", () => {
    expect(
      nextValidSendTime(DEFAULT_QUIET_WINDOW, "2026-06-25T10:00"),
    ).toBe("2026-06-25T10:00");
  });

  it("pushes a before-open candidate to the window open same day", () => {
    expect(
      nextValidSendTime(DEFAULT_QUIET_WINDOW, "2026-06-25T06:30"),
    ).toBe("2026-06-25T08:00");
  });

  it("pushes an after-close candidate to next valid day's open", () => {
    // 2026-06-25 is a Thursday; after close rolls to Friday 08:00.
    expect(
      nextValidSendTime(DEFAULT_QUIET_WINDOW, "2026-06-25T21:00"),
    ).toBe("2026-06-26T08:00");
  });

  it("skips disallowed weekdays (Sunday) to the next allowed day", () => {
    // 2026-06-28 is a Sunday (excluded) → Monday 2026-06-29 08:00.
    expect(
      nextValidSendTime(DEFAULT_QUIET_WINDOW, "2026-06-28T10:00"),
    ).toBe("2026-06-29T08:00");
  });
});

describe("twin parity with the canonical Deno core", () => {
  const cases = [
    { totalRecipients: 0, numbers: [{ id: "a", cap: 50 }], startDateIso: "2026-06-25" },
    { totalRecipients: 100, numbers: [{ id: "a", cap: 80 }, { id: "b", cap: 80 }], startDateIso: "2026-06-25" },
    { totalRecipients: 500, numbers: [{ id: "a", cap: 100 }], startDateIso: "2026-06-25" },
    { totalRecipients: 333, numbers: [{ id: "a", cap: 40 }, { id: "b", cap: 60 }], startDateIso: "2026-02-27" },
  ];
  it("planBlast matches the Deno source across vectors", () => {
    for (const input of cases) {
      expect(planBlast(input)).toEqual(canonical.planBlast(input));
    }
  });

  it("nextValidSendTime matches the Deno source across vectors", () => {
    const win: QuietWindow = DEFAULT_QUIET_WINDOW;
    const candidates = [
      "2026-06-25T10:00",
      "2026-06-25T06:30",
      "2026-06-25T21:00",
      "2026-06-28T10:00",
      "2026-06-27T19:59",
    ];
    for (const c of candidates) {
      expect(nextValidSendTime(win, c)).toBe(
        canonicalQuiet.nextValidSendTime(win, c),
      );
    }
  });
});
