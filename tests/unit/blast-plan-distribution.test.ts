// @vitest-environment node
/**
 * blast-plan-distribution — integration glue (ADR-0015, #901).
 *
 * Turns planBlast's per-day-per-number COUNTS into a concrete per-recipient
 * (lot_index, instance_id) assignment, and resolves the optional send window from
 * an untrusted payload. Plus resolveInstanceCap's fail-closed cap math. All pure.
 */
import { describe, it, expect } from "vitest";

const { planBlast } = await import(
  "../../supabase/functions/_shared/quick-blast/blast-planner.ts"
);
const { assignRecipientsToNumbers, resolveBlastWindow, DEFAULT_BLAST_WINDOW } = await import(
  "../../supabase/functions/_shared/quick-blast/blast-plan-distribution.ts"
);
const { resolveInstanceCap, DEFAULT_INSTANCE_CAP } = await import(
  "../../supabase/functions/_shared/quick-blast/instance-budget.ts"
);

const lead = (id: string) => ({ id, name: `L${id}`, company: "Co", phone: `11999${id}` });
const leads = (n: number) => Array.from({ length: n }, (_, i) => lead(String(i)));

describe("assignRecipientsToNumbers", () => {
  it("stamps every lead with its (lot_index, instance_id), counts matching planBlast", () => {
    const audience = leads(240);
    const plan = planBlast({
      totalRecipients: 240,
      numbers: [
        { id: "a", cap: 80 },
        { id: "b", cap: 80 },
      ],
      startDateIso: "2026-06-25",
    });
    const out = assignRecipientsToNumbers(audience, plan);

    // Every lead assigned exactly once, in order, no leftovers.
    expect(out).toHaveLength(240);
    expect(out.map((a) => a.lead.id)).toEqual(audience.map((l) => l.id));

    // Per (lot, instance) counts mirror planBlast: day0 160 (80+80), day1 80 (40+40).
    const countOf = (lot: number, inst: string) =>
      out.filter((a) => a.lotIndex === lot && a.instanceId === inst).length;
    expect(countOf(0, "a")).toBe(80);
    expect(countOf(0, "b")).toBe(80);
    expect(countOf(1, "a")).toBe(40);
    expect(countOf(1, "b")).toBe(40);
  });

  it("respects an uneven cap split (b capped, a absorbs the rest)", () => {
    const audience = leads(60);
    const plan = planBlast({
      totalRecipients: 60,
      numbers: [
        { id: "a", cap: 80 },
        { id: "b", cap: 20 },
      ],
      startDateIso: "2026-06-25",
    });
    const out = assignRecipientsToNumbers(audience, plan);
    expect(out.filter((a) => a.instanceId === "b")).toHaveLength(20);
    expect(out.filter((a) => a.instanceId === "a")).toHaveLength(40);
    expect(out.every((a) => a.lotIndex === 0)).toBe(true);
  });

  it("returns no assignments for an empty plan (no usable numbers)", () => {
    const plan = planBlast({ totalRecipients: 100, numbers: [], startDateIso: "2026-06-25" });
    expect(assignRecipientsToNumbers(leads(100), plan)).toEqual([]);
  });
});

describe("resolveBlastWindow", () => {
  it("defaults to Mon–Sat 08–20 when nothing is passed", () => {
    expect(resolveBlastWindow()).toEqual(DEFAULT_BLAST_WINDOW);
    expect(resolveBlastWindow(null)).toEqual(DEFAULT_BLAST_WINDOW);
  });

  it("accepts a valid custom window", () => {
    const w = resolveBlastWindow({ days: [1, 2, 3], fromMinutes: 9 * 60, toMinutes: 18 * 60 });
    expect(w).toEqual({ days: [1, 2, 3], fromMinutes: 540, toMinutes: 1080 });
  });

  it("filters out-of-range weekdays and falls back to Mon–Sat when none remain", () => {
    expect(resolveBlastWindow({ days: [7, -1, 99] }).days).toEqual(DEFAULT_BLAST_WINDOW.days);
    expect(resolveBlastWindow({ days: [0, 6] }).days).toEqual([0, 6]);
  });

  it("collapses an inverted/zero range to the default times", () => {
    const w = resolveBlastWindow({ days: [1], fromMinutes: 1200, toMinutes: 480 });
    expect(w.fromMinutes).toBe(DEFAULT_BLAST_WINDOW.fromMinutes);
    expect(w.toMinutes).toBe(DEFAULT_BLAST_WINDOW.toMinutes);
  });
});

describe("resolveInstanceCap — fail-closed", () => {
  it("returns the configured positive integer", () => {
    expect(resolveInstanceCap(120)).toBe(120);
    expect(resolveInstanceCap(20.9)).toBe(20);
  });
  it("falls back to the default for missing/invalid values (never unlimited)", () => {
    for (const bad of [null, undefined, 0, -5, NaN, Infinity]) {
      expect(resolveInstanceCap(bad as any)).toBe(DEFAULT_INSTANCE_CAP);
    }
  });
});
