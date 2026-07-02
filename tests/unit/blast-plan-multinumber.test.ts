// @vitest-environment node
/**
 * Multi-number Blast Plan orchestration (ADR-0015, #901).
 *
 * Extends the ADR-0003 createBlastPlan/releaseBlastPlanLot with per-number
 * distribution: the frozen audience is split round-robin across the selected
 * numbers (planBlast), each recipient is stamped with its sending number, and
 * every number is bounded by its OWN daily cap (blast_instance_daily_usage) on
 * dispatch — on top of the org-wide #706 ledger. The releaser also honours the
 * plan's send window.
 *
 * Same dep-injection + in-memory stub style as blast-plan.test.ts, plus a
 * per-number usage stub and an instance resolver carrying daily_blast_cap.
 */
import { describe, it, expect, vi } from "vitest";

const { createBlastPlan, releaseBlastPlanLot } = await import(
  "../../supabase/functions/_shared/quick-blast/blast-plan.ts"
);

const numA = { id: "a", organization_id: "org-1", provider: "uazapi" } as any;
const numB = { id: "b", organization_id: "org-1", provider: "uazapi" } as any;

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

/** Org-wide #706 ledger stub. */
function usageStub() {
  const state = { byDate: new Map<string, number>(), increments: [] as Array<{ date: string; n: number }> };
  return {
    state,
    source: {
      async getUsedToday(_org: string, date: string) {
        return state.byDate.get(date) ?? 0;
      },
      async increment(_org: string, date: string, count: number) {
        state.byDate.set(date, (state.byDate.get(date) ?? 0) + count);
        state.increments.push({ date, n: count });
      },
    },
  };
}

/** Per-number ledger stub (key = `${instanceId}|${date}`). */
function instanceUsageStub(seed: Record<string, number> = {}) {
  const state = { byKey: new Map<string, number>(seed ? Object.entries(seed) : []), increments: [] as any[] };
  return {
    state,
    source: {
      async getUsedToday(instanceId: string, date: string) {
        return state.byKey.get(`${instanceId}|${date}`) ?? 0;
      },
      async increment(instanceId: string, date: string, count: number) {
        const key = `${instanceId}|${date}`;
        state.byKey.set(key, (state.byKey.get(key) ?? 0) + count);
        state.increments.push({ instanceId, date, n: count });
      },
    },
  };
}

const okDispatch = () =>
  vi.fn(async (inst: any, input: any) => ({ sender_job_id: "j", uazapi_sender_id: "u", _inst: inst.id, _n: input.recipients.length }));

const NOW = new Date("2026-06-05T12:00:00.000Z"); // BRT 2026-06-05
const baseParams = (overrides: any = {}) => ({
  orgId: "org-1",
  userId: "user-1",
  numbers: [
    { instance: numA, cap: 80 },
    { instance: numB, cap: 80 },
  ],
  leads: leads(240),
  message: "Olá {primeiro_nome}",
  refinements: {},
  delayMinMs: 1000,
  delayMaxMs: 3000,
  dailyBudget: 1000,
  source: { kind: "stage" },
  now: NOW,
  ...overrides,
});

describe("createBlastPlan — multi-number distribution", () => {
  it("splits the audience across numbers and stamps each recipient's instance_id", async () => {
    const { store, state } = planStore();
    const usage = usageStub();
    const instUsage = instanceUsageStub();
    const dispatch = okDispatch();

    const out = await createBlastPlan(
      { store, usageSource: usage.source, instanceUsageSource: instUsage.source, dispatch },
      baseParams(),
    );

    expect(out.ok).toBe(true);
    // 240 / (80+80) → 2 daily lots.
    expect(out.lotsTotal).toBe(2);
    expect(out.breakdown).toEqual([
      { lotIndex: 0, date: "2026-06-05", count: 160 },
      { lotIndex: 1, date: "2026-06-06", count: 80 },
    ]);
    // Every recipient stamped with a or b.
    expect(state.recipients).toHaveLength(240);
    expect(state.recipients.filter((r) => r.instance_id === "a")).toHaveLength(120);
    expect(state.recipients.filter((r) => r.instance_id === "b")).toHaveLength(120);

    // Lot 0 fired today: one dispatch per number, 80 each.
    expect(dispatch).toHaveBeenCalledTimes(2);
    const counts = dispatch.mock.calls.map((c) => (c[1] as any).recipients.length).sort();
    expect(counts).toEqual([80, 80]);
    // Per-number ledger took 80 each; org-wide took 160.
    expect(instUsage.state.byKey.get("a|2026-06-05")).toBe(80);
    expect(instUsage.state.byKey.get("b|2026-06-05")).toBe(80);
    expect(usage.state.byDate.get("2026-06-05")).toBe(160);

    const plan = state.plans.get(out.planId);
    expect(plan.lots_released).toBe(1);
    expect(plan.status).toBe("active");
    expect(plan.next_release_date).toBe("2026-06-06");
    // Window persisted (passed through baseParams default = undefined → null cols).
    expect(plan.window_days ?? null).toBeNull();
  });

  it("enforces the PER-NUMBER cap: a number already used today sends less, rest defers", async () => {
    const { store, state } = planStore();
    const usage = usageStub();
    // Number a already sent 60 of its 80 today → only 20 headroom.
    const instUsage = instanceUsageStub({ "a|2026-06-05": 60 });
    const dispatch = okDispatch();

    const out = await createBlastPlan(
      { store, usageSource: usage.source, instanceUsageSource: instUsage.source, dispatch },
      baseParams({ leads: leads(240) }),
    );

    expect(out.ok).toBe(true);
    // a sends 20 (cap headroom), b sends its full 80 → 100 today.
    expect(instUsage.state.byKey.get("a|2026-06-05")).toBe(80); // 60 + 20
    expect(instUsage.state.byKey.get("b|2026-06-05")).toBe(80);
    expect(usage.state.byDate.get("2026-06-05")).toBe(100);
    expect(state.recipients.filter((r) => r.status === "sent")).toHaveLength(100);
    // The 60 of a that didn't fit were deferred forward (still pending).
    const plan = state.plans.get(out.planId);
    expect(plan.status).toBe("active");
    expect(plan.next_release_date).toBe("2026-06-06");
    expect(state.recipients.filter((r) => r.status === "pending")).toHaveLength(140);
  });

  it("a single-day multi-number audience completes immediately", async () => {
    const { store, state } = planStore();
    const out = await createBlastPlan(
      { store, usageSource: usageStub().source, instanceUsageSource: instanceUsageStub().source, dispatch: okDispatch() },
      baseParams({ leads: leads(100) }), // 100 <= 160 capacity → 1 lot
    );
    expect(out.lotsTotal).toBe(1);
    expect(state.plans.get(out.planId).status).toBe("completed");
  });

  it("stamps dispatch provenance {planId, lotIndex: 0} on EVERY per-number lot-0 job (ADR-0016 §3)", async () => {
    const { store } = planStore();
    const dispatch = okDispatch();

    const out = await createBlastPlan(
      { store, usageSource: usageStub().source, instanceUsageSource: instanceUsageStub().source, dispatch },
      baseParams(),
    );

    expect(out.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(2); // one job per number
    for (const call of dispatch.mock.calls) {
      const input = call[1] as any;
      expect(input.planId).toBe(out.planId);
      expect(input.lotIndex).toBe(0);
    }
  });

  it("rejects a foreign-org number (tenant guard)", async () => {
    const out = await createBlastPlan(
      { store: planStore().store, usageSource: usageStub().source, instanceUsageSource: instanceUsageStub().source, dispatch: okDispatch() },
      baseParams({ numbers: [{ instance: { id: "x", organization_id: "OTHER" }, cap: 80 }] }),
    );
    expect(out.ok).toBe(false);
    expect(out.error).toBe("instance_org_mismatch");
  });

  it("rejects a non-positive cap (fail-closed, never unlimited)", async () => {
    const out = await createBlastPlan(
      { store: planStore().store, usageSource: usageStub().source, instanceUsageSource: instanceUsageStub().source, dispatch: okDispatch() },
      baseParams({ numbers: [{ instance: numA, cap: 0 }] }),
    );
    expect(out.ok).toBe(false);
    expect(out.error).toBe("invalid_cap");
  });
});

describe("releaseBlastPlanLot — multi-number + window", () => {
  const instRows: Record<string, any> = {
    a: { id: "a", organization_id: "org-1", provider: "uazapi", daily_blast_cap: 80 },
    b: { id: "b", organization_id: "org-1", provider: "uazapi", daily_blast_cap: 80 },
  };
  const resolver = async (id: string) => instRows[id] ?? null;

  async function seedMulti(store: any, rows: Array<{ id: string; inst: string }>, extra: any = {}) {
    const planId = await store.insertPlan({
      organization_id: "org-1",
      instance_id: "a",
      status: "active",
      message: "Olá {primeiro_nome}",
      refinements: {},
      image_url: null,
      delay_min_ms: null,
      delay_max_ms: null,
      total_recipients: rows.length,
      lots_total: 2,
      lots_released: 1,
      next_release_date: "2026-06-06",
      ...extra,
    });
    await store.insertRecipients(
      rows.map((r) => ({
        plan_id: planId,
        lead_id: r.id,
        phone: `1199${r.id}`,
        variable_snapshot: { primeiro_nome: `L${r.id}` },
        lot_index: 1,
        instance_id: r.inst,
        status: "pending",
        reason: null,
      })),
    );
    return planId;
  }

  it("dispatches the lot grouped by number, each bounded by its own cap", async () => {
    const { store, state } = planStore();
    const usage = usageStub();
    const instUsage = instanceUsageStub({ "b|2026-06-06": 1 }); // b has 1 of 80 used? use small cap below
    const dispatch = okDispatch();
    // 2 for a, 2 for b.
    const planId = await seedMulti(store, [
      { id: "0", inst: "a" },
      { id: "1", inst: "a" },
      { id: "2", inst: "b" },
      { id: "3", inst: "b" },
    ]);

    const out = await releaseBlastPlanLot(
      { store, usageSource: usage.source, instanceUsageSource: instUsage.source, dispatch, instanceResolver: resolver },
      { planId, now: new Date("2026-06-06T12:00:00Z"), dailyBudget: 1000 },
    );

    expect(out.ok).toBe(true);
    expect(out.sent).toBe(4);
    expect(dispatch).toHaveBeenCalledTimes(2); // one per number
    expect(instUsage.state.byKey.get("a|2026-06-06")).toBe(2);
    expect(instUsage.state.byKey.get("b|2026-06-06")).toBe(3); // 1 seeded + 2
    expect(usage.state.byDate.get("2026-06-06")).toBe(4);
    expect(state.plans.get(planId).status).toBe("completed");
  });

  it("stamps dispatch provenance {planId, lotIndex} on every per-number released job (ADR-0016 §3)", async () => {
    const { store } = planStore();
    const dispatch = okDispatch();
    const planId = await seedMulti(store, [
      { id: "0", inst: "a" },
      { id: "1", inst: "b" },
    ]);

    await releaseBlastPlanLot(
      { store, usageSource: usageStub().source, instanceUsageSource: instanceUsageStub().source, dispatch, instanceResolver: resolver },
      { planId, now: new Date("2026-06-06T12:00:00Z"), dailyBudget: 1000 },
    );

    expect(dispatch).toHaveBeenCalledTimes(2); // one job per number
    for (const call of dispatch.mock.calls) {
      const input = call[1] as any;
      expect(input.planId).toBe(planId);
      expect(input.lotIndex).toBe(1); // lots_released = 1 → this release fires lot 1
    }
  });

  it("a saturated number defers its share while the other still sends", async () => {
    const { store, state } = planStore();
    const usage = usageStub();
    // cap a to 80 but pre-consume 80 → a has zero headroom today.
    const instUsage = instanceUsageStub({ "a|2026-06-06": 80 });
    const dispatch = okDispatch();
    const planId = await seedMulti(store, [
      { id: "0", inst: "a" },
      { id: "1", inst: "a" },
      { id: "2", inst: "b" },
    ]);

    const out = await releaseBlastPlanLot(
      { store, usageSource: usage.source, instanceUsageSource: instUsage.source, dispatch, instanceResolver: resolver },
      { planId, now: new Date("2026-06-06T12:00:00Z"), dailyBudget: 1000 },
    );

    expect(out.sent).toBe(1); // only b's single recipient
    expect(out.deferred).toBe(2); // a's two recipients pushed forward
    expect(state.recipients.filter((r) => r.status === "pending")).toHaveLength(2);
    expect(state.plans.get(planId).status).toBe("active");
  });

  it("defers the WHOLE release when today is outside the send window", async () => {
    const { store, state } = planStore();
    const dispatch = okDispatch();
    const today = "2026-06-06";
    const wd = new Date(Date.UTC(2026, 5, 6)).getUTCDay();
    const window_days = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== wd); // exclude today
    const planId = await seedMulti(
      store,
      [{ id: "0", inst: "a" }],
      { window_days, window_from_minutes: 480, window_to_minutes: 1200, instance: instRows.a },
    );

    const out = await releaseBlastPlanLot(
      { store, usageSource: usageStub().source, instanceUsageSource: instanceUsageStub().source, dispatch, instanceResolver: resolver },
      { planId, now: new Date(`${today}T12:00:00Z`), dailyBudget: 1000 },
    );

    expect(out.ok).toBe(true);
    expect(out.sent).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
    // Pushed to the next allowed day (tomorrow), nothing marked.
    expect(state.plans.get(planId).next_release_date).toBe("2026-06-07");
    expect(state.recipients.filter((r) => r.status === "pending")).toHaveLength(1);
  });
});
