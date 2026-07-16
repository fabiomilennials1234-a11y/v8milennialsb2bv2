// @vitest-environment node
/**
 * runQuickBlast — Per-number Daily Cap (ADR-0015, anti-ban Onda 0 QW1).
 *
 * Extends the ADR-0003 org-wide budget with the SAME per-number ledger the
 * Blast Plan paths consume (blast_instance_daily_usage): the effective cap is
 * the tightest of (per-blast, org daily, number daily). Same dep-injection +
 * Supabase-stub style as quick-blast-run-daily-budget.test.ts, plus the
 * injected `instanceUsageSource` seam.
 *
 * Asserts the full wire: cap resolution → headroom → trim → dual-ledger
 * increment; fail-closed on ledger read error; seam-absent legacy semantics.
 */

import { describe, it, expect, vi } from "vitest";

const { runQuickBlast } = await import(
  "../../supabase/functions/quick-blast-create/run.ts"
);

const INSTANCE = {
  id: "inst-1",
  organization_id: "org-1",
  provider: "uazapi",
  daily_blast_cap: 80,
} as any;

function supabaseStub(opts: { dailyBudget?: number | null; leads: any[] }) {
  const queryReturning = (rows: any[]) => {
    const q: any = {};
    q.select = () => q;
    q.eq = () => q;
    q.in = () => q;
    q.then = (resolve: (v: any) => void) => resolve({ data: rows, error: null });
    return q;
  };
  return {
    from(table: string) {
      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  quick_blast_max_leads: null,
                  daily_blast_budget: opts.dailyBudget ?? null,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "leads") return queryReturning(opts.leads);
      if (table === "upsell_clients") return queryReturning([]);
      if (table === "channel_messages") {
        return { insert: async () => ({ error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as any;
}

const lead = (id: string, phone: string | null) => ({ id, name: `L${id}`, company: "Co", phone });
const leads = (n: number) =>
  Array.from({ length: n }, (_, i) => lead(String(i), `11999${String(i).padStart(6, "0")}`));

/** Org-wide #706 ledger seam. */
function orgUsageStub(initialUsed = 0) {
  const state = { used: initialUsed, increments: [] as number[] };
  return {
    state,
    source: {
      async getUsedToday() { return state.used; },
      async increment(_org: string, _date: string, count: number) {
        state.used += count;
        state.increments.push(count);
      },
    },
  };
}

/** Per-number ADR-0015 ledger seam. */
function instanceUsageStub(initialUsed = 0) {
  const state = { used: initialUsed, increments: [] as Array<{ instanceId: string; count: number }> };
  return {
    state,
    source: {
      async getUsedToday(_instanceId: string, _date: string, _cap: number) { return state.used; },
      async increment(instanceId: string, _date: string, count: number) {
        state.used += count;
        state.increments.push({ instanceId, count });
      },
    },
  };
}

const okDispatch = () =>
  vi.fn(async () => ({ sender_job_id: "j", uazapi_sender_id: "u" }));

describe("runQuickBlast — per-number daily cap (ADR-0015)", () => {
  it("clamps the blast to the number's remaining headroom when it is the tightest limit", async () => {
    const dispatch = okDispatch();
    const org = orgUsageStub(0); // org budget 200, untouched
    const inst = instanceUsageStub(70); // number cap 80 → 10 remaining

    const out = await runQuickBlast(
      { supabaseAdmin: supabaseStub({ dailyBudget: 200, leads: leads(50) }), dispatch, usageSource: org.source, instanceUsageSource: inst.source },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: leads(50).map((l) => l.id), message: "Hi" },
    );

    expect(out.ok).toBe(true);
    expect(out.count).toBe(10);
    expect(out.skipped.overInstanceCap).toBe(40); // labelled on the binding constraint
    expect(out.skipped.overDailyBudget).toBe(0);
    expect(out.skipped.overCap).toBe(0);
    // `remaining` reflects the TIGHTEST headroom (number, not org) so the
    // wizard's over-budget math and the "Agendar em lotes" offer engage.
    expect(out.remaining).toBe(10);
    expect((dispatch.mock.calls[0][1] as any).recipients).toHaveLength(10);
  });

  it("checks and consumes the SEND day's ledger partition for scheduled blasts", async () => {
    const dates: string[] = [];
    const src = {
      async getUsedToday(_i: string, d: string, _c: number) { dates.push(`read:${d}`); return 0; },
      async increment(_i: string, d: string, c: number) { dates.push(`inc:${d}:${c}`); },
    };

    const out = await runQuickBlast(
      { supabaseAdmin: supabaseStub({ dailyBudget: 200, leads: leads(5) }), dispatch: okDispatch(), usageSource: orgUsageStub(0).source, instanceUsageSource: src },
      {
        orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: leads(5).map((l) => l.id),
        message: "Hi",
        scheduledFor: "2026-07-20T12:00:00Z", // leaves the chip on the 20th
        now: new Date("2026-07-16T12:00:00Z"),
      },
    );

    expect(out.ok).toBe(true);
    // Both the read and the increment hit the SEND day's partition, not today.
    expect(dates).toEqual(["read:2026-07-20", "inc:2026-07-20:5"]);
  });

  it("increments BOTH ledgers by the actually-dispatched count", async () => {
    const org = orgUsageStub(0);
    const inst = instanceUsageStub(0);

    const out = await runQuickBlast(
      { supabaseAdmin: supabaseStub({ dailyBudget: 200, leads: leads(5) }), dispatch: okDispatch(), usageSource: org.source, instanceUsageSource: inst.source },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: leads(5).map((l) => l.id), message: "Hi" },
    );

    expect(out.count).toBe(5);
    expect(org.state.increments).toEqual([5]);
    expect(inst.state.increments).toEqual([{ instanceId: "inst-1", count: 5 }]);
  });

  it("rejects with instance_daily_cap_exhausted when the number is at its cap, without dispatching", async () => {
    const dispatch = okDispatch();
    const inst = instanceUsageStub(80); // cap 80 fully consumed

    const out = await runQuickBlast(
      { supabaseAdmin: supabaseStub({ dailyBudget: 200, leads: leads(10) }), dispatch, usageSource: orgUsageStub(0).source, instanceUsageSource: inst.source },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: leads(10).map((l) => l.id), message: "Hi" },
    );

    expect(out.ok).toBe(false);
    expect(out.error).toBe("instance_daily_cap_exhausted");
    expect(dispatch).not.toHaveBeenCalled();
    expect(inst.state.increments).toHaveLength(0);
  });

  it("fails closed when the per-number ledger read errors (source returns the cap)", async () => {
    const dispatch = okDispatch();
    // Mirrors instanceDailyUsageSource's contract: read failure → used = cap.
    const failClosed = {
      async getUsedToday(_i: string, _d: string, cap: number) { return cap; },
      async increment() { /* not reached */ },
    };

    const out = await runQuickBlast(
      { supabaseAdmin: supabaseStub({ dailyBudget: 200, leads: leads(10) }), dispatch, usageSource: orgUsageStub(0).source, instanceUsageSource: failClosed },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: leads(10).map((l) => l.id), message: "Hi" },
    );

    expect(out.ok).toBe(false);
    expect(out.error).toBe("instance_daily_cap_exhausted");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("falls back to DEFAULT_INSTANCE_CAP (80) when daily_blast_cap is missing — never unlimited", async () => {
    const inst = instanceUsageStub(0);
    const noCapInstance = { ...INSTANCE, daily_blast_cap: null };

    const out = await runQuickBlast(
      { supabaseAdmin: supabaseStub({ dailyBudget: 500, leads: leads(120) }), dispatch: okDispatch(), usageSource: orgUsageStub(0).source, instanceUsageSource: inst.source },
      { orgId: "org-1", userId: "u", instance: noCapInstance, leadIds: leads(120).map((l) => l.id), message: "Hi" },
    );

    expect(out.count).toBe(80); // clamped to the fail-closed default cap
    expect(out.skipped.overInstanceCap).toBe(40);
  });

  it("dry-run reports the number clamp WITHOUT consuming either ledger", async () => {
    const dispatch = okDispatch();
    const org = orgUsageStub(0);
    const inst = instanceUsageStub(75); // 5 remaining on the number

    const out = await runQuickBlast(
      { supabaseAdmin: supabaseStub({ dailyBudget: 200, leads: leads(20) }), dispatch, usageSource: org.source, instanceUsageSource: inst.source },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: leads(20).map((l) => l.id), message: "Hi", dryRun: true },
    );

    expect(out.ok).toBe(true);
    expect(out.count).toBe(5);
    expect(out.skipped.overInstanceCap).toBe(15);
    expect(dispatch).not.toHaveBeenCalled();
    expect(org.state.increments).toHaveLength(0);
    expect(inst.state.increments).toHaveLength(0);
  });

  it("keeps org-budget-only semantics when the seam is absent (legacy callers/tests)", async () => {
    const out = await runQuickBlast(
      { supabaseAdmin: supabaseStub({ dailyBudget: 200, leads: leads(150) }), dispatch: okDispatch(), usageSource: orgUsageStub(0).source },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: leads(150).map((l) => l.id), message: "Hi" },
    );

    // No per-number bound: 150 ≤ org budget 200 → everything goes.
    expect(out.count).toBe(150);
    expect(out.skipped.overInstanceCap).toBe(0);
  });

  it("keeps the org-daily label when the org budget is tighter than the number cap", async () => {
    const inst = instanceUsageStub(0); // number headroom 80
    const org = orgUsageStub(170); // org budget 200 → 30 remaining (tighter)

    const out = await runQuickBlast(
      { supabaseAdmin: supabaseStub({ dailyBudget: 200, leads: leads(60) }), dispatch: okDispatch(), usageSource: org.source, instanceUsageSource: inst.source },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: leads(60).map((l) => l.id), message: "Hi" },
    );

    expect(out.count).toBe(30);
    expect(out.skipped.overDailyBudget).toBe(30);
    expect(out.skipped.overInstanceCap).toBe(0);
  });
});
