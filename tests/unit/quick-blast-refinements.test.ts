// @vitest-environment node
/**
 * refineBlastAudience — Blast Audience refinements (Disparo F1, #704).
 *
 * Pure core: given candidate leads (+ phones), refinement options, and an
 * injected activity source (so no live DB), narrows the set and reports a skip
 * breakdown. Mirrors the dep-injection style of quick-blast-run.test.ts.
 *
 * "received a blast" = an outgoing channel_messages row for the lead within the
 * window. "replied" / non-responder = a lead whose most recent outgoing send
 * has zero inbound after it. These map to lastOutgoingAt / lastIncomingAt on
 * the injected LeadActivity.
 */

import { describe, it, expect } from "vitest";

const { refineBlastAudience } = await import(
  "../../supabase/functions/_shared/quick-blast/refinements.ts"
);

type Activity = { lastOutgoingAt: string | null; lastIncomingAt: string | null };

/** Builds an injected source from a per-lead activity map. */
function source(map: Record<string, Activity>) {
  return {
    async getLeadActivity(_orgId: string, leadIds: string[]) {
      const out = new Map<string, { lastOutgoingAt: Date | null; lastIncomingAt: Date | null }>();
      for (const id of leadIds) {
        const a = map[id];
        out.set(id, {
          lastOutgoingAt: a?.lastOutgoingAt ? new Date(a.lastOutgoingAt) : null,
          lastIncomingAt: a?.lastIncomingAt ? new Date(a.lastIncomingAt) : null,
        });
      }
      return out;
    },
  };
}

const NOW = new Date("2026-06-05T12:00:00.000Z");
const cand = (leadId: string, phone: string | null = "11999990000") => ({ leadId, phone });

describe("refineBlastAudience — defaults / no refinements", () => {
  it("keeps every candidate when no refinement option is set", async () => {
    const out = await refineBlastAudience({
      orgId: "org-1",
      candidates: [cand("a"), cand("b")],
      options: {},
      source: source({}),
      now: NOW,
    });
    expect(out.keptLeadIds).toEqual(["a", "b"]);
    expect(out.skipped).toEqual({ alreadyContactedWithinWindow: 0, replied: 0, noPhone: 0 });
  });

  it("returns empty kept + zeroed skips for an empty candidate set", async () => {
    const out = await refineBlastAudience({
      orgId: "org-1",
      candidates: [],
      options: { onlyNonResponders: true, excludeBlastedWithinDays: 7, excludeNoPhone: true },
      source: source({}),
      now: NOW,
    });
    expect(out.keptLeadIds).toEqual([]);
    expect(out.skipped).toEqual({ alreadyContactedWithinWindow: 0, replied: 0, noPhone: 0 });
  });
});

describe("refineBlastAudience — contact recency", () => {
  it("excludes a lead blasted within the window (default 7 days)", async () => {
    // a: blasted 2 days ago → excluded. b: blasted 20 days ago → kept.
    const out = await refineBlastAudience({
      orgId: "org-1",
      candidates: [cand("a"), cand("b")],
      options: { excludeBlastedWithinDays: 7 },
      source: source({
        a: { lastOutgoingAt: "2026-06-03T12:00:00.000Z", lastIncomingAt: null },
        b: { lastOutgoingAt: "2026-05-16T12:00:00.000Z", lastIncomingAt: null },
      }),
      now: NOW,
    });
    expect(out.keptLeadIds).toEqual(["b"]);
    expect(out.skipped.alreadyContactedWithinWindow).toBe(1);
  });

  it("re-includes a lead once its last blast falls outside the window", async () => {
    // Same lead, last blast exactly 8 days ago with a 7-day window → kept.
    const out = await refineBlastAudience({
      orgId: "org-1",
      candidates: [cand("a")],
      options: { excludeBlastedWithinDays: 7 },
      source: source({
        a: { lastOutgoingAt: "2026-05-28T12:00:00.000Z", lastIncomingAt: null },
      }),
      now: NOW,
    });
    expect(out.keptLeadIds).toEqual(["a"]);
    expect(out.skipped.alreadyContactedWithinWindow).toBe(0);
  });

  it("keeps a never-contacted lead (no outgoing history)", async () => {
    const out = await refineBlastAudience({
      orgId: "org-1",
      candidates: [cand("a")],
      options: { excludeBlastedWithinDays: 7 },
      source: source({ a: { lastOutgoingAt: null, lastIncomingAt: null } }),
      now: NOW,
    });
    expect(out.keptLeadIds).toEqual(["a"]);
    expect(out.skipped.alreadyContactedWithinWindow).toBe(0);
  });
});

describe("refineBlastAudience — non-responder (reply status)", () => {
  it("keeps only leads with zero inbound after their most recent blast send", async () => {
    // a: replied AFTER last send → excluded.
    // b: last inbound is BEFORE last send (silent since) → kept.
    // c: sent, never any inbound → kept.
    const out = await refineBlastAudience({
      orgId: "org-1",
      candidates: [cand("a"), cand("b"), cand("c")],
      options: { onlyNonResponders: true },
      source: source({
        a: { lastOutgoingAt: "2026-06-01T10:00:00.000Z", lastIncomingAt: "2026-06-01T11:00:00.000Z" },
        b: { lastOutgoingAt: "2026-06-01T10:00:00.000Z", lastIncomingAt: "2026-05-30T09:00:00.000Z" },
        c: { lastOutgoingAt: "2026-06-01T10:00:00.000Z", lastIncomingAt: null },
      }),
      now: NOW,
    });
    expect(out.keptLeadIds).toEqual(["b", "c"]);
    expect(out.skipped.replied).toBe(1);
  });

  it("does not treat a never-blasted lead as a non-responder (no send to be silent against)", async () => {
    // Lead with no outgoing history has never been blasted — keep it; it is a
    // fresh contact, not a 'non-responder' to a prior blast.
    const out = await refineBlastAudience({
      orgId: "org-1",
      candidates: [cand("a")],
      options: { onlyNonResponders: true },
      source: source({ a: { lastOutgoingAt: null, lastIncomingAt: "2026-06-01T11:00:00.000Z" } }),
      now: NOW,
    });
    expect(out.keptLeadIds).toEqual(["a"]);
    expect(out.skipped.replied).toBe(0);
  });
});

describe("refineBlastAudience — no phone", () => {
  it("lands phone-less candidates in the skip breakdown when excludeNoPhone is set", async () => {
    const out = await refineBlastAudience({
      orgId: "org-1",
      candidates: [cand("a", "11999990001"), cand("b", null), cand("c", "  ")],
      options: { excludeNoPhone: true },
      source: source({}),
      now: NOW,
    });
    expect(out.keptLeadIds).toEqual(["a"]);
    expect(out.skipped.noPhone).toBe(2);
  });

  it("does not count phone-less candidates when excludeNoPhone is off (engine handles them later)", async () => {
    const out = await refineBlastAudience({
      orgId: "org-1",
      candidates: [cand("a", null)],
      options: {},
      source: source({}),
      now: NOW,
    });
    expect(out.keptLeadIds).toEqual(["a"]);
    expect(out.skipped.noPhone).toBe(0);
  });
});

describe("refineBlastAudience — composition + determinism", () => {
  it("composes all three refinements, counting each lead once by precedence", async () => {
    // a: no phone        → noPhone
    // b: blasted 1d ago  → alreadyContactedWithinWindow
    // c: replied         → replied
    // d: silent + old    → kept
    const out = await refineBlastAudience({
      orgId: "org-1",
      candidates: [cand("a", null), cand("b"), cand("c"), cand("d")],
      options: { excludeNoPhone: true, excludeBlastedWithinDays: 7, onlyNonResponders: true },
      source: source({
        b: { lastOutgoingAt: "2026-06-04T12:00:00.000Z", lastIncomingAt: null },
        c: { lastOutgoingAt: "2026-05-01T10:00:00.000Z", lastIncomingAt: "2026-05-01T11:00:00.000Z" },
        d: { lastOutgoingAt: "2026-05-01T10:00:00.000Z", lastIncomingAt: null },
      }),
      now: NOW,
    });
    expect(out.keptLeadIds).toEqual(["d"]);
    expect(out.skipped).toEqual({ noPhone: 1, alreadyContactedWithinWindow: 1, replied: 1 });
  });

  it("counts recency before reply status (a recently-blasted non-responder is a recency skip)", async () => {
    const out = await refineBlastAudience({
      orgId: "org-1",
      candidates: [cand("a")],
      options: { excludeBlastedWithinDays: 7, onlyNonResponders: true },
      source: source({
        a: { lastOutgoingAt: "2026-06-04T12:00:00.000Z", lastIncomingAt: "2026-06-04T13:00:00.000Z" },
      }),
      now: NOW,
    });
    expect(out.keptLeadIds).toEqual([]);
    expect(out.skipped.alreadyContactedWithinWindow).toBe(1);
    expect(out.skipped.replied).toBe(0);
  });

  it("preserves input order of kept leads", async () => {
    const out = await refineBlastAudience({
      orgId: "org-1",
      candidates: [cand("z"), cand("m"), cand("a")],
      options: {},
      source: source({}),
      now: NOW,
    });
    expect(out.keptLeadIds).toEqual(["z", "m", "a"]);
  });

  it("skips the activity source query entirely when no activity-based refinement is requested", async () => {
    let called = false;
    const spySource = {
      async getLeadActivity(_orgId: string, leadIds: string[]) {
        called = true;
        return new Map(leadIds.map((id) => [id, { lastOutgoingAt: null, lastIncomingAt: null }]));
      },
    };
    const out = await refineBlastAudience({
      orgId: "org-1",
      candidates: [cand("a", null), cand("b")],
      options: { excludeNoPhone: true },
      source: spySource,
      now: NOW,
    });
    expect(called).toBe(false);
    expect(out.keptLeadIds).toEqual(["b"]);
  });
});
