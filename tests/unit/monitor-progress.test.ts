/**
 * monitor-progress — pure progress snapshot for the Acompanhar step (#910).
 *
 * Given a Blast Plan and how many recipients have been sent so far, derive what
 * the monitor shows: which daily lot is in flight, how many remain queued, and
 * the overall percentage. Pure so the UI (and later the live subscription) just
 * renders it. Fail-closed on an empty plan.
 */
import { describe, it, expect } from "vitest";
import { monitorSnapshot } from "@/modules/campaigns/components/disparo-wizard/monitor-progress";
import { planBlast } from "@/modules/campaigns/lib/blast-planning";

// 240 recipients, 2 numbers × 80 → 160/day → 2 lots (160 + 80)
const plan = planBlast({
  totalRecipients: 240,
  numbers: [
    { id: "a", cap: 80 },
    { id: "b", cap: 80 },
  ],
  startDateIso: "2026-06-25",
});

describe("monitorSnapshot", () => {
  it("reports nothing sent at the start", () => {
    const s = monitorSnapshot(plan, 0);
    expect(s.batchTotal).toBe(2);
    expect(s.batchCurrent).toBe(1);
    expect(s.sent).toBe(0);
    expect(s.queued).toBe(240);
    expect(s.pct).toBe(0);
  });

  it("places the in-flight batch by how many are sent", () => {
    const s = monitorSnapshot(plan, 160); // first lot done
    expect(s.batchCurrent).toBe(2);
    expect(s.queued).toBe(80);
    expect(s.pct).toBe(67); // round(160/240*100)
  });

  it("caps at completion", () => {
    const s = monitorSnapshot(plan, 240);
    expect(s.batchCurrent).toBe(2);
    expect(s.queued).toBe(0);
    expect(s.pct).toBe(100);
  });

  it("clamps over-sent and never exceeds the total", () => {
    const s = monitorSnapshot(plan, 9999);
    expect(s.sent).toBe(240);
    expect(s.queued).toBe(0);
    expect(s.pct).toBe(100);
  });

  it("is fail-closed for an empty plan (no NaN)", () => {
    const empty = planBlast({
      totalRecipients: 0,
      numbers: [],
      startDateIso: "2026-06-25",
    });
    const s = monitorSnapshot(empty, 0);
    expect(s.batchTotal).toBe(0);
    expect(s.batchCurrent).toBe(0);
    expect(s.queued).toBe(0);
    expect(s.pct).toBe(0);
  });
});
