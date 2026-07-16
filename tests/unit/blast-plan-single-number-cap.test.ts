// @vitest-environment node
/**
 * Blast Plan SINGLE-number paths — Per-number Daily Cap (ADR-0015, anti-ban
 * Onda 0 QW1).
 *
 * The multi-number branch already bounded each number by its own ledger; this
 * covers the extension of the SAME bound to the legacy single-number create
 * branch and the single-number release branch: lot dispatch is clamped by
 * min(org remaining, number headroom), the per-number ledger increments after
 * a real dispatch, and seam-absent (legacy) semantics stay org-budget-only.
 *
 * Same dep-injection + in-memory store style as blast-plan-multinumber.test.ts.
 */
import { describe, it, expect, vi } from "vitest";

const { createBlastPlan, releaseBlastPlanLot } = await import(
  "../../supabase/functions/_shared/quick-blast/blast-plan.ts"
);

const NUM = { id: "num-1", organization_id: "org-1", provider: "uazapi", daily_blast_cap: 80 } as any;

const lead = (id: string) => ({ id, name: `L${id}`, company: "Co", phone: `1199900${id.padStart(4, "0")}` });
const leads = (n: number) => Array.from({ length: n }, (_, i) => lead(String(i)));

function planStore() {
  const state = { plans: new Map<string, any>(), recipients: [] as any[], seq: 0 };
  return {
    state,
    store: {
      async insertPlan(row: any) {
        const id = `plan-${++state.seq}`;
        state.plans.set(id, { id, ...row });
        return id;
      },
      async insertRecipients(rows: any[]) {
        for (const r of rows) state.recipients.push({ ...r });
      },
      async getPlan(planId: string) {
        return state.plans.get(planId) ?? null;
      },
      async updatePlan(planId: string, patch: any) {
        const p = state.plans.get(planId);
        if (p) state.plans.set(planId, { ...p, ...patch });
      },
      async getLotRecipients(planId: string, lotIndex: number) {
        return state.recipients.filter((r) => r.plan_id === planId && r.lot_index === lotIndex);
      },
      async markRecipients(planId: string, leadIds: string[], status: string, reason: string | null) {
        const set = new Set(leadIds);
        for (const r of state.recipients) {
          if (r.plan_id === planId && set.has(r.lead_id)) {
            r.status = status;
            r.reason = reason;
          }
        }
      },
      async moveRecipientsToLot(planId: string, leadIds: string[], lotIndex: number) {
        const set = new Set(leadIds);
        for (const r of state.recipients) {
          if (r.plan_id === planId && set.has(r.lead_id)) r.lot_index = lotIndex;
        }
      },
      async listActivePlansDue(today: string) {
        return [...state.plans.values()].filter((p) => p.status === "active" && p.next_release_date <= today);
      },
    },
  };
}

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
  vi.fn(async (_inst: any, input: any) => ({
    sender_job_id: "j",
    uazapi_sender_id: "u",
    _n: input.recipients.length,
  }));

describe("createBlastPlan — single-number, per-number cap on lot 0", () => {
  it("bounds lot 0 by the number's headroom when tighter than the org budget", async () => {
    const dispatch = okDispatch();
    const { store, state } = planStore();
    const org = orgUsageStub(0); // budget 100 → remaining 100
    const inst = instanceUsageStub(70); // cap 80 → headroom 10

    const out = await createBlastPlan(
      { store, usageSource: org.source, dispatch, instanceUsageSource: inst.source },
      { orgId: "org-1", userId: "u", instance: NUM, leads: leads(40), message: "Hi", dailyBudget: 100 },
    );

    expect(out.ok).toBe(true);
    // lot 0 held 40 (≤ budget) but only 10 fit the number today.
    expect((dispatch.mock.calls[0][1] as any).recipients).toHaveLength(10);
    const sent = state.recipients.filter((r) => r.status === "sent");
    expect(sent).toHaveLength(10);
    // remainder deferred to lot 1, still pending.
    const deferred = state.recipients.filter((r) => r.status === "pending" && r.lot_index === 1);
    expect(deferred.length).toBeGreaterThanOrEqual(30);
    // both ledgers incremented by the dispatched count.
    expect(org.state.increments).toEqual([10]);
    expect(inst.state.increments).toEqual([{ instanceId: "num-1", count: 10 }]);
  });

  it("keeps org-budget-only semantics when the seam is absent (legacy)", async () => {
    const dispatch = okDispatch();
    const { store } = planStore();
    const org = orgUsageStub(0);

    const out = await createBlastPlan(
      { store, usageSource: org.source, dispatch },
      { orgId: "org-1", userId: "u", instance: NUM, leads: leads(40), message: "Hi", dailyBudget: 100 },
    );

    expect(out.ok).toBe(true);
    expect((dispatch.mock.calls[0][1] as any).recipients).toHaveLength(40);
    expect(org.state.increments).toEqual([40]);
  });

  it("dispatches nothing today when the number is already at its cap — recipients stay in lot 0 and the next release drains them (no stranding)", async () => {
    const dispatch = okDispatch();
    const { store, state } = planStore();
    const org = orgUsageStub(0);
    const inst = instanceUsageStub(80); // cap 80 fully consumed

    const out = await createBlastPlan(
      { store, usageSource: org.source, dispatch, instanceUsageSource: inst.source },
      { orgId: "org-1", userId: "u", instance: NUM, leads: leads(10), message: "Hi", dailyBudget: 100 },
    );

    expect(out.ok).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    expect(state.recipients.every((r) => r.status === "pending")).toBe(true);
    // Nothing released → rows must STAY in lot 0 (the lot the releaser reads
    // next), and the plan stays active — not "completed with stranded rows".
    expect(state.recipients.every((r) => r.lot_index === 0)).toBe(true);
    const plan = [...state.plans.values()][0];
    expect(plan.status).toBe("active");
    expect(plan.lots_released).toBe(0);
    expect(inst.state.increments).toHaveLength(0);

    // Next day the number has headroom again → the release actually sends.
    inst.state.used = 0;
    const rel = await releaseBlastPlanLot(
      { store, usageSource: org.source, dispatch, instanceUsageSource: inst.source },
      { planId: plan.id, dailyBudget: 100 },
    );
    expect(rel.ok).toBe(true);
    expect(rel.sent).toBe(10);
    expect(rel.completed).toBe(true);
  });
});

describe("releaseBlastPlanLot — single-number, per-number cap", () => {
  async function seedPlan(opts: { audience: number; orgUsed?: number; instUsed?: number; withSeam?: boolean }) {
    const dispatch = okDispatch();
    const { store, state } = planStore();
    const org = orgUsageStub(opts.orgUsed ?? 0);
    const inst = instanceUsageStub(opts.instUsed ?? 0);
    const deps: any = { store, usageSource: org.source, dispatch };
    if (opts.withSeam !== false) deps.instanceUsageSource = inst.source;

    // Freeze a plan whose lot 0 already went out (org budget 100 covers it).
    await createBlastPlan(deps, {
      orgId: "org-1",
      userId: "u",
      instance: NUM,
      leads: leads(opts.audience),
      message: "Hi",
      dailyBudget: 100,
    });
    const planId = [...state.plans.keys()][0];
    return { deps, dispatch, state, org, inst, planId };
  }

  it("bounds the released lot by min(org remaining, number headroom) and increments both ledgers", async () => {
    const { deps, dispatch, org, inst, planId } = await seedPlan({ audience: 150 }); // lots: 100 + 50
    // Day 2: fresh org day (reset stubs), number already used 75 → headroom 5.
    org.state.used = 0;
    org.state.increments.length = 0;
    inst.state.used = 75;
    inst.state.increments.length = 0;
    dispatch.mockClear();

    const out = await releaseBlastPlanLot(deps, { planId, dailyBudget: 100 });

    expect(out.ok).toBe(true);
    expect(out.sent).toBe(5); // number headroom binds, not the org's 100
    // Creation already trimmed lot 0 to the number cap (80 of 100, 20 deferred)
    // → this lot held 50 + 20 = 70; 5 went out, 65 defer forward.
    expect(out.deferred).toBe(65);
    expect((dispatch.mock.calls[0][1] as any).recipients).toHaveLength(5);
    expect(org.state.increments).toEqual([5]);
    expect(inst.state.increments).toEqual([{ instanceId: "num-1", count: 5 }]);
  });

  it("keeps org-budget-only semantics on release when the seam is absent (legacy)", async () => {
    const { deps, dispatch, org, planId } = await seedPlan({ audience: 150, withSeam: false });
    org.state.used = 0;
    org.state.increments.length = 0;
    dispatch.mockClear();

    const out = await releaseBlastPlanLot(deps, { planId, dailyBudget: 100 });

    expect(out.ok).toBe(true);
    expect(out.sent).toBe(50); // the whole remaining lot fits the org budget
    expect(out.deferred).toBe(0);
    expect(org.state.increments).toEqual([50]);
  });
});
