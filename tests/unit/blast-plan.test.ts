// @vitest-environment node
/**
 * Blast Plan orchestration — createBlastPlan + releaseBlastPlanLot (ADR-0003, #707).
 *
 * The deep logic: a frozen audience sliced into budget-sized daily lots; lot 1
 * consumes today's remaining Daily Blast Budget at creation; the daily releaser
 * re-applies the #704 refinements over the FROZEN membership (dropping replied /
 * recently-contacted), is bounded by the shared #706 ledger, defers what cannot
 * fit, and self-terminates when the membership is exhausted.
 *
 * Same dep-injection + Supabase-stub style as quick-blast-run-daily-budget.test.ts:
 * an injected store (frozen recipients + plan rows), usage ledger, refinement
 * activity source, and dispatch fn are the only IO seams — the orchestration is
 * exercised without a live DB.
 */

import { describe, it, expect, vi } from "vitest";

const { createBlastPlan, releaseBlastPlanLot } = await import(
  "../../supabase/functions/_shared/quick-blast/blast-plan.ts"
);

const INSTANCE = { id: "inst-1", organization_id: "org-1", provider: "uazapi" } as any;

const lead = (id: string, phone: string | null = `1199900${id.padStart(4, "0")}`) => ({
  id,
  name: `L${id}`,
  company: "Co",
  phone,
});
const leads = (n: number) => Array.from({ length: n }, (_, i) => lead(String(i)));

/**
 * In-memory Blast Plan store — the IO seam the orchestrator writes/reads through.
 * Captures the frozen snapshot, lot bookkeeping, and per-recipient status so a
 * release can be replayed against it deterministically.
 */
function planStore() {
  const state = {
    plans: new Map<string, any>(),
    recipients: [] as any[], // { plan_id, lead_id, phone, lot_index, status, reason, variable_snapshot }
    seq: 0,
  };
  return {
    state,
    store: {
      async insertPlan(row: any): Promise<string> {
        const id = `plan-${++state.seq}`;
        state.plans.set(id, { id, ...row });
        return id;
      },
      async insertRecipients(rows: any[]): Promise<void> {
        for (const r of rows) state.recipients.push({ ...r });
      },
      async getPlan(planId: string): Promise<any | null> {
        return state.plans.get(planId) ?? null;
      },
      async updatePlan(planId: string, patch: any): Promise<void> {
        const p = state.plans.get(planId);
        if (p) state.plans.set(planId, { ...p, ...patch });
      },
      async getLotRecipients(planId: string, lotIndex: number): Promise<any[]> {
        return state.recipients.filter(
          (r) => r.plan_id === planId && r.lot_index === lotIndex,
        );
      },
      async markRecipients(
        planId: string,
        leadIds: string[],
        status: string,
        reason: string | null,
      ): Promise<void> {
        const set = new Set(leadIds);
        for (const r of state.recipients) {
          if (r.plan_id === planId && set.has(r.lead_id)) {
            r.status = status;
            r.reason = reason;
          }
        }
      },
      async moveRecipientsToLot(planId: string, leadIds: string[], lotIndex: number): Promise<void> {
        const set = new Set(leadIds);
        for (const r of state.recipients) {
          if (r.plan_id === planId && set.has(r.lead_id)) r.lot_index = lotIndex;
        }
      },
      async listActivePlansDue(_today: string): Promise<any[]> {
        return [...state.plans.values()].filter(
          (p) => p.status === "active" && p.next_release_date <= _today,
        );
      },
    },
  };
}

/** In-memory shared daily ledger (mirrors blast_daily_usage). */
function usageStub(initialUsed = 0) {
  const state = { byDate: new Map<string, number>(), increments: [] as Array<{ date: string; n: number }> };
  if (initialUsed) state.byDate.set("seed", initialUsed);
  return {
    state,
    source: {
      async getUsedToday(_org: string, date: string) {
        return state.byDate.get(date) ?? (date === "seed" ? initialUsed : 0);
      },
      async increment(_org: string, date: string, count: number) {
        state.byDate.set(date, (state.byDate.get(date) ?? 0) + count);
        state.increments.push({ date, n: count });
      },
    },
  };
}

/** Refinement activity source — per-lead last outgoing/incoming. */
function activity(map: Record<string, { out?: string; in?: string }> = {}) {
  return {
    async getLeadActivity(_org: string, ids: string[]) {
      const out = new Map<string, { lastOutgoingAt: Date | null; lastIncomingAt: Date | null }>();
      for (const id of ids) {
        const a = map[id];
        out.set(id, {
          lastOutgoingAt: a?.out ? new Date(a.out) : null,
          lastIncomingAt: a?.in ? new Date(a.in) : null,
        });
      }
      return out;
    },
  };
}

const okDispatch = () =>
  vi.fn(async (_inst: any, input: any) => ({ sender_job_id: "j", uazapi_sender_id: "u", _n: input.recipients.length }));

const baseCreateParams = (overrides: any = {}) => ({
  orgId: "org-1",
  userId: "user-1",
  instance: INSTANCE,
  leads: leads(450),
  message: "Olá {primeiro_nome}",
  refinements: {},
  delayMinMs: 1000,
  delayMaxMs: 3000,
  dailyBudget: 200,
  source: { kind: "stage", pipe: "whatsapp", stage: "novo_lead" },
  now: new Date("2026-06-05T12:00:00.000Z"), // BRT 2026-06-05
  ...overrides,
});

describe("createBlastPlan — freeze + slice + lot 1 today", () => {
  it("freezes the full audience and slices into budget-sized daily lots", async () => {
    const { store, state } = planStore();
    const usage = usageStub(0);
    const dispatch = okDispatch();

    const out = await createBlastPlan(
      { store, usageSource: usage.source, dispatch },
      baseCreateParams({ leads: leads(450), dailyBudget: 200 }),
    );

    expect(out.ok).toBe(true);
    // 450 / 200 → 3 lots (200, 200, 50).
    expect(out.lotsTotal).toBe(3);
    expect(out.totalRecipients).toBe(450);
    // Every lead is frozen into a recipient row (membership frozen at creation).
    expect(state.recipients).toHaveLength(450);
    expect(state.recipients.filter((r) => r.lot_index === 0)).toHaveLength(200);
    expect(state.recipients.filter((r) => r.lot_index === 1)).toHaveLength(200);
    expect(state.recipients.filter((r) => r.lot_index === 2)).toHaveLength(50);
    // Day-by-day breakdown returned for the wizard review.
    expect(out.breakdown).toEqual([
      { lotIndex: 0, date: "2026-06-05", count: 200 },
      { lotIndex: 1, date: "2026-06-06", count: 200 },
      { lotIndex: 2, date: "2026-06-07", count: 50 },
    ]);
  });

  it("dispatches lot 1 today consuming the remaining daily budget and persists the plan", async () => {
    const { store, state } = planStore();
    const usage = usageStub(0);
    const dispatch = okDispatch();

    const out = await createBlastPlan(
      { store, usageSource: usage.source, dispatch },
      baseCreateParams({ leads: leads(450), dailyBudget: 200 }),
    );

    // lot 1 (200) dispatched today.
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((dispatch.mock.calls[0][1] as any).recipients).toHaveLength(200);
    // shared ledger consumed by the dispatched count.
    expect(usage.state.increments).toEqual([{ date: "2026-06-05", n: 200 }]);
    // plan persisted: 1 lot released, next release tomorrow, still active.
    const plan = state.plans.get(out.planId);
    expect(plan.lots_released).toBe(1);
    expect(plan.lots_total).toBe(3);
    expect(plan.next_release_date).toBe("2026-06-06");
    expect(plan.status).toBe("active");
    // lot 0 recipients marked sent.
    expect(state.recipients.filter((r) => r.lot_index === 0 && r.status === "sent")).toHaveLength(200);
  });

  it("a single-day audience completes the plan immediately (no future lots)", async () => {
    const { store, state } = planStore();
    const usage = usageStub(0);
    const out = await createBlastPlan(
      { store, usageSource: usage.source, dispatch: okDispatch() },
      baseCreateParams({ leads: leads(80), dailyBudget: 200 }),
    );
    expect(out.lotsTotal).toBe(1);
    const plan = state.plans.get(out.planId);
    expect(plan.status).toBe("completed");
    expect(plan.lots_released).toBe(1);
  });

  it("a heavy manual day shrinks lot 1 — only the remaining budget goes out, rest defers to lot 2", async () => {
    const { store, state } = planStore();
    const usage = usageStub(0);
    usage.state.byDate.set("2026-06-05", 150); // 150 already sent manually today → 50 left
    const dispatch = okDispatch();

    const out = await createBlastPlan(
      { store, usageSource: usage.source, dispatch },
      baseCreateParams({ leads: leads(300), dailyBudget: 200 }),
    );

    // today only 50 budget left → lot 1 sends 50, NOT 200.
    expect((dispatch.mock.calls[0][1] as any).recipients).toHaveLength(50);
    expect(usage.state.byDate.get("2026-06-05")).toBe(200); // 150 + 50
    // the 150 that couldn't fit today were deferred forward (still pending).
    const sentToday = state.recipients.filter((r) => r.status === "sent");
    expect(sentToday).toHaveLength(50);
    const plan = state.plans.get(out.planId);
    expect(plan.next_release_date).toBe("2026-06-06");
  });

  it("freezes when daily budget is fully consumed — plan created, lot 1 deferred (nothing today)", async () => {
    const { store, state } = planStore();
    const usage = usageStub(0);
    usage.state.byDate.set("2026-06-05", 200); // no budget left today
    const dispatch = okDispatch();

    const out = await createBlastPlan(
      { store, usageSource: usage.source, dispatch },
      baseCreateParams({ leads: leads(300), dailyBudget: 200 }),
    );

    expect(out.ok).toBe(true);
    expect(dispatch).not.toHaveBeenCalled(); // nothing dispatched today
    const plan = state.plans.get(out.planId);
    expect(plan.lots_released).toBe(0); // no lot released today
    expect(plan.next_release_date).toBe("2026-06-06"); // try again tomorrow
    expect(plan.status).toBe("active");
    expect(state.recipients.filter((r) => r.status === "sent")).toHaveLength(0);
  });

  it("stamps dispatch provenance {planId, lotIndex: 0} on the lot-0 job (ADR-0016 §3)", async () => {
    const { store } = planStore();
    const usage = usageStub(0);
    const dispatch = okDispatch();

    const out = await createBlastPlan(
      { store, usageSource: usage.source, dispatch },
      baseCreateParams({ leads: leads(50), dailyBudget: 200 }),
    );

    expect(out.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const input = dispatch.mock.calls[0][1] as any;
    // The sender job must be traceable back to the plan+lot that originated it —
    // the mass-send-status poll matches failures by folder → plan+lot → phone.
    expect(input.planId).toBe(out.planId);
    expect(input.lotIndex).toBe(0);
  });

  it("rejects an empty audience without creating a plan", async () => {
    const { store, state } = planStore();
    const out = await createBlastPlan(
      { store, usageSource: usageStub(0).source, dispatch: okDispatch() },
      baseCreateParams({ leads: [] }),
    );
    expect(out.ok).toBe(false);
    expect(out.error).toBe("no_audience");
    expect(state.plans.size).toBe(0);
  });

  it("rejects a foreign-org instance (tenant guard)", async () => {
    const out = await createBlastPlan(
      { store: planStore().store, usageSource: usageStub(0).source, dispatch: okDispatch() },
      baseCreateParams({ instance: { id: "x", organization_id: "OTHER", provider: "uazapi" } }),
    );
    expect(out.ok).toBe(false);
    expect(out.error).toBe("instance_org_mismatch");
  });
});

describe("releaseBlastPlanLot — daily releaser", () => {
  /** Seed a plan with two future lots already frozen, lot 0 sent. */
  async function seedPlan(store: any, opts: { lot1: any[]; lot2?: any[]; nextDate: string; lotsTotal: number }) {
    const planId = await store.insertPlan({
      organization_id: "org-1",
      instance_id: "inst-1",
      status: "active",
      message: "Olá {primeiro_nome}",
      refinements: { excludeBlastedWithinDays: 7, onlyNonResponders: true },
      image_url: null,
      delay_min_ms: 1000,
      delay_max_ms: 3000,
      total_recipients: opts.lot1.length + (opts.lot2?.length ?? 0),
      lots_total: opts.lotsTotal,
      lots_released: 1,
      next_release_date: opts.nextDate,
      instance: INSTANCE,
    });
    const toRows = (ls: any[], lot: number) =>
      ls.map((l) => ({
        plan_id: planId,
        lead_id: l.id,
        phone: l.phone,
        variable_snapshot: { primeiro_nome: l.name },
        lot_index: lot,
        status: "pending",
        reason: null,
      }));
    await store.insertRecipients(toRows(opts.lot1, 1));
    if (opts.lot2) await store.insertRecipients(toRows(opts.lot2, 2));
    return planId;
  }

  it("releases the next lot, re-applying refinements over the FROZEN membership", async () => {
    const { store, state } = planStore();
    const usage = usageStub(0);
    const dispatch = okDispatch();
    const lot1 = leads(3); // ids 0,1,2
    const planId = await seedPlan(store, { lot1, nextDate: "2026-06-06", lotsTotal: 2 });

    // Precedence is recency → replied (refinements.ts), each lead counted once.
    // lead 1: replied, last contact OUTSIDE the 7-day window → counts as replied.
    // lead 2: contacted today → counts as recency (inside the window).
    const act = activity({
      "1": { out: "2026-04-04T10:00:00Z", in: "2026-04-04T11:00:00Z" }, // replied, old contact
      "2": { out: "2026-06-06T08:00:00Z" }, // contacted today → within 7d window
    });

    const out = await releaseBlastPlanLot(
      { store, usageSource: usage.source, dispatch, activitySource: act },
      { planId, now: new Date("2026-06-06T12:00:00Z"), dailyBudget: 200 },
    );

    expect(out.ok).toBe(true);
    // only lead 0 survives the refinements → 1 dispatched.
    expect((dispatch.mock.calls[0][1] as any).recipients).toHaveLength(1);
    expect(out.sent).toBe(1);
    expect(out.skippedReplied).toBe(1);
    expect(out.skippedRecency).toBe(1);
    // the two dropped recipients are marked skipped (not sent, not pending).
    expect(state.recipients.filter((r) => r.status === "skipped")).toHaveLength(2);
    expect(state.recipients.filter((r) => r.status === "sent")).toHaveLength(1);
  });

  it("a frozen lot ignores new Stage entrants — only frozen recipients are released", async () => {
    const { store } = planStore();
    const usage = usageStub(0);
    const dispatch = okDispatch();
    const lot1 = leads(2);
    const planId = await seedPlan(store, { lot1, nextDate: "2026-06-06", lotsTotal: 2 });

    // The releaser only ever reads the plan's own frozen recipients; there is no
    // re-query of the source Stage. A "new entrant" simply does not exist in the
    // store, so the dispatched set is bounded by the frozen lot of 2.
    const out = await releaseBlastPlanLot(
      { store, usageSource: usage.source, dispatch, activitySource: activity() },
      { planId, now: new Date("2026-06-06T12:00:00Z"), dailyBudget: 200 },
    );
    expect(out.sent).toBe(2); // exactly the frozen membership, never more
  });

  it("budget-bounds the release and defers the remainder to the next day", async () => {
    const { store, state } = planStore();
    const usage = usageStub(0);
    usage.state.byDate.set("2026-06-06", 180); // only 20 budget left
    const dispatch = okDispatch();
    const lot1 = leads(50);
    const planId = await seedPlan(store, { lot1, nextDate: "2026-06-06", lotsTotal: 1 });

    const out = await releaseBlastPlanLot(
      { store, usageSource: usage.source, dispatch, activitySource: activity() },
      { planId, now: new Date("2026-06-06T12:00:00Z"), dailyBudget: 200 },
    );

    expect(out.sent).toBe(20);
    expect(out.deferred).toBe(30);
    expect(usage.state.byDate.get("2026-06-06")).toBe(200); // 180 + 20
    // the 30 not sent stay pending, moved to the NEXT lot index, and the plan is
    // pushed to tomorrow (elastic duration — not completed yet).
    const plan = state.plans.get(planId);
    expect(plan.status).toBe("active");
    expect(plan.next_release_date).toBe("2026-06-07");
    expect(state.recipients.filter((r) => r.status === "pending")).toHaveLength(30);
  });

  it("marks the plan completed when the final lot drains", async () => {
    const { store, state } = planStore();
    const usage = usageStub(0);
    const planId = await seedPlan(store, { lot1: leads(40), nextDate: "2026-06-06", lotsTotal: 2 });

    const out = await releaseBlastPlanLot(
      { store, usageSource: usage.source, dispatch: okDispatch(), activitySource: activity() },
      { planId, now: new Date("2026-06-06T12:00:00Z"), dailyBudget: 200 },
    );

    expect(out.completed).toBe(true);
    const plan = state.plans.get(planId);
    expect(plan.status).toBe("completed");
    expect(plan.lots_released).toBe(2);
  });

  it("advances to the next lot (not completed) when more lots remain", async () => {
    const { store, state } = planStore();
    const usage = usageStub(0);
    const planId = await seedPlan(store, {
      lot1: leads(40),
      lot2: leads(40).map((l) => ({ ...l, id: `b${l.id}` })),
      nextDate: "2026-06-06",
      lotsTotal: 3,
    });

    const out = await releaseBlastPlanLot(
      { store, usageSource: usage.source, dispatch: okDispatch(), activitySource: activity() },
      { planId, now: new Date("2026-06-06T12:00:00Z"), dailyBudget: 200 },
    );

    expect(out.completed).toBe(false);
    const plan = state.plans.get(planId);
    expect(plan.status).toBe("active");
    expect(plan.lots_released).toBe(2);
    expect(plan.next_release_date).toBe("2026-06-07");
  });

  it("stamps dispatch provenance {planId, lotIndex} on the released lot's job (ADR-0016 §3)", async () => {
    const { store } = planStore();
    const usage = usageStub(0);
    const dispatch = okDispatch();
    const planId = await seedPlan(store, { lot1: leads(10), nextDate: "2026-06-06", lotsTotal: 2 });

    await releaseBlastPlanLot(
      { store, usageSource: usage.source, dispatch, activitySource: activity() },
      { planId, now: new Date("2026-06-06T12:00:00Z"), dailyBudget: 200 },
    );

    expect(dispatch).toHaveBeenCalledTimes(1);
    const input = dispatch.mock.calls[0][1] as any;
    expect(input.planId).toBe(planId);
    expect(input.lotIndex).toBe(1); // lots_released = 1 → this release fires lot 1
  });

  it("a deferred remainder is dispatched with its NEW lot index on the next day's release", async () => {
    const { store } = planStore();
    const usage = usageStub(0);
    usage.state.byDate.set("2026-06-06", 180); // only 20 budget left today
    const dispatch = okDispatch();
    const planId = await seedPlan(store, { lot1: leads(50), nextDate: "2026-06-06", lotsTotal: 2 });

    // Day 1: 20 sent (lot 1), 30 deferred forward to lot 2.
    await releaseBlastPlanLot(
      { store, usageSource: usage.source, dispatch, activitySource: activity() },
      { planId, now: new Date("2026-06-06T12:00:00Z"), dailyBudget: 200 },
    );
    expect((dispatch.mock.calls[0][1] as any).lotIndex).toBe(1);

    // Day 2: the deferred 30 go out as lot 2 — provenance must carry the index
    // they were RELEASED under, not the one they were frozen into.
    await releaseBlastPlanLot(
      { store, usageSource: usage.source, dispatch, activitySource: activity() },
      { planId, now: new Date("2026-06-07T12:00:00Z"), dailyBudget: 200 },
    );
    expect(dispatch).toHaveBeenCalledTimes(2);
    const input = dispatch.mock.calls[1][1] as any;
    expect(input.recipients).toHaveLength(30);
    expect(input.planId).toBe(planId);
    expect(input.lotIndex).toBe(2);
  });

  it("does not release a paused plan", async () => {
    const { store } = planStore();
    const planId = await seedPlan(store, { lot1: leads(10), nextDate: "2026-06-06", lotsTotal: 1 });
    await store.updatePlan(planId, { status: "paused" });
    const dispatch = okDispatch();

    const out = await releaseBlastPlanLot(
      { store, usageSource: usageStub(0).source, dispatch, activitySource: activity() },
      { planId, now: new Date("2026-06-06T12:00:00Z"), dailyBudget: 200 },
    );

    expect(out.ok).toBe(false);
    expect(out.error).toBe("not_releasable");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not release a cancelled plan", async () => {
    const { store } = planStore();
    const planId = await seedPlan(store, { lot1: leads(10), nextDate: "2026-06-06", lotsTotal: 1 });
    await store.updatePlan(planId, { status: "cancelled" });

    const out = await releaseBlastPlanLot(
      { store, usageSource: usageStub(0).source, dispatch: okDispatch(), activitySource: activity() },
      { planId, now: new Date("2026-06-06T12:00:00Z"), dailyBudget: 200 },
    );
    expect(out.ok).toBe(false);
    expect(out.error).toBe("not_releasable");
  });

  it("completes a plan whose entire final lot was refined away (no recipients survive)", async () => {
    const { store, state } = planStore();
    const usage = usageStub(0);
    const dispatch = okDispatch();
    const lot1 = leads(2);
    const planId = await seedPlan(store, { lot1, nextDate: "2026-06-06", lotsTotal: 2 });
    // both leads replied → both refined away, nothing to dispatch.
    const act = activity({
      "0": { out: "2026-06-04T10:00:00Z", in: "2026-06-04T11:00:00Z" },
      "1": { out: "2026-06-04T10:00:00Z", in: "2026-06-04T11:00:00Z" },
    });

    const out = await releaseBlastPlanLot(
      { store, usageSource: usage.source, dispatch, activitySource: act },
      { planId, now: new Date("2026-06-06T12:00:00Z"), dailyBudget: 200 },
    );

    expect(dispatch).not.toHaveBeenCalled(); // nothing survived refinement
    expect(out.sent).toBe(0);
    expect(out.completed).toBe(true); // final lot drained (all skipped)
    expect(state.plans.get(planId).status).toBe("completed");
  });
});
