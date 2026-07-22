// @vitest-environment node
/**
 * Blast Plan release — WhatsApp reach-allowance gate (#1168).
 *
 * The releaser is a cron with nobody watching, releasing daily lots against the
 * same numbers day after day. It is the highest-volume path in the product, so
 * a number WhatsApp has already declared at its ceiling must not keep sending.
 *
 * The response here is to DEFER the lot, not to refuse it: the elastic-duration
 * design already moves budget-pressured rows to the next lot, and reusing that
 * path means an exhausted number costs a day, never a stranded recipient.
 *
 * Same dep-injection + in-memory store style as blast-plan-single-number-cap.
 */
import { describe, it, expect, vi } from "vitest";

const { createBlastPlan, releaseBlastPlanLot } = await import(
  "../../supabase/functions/_shared/quick-blast/blast-plan.ts"
);

const NUM = { id: "num-1", organization_id: "org-1", provider: "uazapi", daily_blast_cap: 80 } as any;
const NUM_B = { id: "num-2", organization_id: "org-1", provider: "uazapi", daily_blast_cap: 80 } as any;

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
      async getUsedToday() { return state.used; },
      async increment(instanceId: string, _date: string, count: number) {
        state.used += count;
        state.increments.push({ instanceId, count });
      },
    },
  };
}

/** `byInstance` maps instance id → reading, or a thrower. */
function reachStub(byInstance: Record<string, unknown>) {
  const state = { calls: [] as string[] };
  return {
    state,
    source: {
      async get(instanceId: string) {
        state.calls.push(instanceId);
        const r = byInstance[instanceId];
        if (typeof r === "function") return (r as () => any)();
        return (r ?? null) as any;
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

/** Builds a 2-lot plan whose lot 0 already shipped, leaving lot 1 to release. */
async function planWithPendingLot(dispatch: any, opts?: { instances?: any[] }) {
  const { store, state } = planStore();
  const org = orgUsageStub(0);
  const inst = instanceUsageStub(0);

  const out = await createBlastPlan(
    { store, usageSource: org.source, dispatch, instanceUsageSource: inst.source },
    {
      orgId: "org-1",
      userId: "u",
      instance: NUM,
      leads: leads(60),
      message: "Hi",
      // Budget 30 forces a second lot.
      dailyBudget: 30,
      ...(opts?.instances ? { instances: opts.instances } : {}),
    } as any,
  );

  return { planId: (out as any).plan_id ?? [...state.plans.keys()][0], store, state, org, inst };
}

describe("releaseBlastPlanLot — WhatsApp reach allowance (#1168)", () => {
  it("defers the lot when the sending number is at its reach ceiling", async () => {
    const dispatch = okDispatch();
    const { planId, store, state, org, inst } = await planWithPendingLot(dispatch);
    dispatch.mockClear();

    const reach = reachStub({ "num-1": { current: 80, limit: 80 } });

    const out = await releaseBlastPlanLot(
      {
        store,
        usageSource: org.source,
        dispatch,
        instanceUsageSource: inst.source,
        reachLimitSource: reach.source,
      } as any,
      { planId, dailyBudget: 100 },
    );

    expect(out.ok).toBe(true);
    // Nothing left the number...
    expect(out.sent).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
    // ...and nothing was lost: the rows moved forward, exactly as they do under
    // budget pressure. A refusal here would strand them.
    expect(out.deferred).toBeGreaterThan(0);
    expect(state.recipients.some((r) => r.status === "sent" && r.lot_index === 1)).toBe(false);
  });

  it("does not consume either ledger when the lot is deferred", async () => {
    const dispatch = okDispatch();
    const { planId, store, org, inst } = await planWithPendingLot(dispatch);
    dispatch.mockClear();
    org.state.increments.length = 0;
    inst.state.increments.length = 0;

    await releaseBlastPlanLot(
      {
        store,
        usageSource: org.source,
        dispatch,
        instanceUsageSource: inst.source,
        reachLimitSource: reachStub({ "num-1": { current: 80, limit: 80 } }).source,
      } as any,
      { planId, dailyBudget: 100 },
    );

    expect(org.state.increments).toEqual([]);
    expect(inst.state.increments).toEqual([]);
  });

  it("releases normally when the number has reach headroom", async () => {
    const dispatch = okDispatch();
    const { planId, store, org, inst } = await planWithPendingLot(dispatch);
    dispatch.mockClear();

    const out = await releaseBlastPlanLot(
      {
        store,
        usageSource: org.source,
        dispatch,
        instanceUsageSource: inst.source,
        reachLimitSource: reachStub({ "num-1": { current: 5, limit: 80 } }).source,
      } as any,
      { planId, dailyBudget: 100 },
    );

    expect(out.sent).toBeGreaterThan(0);
    expect(dispatch).toHaveBeenCalled();
  });

  // --- fail-open ------------------------------------------------------------

  it("releases when the reading is unknown", async () => {
    const dispatch = okDispatch();
    const { planId, store, org, inst } = await planWithPendingLot(dispatch);
    dispatch.mockClear();

    const out = await releaseBlastPlanLot(
      {
        store,
        usageSource: org.source,
        dispatch,
        instanceUsageSource: inst.source,
        reachLimitSource: reachStub({ "num-1": null }).source,
      } as any,
      { planId, dailyBudget: 100 },
    );

    expect(out.sent).toBeGreaterThan(0);
  });

  it("releases when the reach source throws", async () => {
    const dispatch = okDispatch();
    const { planId, store, org, inst } = await planWithPendingLot(dispatch);
    dispatch.mockClear();

    const out = await releaseBlastPlanLot(
      {
        store,
        usageSource: org.source,
        dispatch,
        instanceUsageSource: inst.source,
        reachLimitSource: reachStub({
          "num-1": () => {
            throw new Error("provider down");
          },
        }).source,
      } as any,
      { planId, dailyBudget: 100 },
    );

    expect(out.sent).toBeGreaterThan(0);
  });

  it("releases when no reach seam is injected — legacy semantics unchanged", async () => {
    const dispatch = okDispatch();
    const { planId, store, org, inst } = await planWithPendingLot(dispatch);
    dispatch.mockClear();

    const out = await releaseBlastPlanLot(
      { store, usageSource: org.source, dispatch, instanceUsageSource: inst.source } as any,
      { planId, dailyBudget: 100 },
    );

    expect(out.sent).toBeGreaterThan(0);
  });
});
